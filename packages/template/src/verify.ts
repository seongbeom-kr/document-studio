import { inspectInternal } from "./structure";
import {
  validateTemplateDefinition,
  validateTemplateInput,
} from "./definition";
import { valueOf } from "./render";
import { previewThumbnail } from "./preview-cache";
import { hwpxGridValid } from "./table-grid";
import { strToU8 } from "fflate";
import {
  elements,
  walk,
  parent,
  inlineTokens,
  textOf,
  NS,
  openArchive,
  type Node,
  type Element,
} from "./xml";
import {
  fail,
  type TemplateDefinition,
  type TemplateFormat,
  type TemplateBinding,
} from "./types";

/** Compare the submitted output with source semantics and declared changes, without running the writer. */
export async function verifyTemplateOutput(input: {
  source: Uint8Array;
  output: Uint8Array;
  format: TemplateFormat;
  definition: TemplateDefinition;
  input: Record<string, unknown>;
}): Promise<{ structurePreserved: true }> {
  const before = await inspectInternal({
      bytes: input.source,
      format: input.format,
    }),
    after = openArchive(input.output, input.format),
    def = input.definition,
    ns = NS[input.format];
  validateTemplateDefinition(def, before.structure);
  validateTemplateInput(def, input.input);
  const names = Object.keys(before.opened.parts).sort();
  if (JSON.stringify(names) !== JSON.stringify(Object.keys(after.parts).sort()))
    fail("TEMPLATE_PRESERVATION_FAILED");
  const changedParts = new Set(
    def.bindings.map(
      (b) => before.structure.targets.find((t) => t.id === b.targetId)!.part,
    ),
  );
  for (const g of def.repeatGroups)
    for (const id of before.structure.rows.find((r) => r.id === g.rowId)!
      .targetIds)
      changedParts.add(before.structure.targets.find((t) => t.id === id)!.part);
  for (const name of names)
    if (
      !changedParts.has(name) &&
      !(input.format === "hwpx" && name === "Preview/PrvText.txt")
    ) {
      const a = previewThumbnail(name) ?? before.opened.parts[name]!,
        b = after.parts[name]!;
      if (a.length !== b.length || a.some((v, i) => v !== b[i]))
        fail("TEMPLATE_PRESERVATION_FAILED");
    }
  type Expected = Map<
    Element,
    Array<{ binding: TemplateBinding; value: unknown }>
  >;
  const bindings = (
    list: TemplateBinding[],
    values: Record<string, unknown>,
  ): Expected => {
    const map: Expected = new Map();
    for (const b of list) {
      const p = before.nodes.get(b.targetId)!;
      map.set(p, [
        ...(map.get(p) ?? []),
        { binding: b, value: values[b.fieldId] },
      ]);
    }
    return map;
  };
  const base = bindings(def.bindings, input.input),
    groups = new Map(
      def.repeatGroups.map((g) => [before.rowNodes.get(g.rowId)!, g]),
    );
  for (const part of changedParts) {
    const source = before.opened.xml.get(part)!,
      result = after.xml.get(part)!;
    const sourceTables = walk(source).filter(
        (n) => n.namespaceURI === ns && n.localName === "tbl",
      ),
      resultTables = walk(result).filter(
        (n) => n.namespaceURI === ns && n.localName === "tbl",
      );
    if (sourceTables.length !== resultTables.length)
      fail("TEMPLATE_PRESERVATION_FAILED");
    const repeatingIndexes = new Set(
      [...groups.keys()]
        .map((row) => sourceTables.indexOf(row.parentNode as Element))
        .filter((i) => i >= 0),
    );
    const attrs = (node: Element, inRepeatedTable: boolean) =>
      Array.from(node.attributes)
        .filter((a) => {
          if (a.name === "xmlns" || a.prefix === "xmlns") return false;
          if (
            inRepeatedTable &&
            node.localName === "p" &&
            ["id", "paraId", "textId"].includes(a.localName ?? "")
          )
            return false;
          if (
            inRepeatedTable &&
            node.localName === "tbl" &&
            a.localName === "rowCnt"
          )
            return false;
          if (
            inRepeatedTable &&
            node.localName === "cellAddr" &&
            a.localName === "rowAddr"
          )
            return false;
          return true;
        })
        .map((a) => [a.namespaceURI ?? "", a.localName, a.value])
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    const signature = (
      node: Node,
      expected: Expected,
      isSource: boolean,
      repeated = false,
      skeleton = false,
    ): unknown => {
      if (node.nodeType === 3)
        return skeleton ? null : (node.nodeValue ?? "").trim() || null;
      if (node.nodeType !== 1 && node.nodeType !== 9) return null;
      const n = node as Element,
        local = n.localName;
      if (node.nodeType === 1 && local === "tbl" && n.namespaceURI === ns) {
        const tables = isSource ? sourceTables : resultTables;
        repeated = repeatingIndexes.has(tables.indexOf(n));
      }
      if (
        skeleton &&
        n.namespaceURI === ns &&
        ["t", "br", "cr", "lineBreak", "linesegarray"].includes(local ?? "")
      )
        return null;
      if (node.nodeType === 1 && local === "p" && n.namespaceURI === ns) {
        let text = textOf(n, ns);
        if (isSource) {
          for (const { binding: b, value } of [...(expected.get(n) ?? [])].sort(
            (a, b) => (b.binding.start ?? 0) - (a.binding.start ?? 0),
          )) {
            const start = b.start ?? 0,
              end = b.end ?? textOf(n, ns).length;
            text = text.slice(0, start) + valueOf(value, b) + text.slice(end);
          }
        }
        let children = Array.from(n.childNodes)
          .map((c) => signature(c, expected, isSource, repeated, true))
          .filter((v) => v !== null);
        // A genuinely empty paragraph can acquire its first default run for insertion.
        children = children.filter(
          (v) =>
            JSON.stringify(v) !==
            JSON.stringify([
              ns,
              input.format === "docx" ? "r" : "run",
              input.format === "docx" ? [] : [["", "charPrIDRef", "0"]],
              [],
            ]),
        );
        const runName = input.format === "docx" ? "r" : "run",
          runs = walk(n).filter(
            (r) =>
              r.namespaceURI === ns &&
              r.localName === runName &&
              parent(r, "p", ns) === n,
          );
        let units = inlineTokens(n, ns).flatMap((t) => {
          const run = parent(t.node, runName, ns);
          return t.value
            .split("")
            .map((char) => ({ char, run: run ? runs.indexOf(run) : 0 }));
        });
        if (isSource)
          for (const { binding: b, value } of [...(expected.get(n) ?? [])].sort(
            (a, b) => (b.binding.start ?? 0) - (a.binding.start ?? 0),
          )) {
            const start = b.start ?? 0,
              end = b.end ?? textOf(n, ns).length,
              run = units[start]?.run ?? units[start - 1]?.run ?? 0;
            units = [
              ...units.slice(0, start),
              ...valueOf(value, b)
                .split("")
                .map((char) => ({ char, run })),
              ...units.slice(end),
            ];
          }
        const runTexts = Array.from(
          { length: Math.max(runs.length, units.length ? 1 : 0) },
          (_, i) =>
            units
              .filter((u) => u.run === i)
              .map((u) => u.char)
              .join(""),
        );
        return [ns, "p", attrs(n, repeated), children, text, runTexts];
      }
      const children: unknown[] = [];
      for (const child of Array.from(node.childNodes)) {
        const group = isSource ? groups.get(child as Element) : undefined;
        if (group) {
          const data = input.input[group.fieldId] ?? [];
          if (!Array.isArray(data) || data.length > group.maxRows)
            fail("TEMPLATE_REPEAT_LIMIT");
          const rows = data.length ? data : group.empty === "keep" ? [{}] : [];
          for (const row of rows) {
            const mapped = new Map([
              ...expected,
              ...bindings(group.bindings, row as Record<string, unknown>),
            ]);
            const value = signature(child, mapped, true, repeated, skeleton);
            if (value !== null) children.push(value);
          }
        } else {
          const value = signature(
            child,
            expected,
            isSource,
            repeated,
            skeleton,
          );
          if (value !== null) children.push(value);
        }
      }
      return node.nodeType === 9
        ? children
        : [n.namespaceURI ?? "", local, attrs(n, repeated), children];
    };
    if (
      JSON.stringify(signature(source, base, true)) !==
      JSON.stringify(signature(result, new Map(), false))
    )
      fail("TEMPLATE_PRESERVATION_FAILED");
    // Repeated HWPX cells must still have correct actual row addresses/counts.
    if (input.format === "hwpx")
      for (const i of repeatingIndexes) {
        const table = resultTables[i]!,
          rows = elements(table).filter((n) => n.localName === "tr");
        if (table.getAttribute("rowCnt") !== String(rows.length))
          fail("TEMPLATE_PRESERVATION_FAILED");
        if (!hwpxGridValid(table)) fail("TEMPLATE_PRESERVATION_FAILED");
        rows.forEach((r, ri) => {
          for (const cell of elements(r).filter((n) => n.localName === "tc")) {
            const addr = elements(cell).find((n) => n.localName === "cellAddr");
            if (addr && addr.getAttribute("rowAddr") !== String(ri))
              fail("TEMPLATE_PRESERVATION_FAILED");
          }
        });
      }
  }
  if (input.format === "hwpx" && after.parts["Preview/PrvText.txt"]) {
    const expected = strToU8(
      after.bodyParts
        .flatMap((part) =>
          walk(after.xml.get(part)!)
            .filter((n) => n.namespaceURI === ns && n.localName === "p")
            .map((p) => textOf(p, ns)),
        )
        .join("\n")
        .slice(0, 32000),
    );
    const actual = after.parts["Preview/PrvText.txt"]!;
    if (
      actual.length !== expected.length ||
      actual.some((v, i) => v !== expected[i])
    )
      fail("TEMPLATE_PRESERVATION_FAILED");
  }
  return { structurePreserved: true };
}
