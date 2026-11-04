import { strToU8 } from "fflate";
import {
  digest,
  NS,
  attr,
  elements,
  walk,
  parent,
  inlineTokens,
  textOf,
  type Node,
  type Element,
} from "../xml";
import { previewThumbnail } from "../preview-cache";
import { inspectV3Internal, sourceNodeV3 } from "./structure";
import { canonicalV3, digestV3 } from "./contract";
import { validateRenderPlanV3 } from "./plan";
import { prototypeNodeV3, tableLayoutV3 } from "./layout";
import { directV3 } from "./docx";
import { cellColumn } from "../table-grid";
import { workingRuntimeV3 } from "./runtime";
import { styledReplacementV3 } from "./text-style";
import type {
  TemplateDefinitionV3,
  ValidatedPlanV3,
  WorkingDocumentProofV3,
  RegionDefinitionV3,
  RegionPlanV3,
  TemplateRegionV3,
} from "./types";
function invalid(): never {
  throw new Error("TEMPLATE_PRESERVATION_FAILED");
}
const equal = (a: unknown, b: unknown) => canonicalV3(a) === canonicalV3(b);
function attributes(node: Element, renew = false, omit: string[] = []) {
  return Array.from(node.attributes)
    .filter(
      (a) =>
        a.namespaceURI !== "http://www.w3.org/2000/xmlns/" &&
        !(renew && ["id", "paraId", "textId"].includes(a.localName ?? "")) &&
        !omit.includes(a.localName ?? ""),
    )
    .map((a) => [a.namespaceURI ?? "", a.localName ?? "", a.value])
    .sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
}
const layoutNames = new Set([
  "tblGrid",
  "tcW",
  "gridSpan",
  "vMerge",
  "cellAddr",
  "cellSpan",
  "cellSz",
  "tblW",
  "tblHeader",
  "cantSplit",
  "linesegarray",
]);
function skeleton(node: Node, renew = false, layout = false): unknown {
  if (node.nodeType === 3 || node.nodeType === 4)
    return node.nodeValue?.trim() ? node.nodeValue : null;
  if (node.nodeType !== 1) return null;
  const n = node as Element,
    local = n.localName ?? "";
  if (
    ["t", "br", "cr", "lineBreak", "linesegarray"].includes(local) ||
    (layout && layoutNames.has(local))
  )
    return null;
  const attrs = attributes(
    n,
    renew && local === "p",
    layout
      ? local === "tc"
        ? ["header"]
        : local === "tbl"
          ? ["rowCnt", "colCnt", "pageBreak"]
          : local === "sz"
            ? ["width", "height"]
            : local === "trHeight"
              ? ["hRule"]
              : []
      : [],
  );
  const children = Array.from(n.childNodes)
    .map((c) => skeleton(c, renew, layout))
    .filter((c) => c !== null);
  if (
    (["r", "run"].includes(local) &&
      children.length === 0 &&
      (attrs.length === 0 ||
        (attrs.length === 1 &&
          attrs[0]![1] === "charPrIDRef" &&
          attrs[0]![2] === "0"))) ||
    (["tcPr", "trPr", "tblPr"].includes(local) &&
      !children.length &&
      !attrs.length)
  )
    return null;
  return [n.namespaceURI ?? "", local, attrs, children];
}
function paragraphView(
  p: Element,
  ns: string,
  changes: { start: number; end: number; text: string }[] = [],
  renew = false,
) {
  const runName = ns === NS.docx ? "r" : "run";
  const style = (node: Node) => {
    const run = parent(node, runName, ns);
    if (!run) return null;
    const attrs = attributes(run);
    const props = elements(run)
      .filter(
        (n) => !["t", "br", "cr", "lineBreak"].includes(n.localName ?? ""),
      )
      .map((n) => skeleton(n));
    return (attrs.length === 0 && props.length === 0) ||
      (attrs.length === 1 &&
        attrs[0]![1] === "charPrIDRef" &&
        attrs[0]![2] === "0" &&
        props.length === 0)
      ? null
      : [attrs, props];
  };
  let units = inlineTokens(p, ns).flatMap((token) =>
    token.value
      .split("")
      .map((char) => ({ char: char.charCodeAt(0), style: style(token.node) })),
  );
  for (const c of [...changes].sort((a, b) => b.start - a.start)) {
    const edit = styledReplacementV3(units, c, canonicalV3);
    if (!edit) continue;
    units = [
      ...units.slice(0, edit.start),
      ...edit.text.split("").map((char) => ({
        char: char.charCodeAt(0),
        style: edit.style ?? null,
      })),
      ...units.slice(edit.end),
    ];
  }
  return { skeleton: skeleton(p, renew), units };
}
export async function verifyWorkingDocumentV3(input: {
  source: Uint8Array;
  output: Uint8Array;
  definition: TemplateDefinitionV3;
  validatedPlan: ValidatedPlanV3;
}): Promise<WorkingDocumentProofV3> {
  const { definition, validatedPlan } = input,
    plan = validatedPlan.plan,
    format = definition.output.defaultFormat === "docx" ? "docx" : "hwpx",
    ns = NS[format];
  if (validatedPlan.planDigest !== (await digestV3(plan))) invalid();
  const before = await inspectV3Internal({
    bytes: input.source,
    format,
    identity: definition.identity,
  });
  const refs = plan.regions.flatMap((r) =>
    r.kind === "text"
      ? r.evidenceRefs
      : r.kind === "paragraphRepeat"
        ? r.items.flatMap((i) => i.evidenceRefs)
        : [
            ...r.columns.flatMap((c) => c.evidenceRefs ?? []),
            ...r.rows.flatMap((row) =>
              row.cells.flatMap((c) => c.evidenceRefs),
            ),
          ],
  );
  await validateRenderPlanV3({
    structure: before.structure,
    definition,
    plan,
    inputDigest: plan.inputDigest,
    sourceSnapshotDigest: plan.sourceSnapshotDigest,
    evidenceRefs: refs,
  });
  const outputDigest = (await digest(input.output)) as `sha256:${string}`;
  let after: Awaited<ReturnType<typeof inspectV3Internal>>;
  try {
    after = await inspectV3Internal({
      bytes: input.output,
      format,
      identity: { ...definition.identity, normalizedHash: outputDigest },
    });
  } catch {
    invalid();
  }
  if (
    !equal(before.structure.page, after.structure.page) ||
    !equal(before.structure.protectedParts, after.structure.protectedParts)
  )
    invalid();
  if (
    !equal(
      Object.keys(before.opened.parts).sort(),
      Object.keys(after.opened.parts).sort(),
    )
  )
    invalid();
  const bytesEqual = (a: Uint8Array, b: Uint8Array) =>
    a.length === b.length && a.every((n, i) => n === b[i]);
  for (const [name, bytes] of Object.entries(before.opened.parts))
    if (!before.opened.bodyParts.includes(name)) {
      const thumbnail = previewThumbnail(name);
      if (thumbnail) {
        if (!bytesEqual(thumbnail, after.opened.parts[name]!)) invalid();
      } else if (name === "Preview/PrvText.txt") {
        const text = strToU8(
          after.opened.bodyParts
            .flatMap((part) =>
              walk(after.opened.xml.get(part)!)
                .filter((n) => n.namespaceURI === ns && n.localName === "p")
                .map((n) => textOf(n, ns)),
            )
            .join("\n")
            .slice(0, 32000),
        );
        if (!bytesEqual(text, after.opened.parts[name]!)) invalid();
      } else if (!bytesEqual(bytes, after.opened.parts[name]!)) invalid();
    }
  const active = new Map<
    Element,
    Array<{
      definition: RegionDefinitionV3;
      plan: RegionPlanV3;
      source: TemplateRegionV3;
    }>
  >();
  const layoutHosts = new Set<Node>();
  for (const p of plan.regions) {
    const d = definition.regions.find((r) => r.id === p.regionId)!,
      s = before.structure.regions.find((r) => r.id === d.sourceRegionId)!,
      node = before.nodes.get(s.id)!;
    active.set(node, [
      ...(active.get(node) ?? []),
      { definition: d, plan: p, source: s },
    ]);
    if (format === "hwpx")
      for (let host = node.parentNode; host; host = host.parentNode) {
        if (
          host.nodeType === 1 &&
          (host as Element).namespaceURI === ns &&
          (host as Element).localName === "p"
        )
          layoutHosts.add(host);
      }
  }
  const actualByNode = new Map(
    after.structure.regions.map((region) => [
      after.nodes.get(region.id),
      region,
    ]),
  );
  const tableCheck = (
    source: TemplateRegionV3,
    d: RegionDefinitionV3,
    p: Extract<RegionPlanV3, { kind: "table" }>,
    node: Element,
  ) => {
    const actual = actualByNode.get(node);
    if (!actual?.table || !actual.editable) invalid();
    const layout = tableLayoutV3(p, d, source, before.structure),
      expected = layout.plan,
      table = actual.table;
    if (
      table.rows.length !== expected.rows.length ||
      !equal(
        table.columns.map((c) => c.width),
        layout.widths,
      )
    )
      invalid();
    const sourceNode = before.nodes.get(source.id)!,
      sourceDoc = before.opened.xml.get(source.address.part)!,
      outputDoc = after.opened.xml.get(actual.address.part)!;
    const sourceStatic = sourceNode.cloneNode(true) as Element,
      outputStatic = node.cloneNode(true) as Element;
    for (const n of [sourceStatic, outputStatic])
      for (const row of elements(n).filter(
        (r) => r.localName === "tr" && r.namespaceURI === ns,
      ))
        n.removeChild(row);
    if (
      !equal(
        skeleton(sourceStatic, false, true),
        skeleton(outputStatic, false, true),
      )
    )
      invalid();
    if (format === "hwpx" && attr(node, "pageBreak") !== "CELL") invalid();
    if (format === "docx") {
      const width = directV3(directV3(node, "tblPr")!, "tblW");
      if (
        !width ||
        Number(attr(width, "w")) !== layout.widths.reduce((a, b) => a + b, 0) ||
        attr(width, "type") !== "dxa"
      )
        invalid();
    }
    for (const [r, row] of table.rows.entries()) {
      const wanted = expected.rows[r]!,
        expectedCells = wanted.cells;
      if (row.cells.length !== expectedCells.length) invalid();
      const sourceRows = elements(sourceNode).filter(
          (n) => n.namespaceURI === ns && n.localName === "tr",
        ),
        actualRow = elements(node).filter(
          (n) => n.namespaceURI === ns && n.localName === "tr",
        )[r]!;
      const prototypeRow =
        sourceRows[
          r < layout.headerRows
            ? r
            : (d.prototypeRow ??
              Math.min(source.table!.headerRows, sourceRows.length - 1))
        ]!;
      const rowCopies = [
        prototypeRow.cloneNode(true) as Element,
        actualRow.cloneNode(true) as Element,
      ];
      for (const copy of rowCopies)
        for (const cell of elements(copy).filter(
          (n) => n.namespaceURI === ns && n.localName === "tc",
        ))
          copy.removeChild(cell);
      if (
        !equal(
          skeleton(rowCopies[0]!, false, true),
          skeleton(rowCopies[1]!, false, true),
        )
      )
        invalid();
      if (format === "docx") {
        const pr = directV3(actualRow, "trPr");
        if (
          !!(pr && directV3(pr, "tblHeader")) !== r < layout.headerRows ||
          (pr && directV3(pr, "cantSplit"))
        )
          invalid();
        const height = pr && directV3(pr, "trHeight");
        if (height && attr(height, "hRule") !== "atLeast") invalid();
        for (const cell of elements(actualRow).filter(
          (n) => n.namespaceURI === ns && n.localName === "tc",
        )) {
          const cp = directV3(cell, "tcPr"),
            vm = cp && directV3(cp, "vMerge");
          if (vm && attr(vm, "val") !== "restart") {
            const column = cellColumn(cell, actualRow, "docx") - 1,
              merge = expected.merges.find(
                (m) =>
                  m.row < r && m.row + m.rowSpan > r && m.column === column,
              );
            if (
              !merge ||
              walk(cell)
                .filter((n) => n.namespaceURI === ns && n.localName === "p")
                .some((p) => textOf(p, ns) !== "")
            )
              invalid();
            const width = cp && directV3(cp, "tcW");
            if (
              !width ||
              attr(width, "type") !== "dxa" ||
              Number(attr(width, "w")) !==
                layout.widths
                  .slice(column, column + merge.columnSpan)
                  .reduce((n, w) => n + w, 0)
            )
              invalid();
          }
        }
      }
      for (const cell of row.cells) {
        const value = expectedCells.find(
            (c) => c.columnKey === expected.columns[cell.column]!.key,
          ),
          merge = expected.merges.find(
            (m) => m.row === r && m.column === cell.column,
          );
        if (
          !value ||
          cell.text !== value.text ||
          cell.rowSpan !== (merge?.rowSpan ?? 1) ||
          cell.columnSpan !== (merge?.columnSpan ?? 1)
        )
          invalid();
        const prototype = prototypeNodeV3(
            sourceDoc,
            source,
            d,
            r,
            cell.column,
            expected,
          ),
          actualCell = sourceNodeV3(outputDoc, cell.address);
        const expectedWidth = layout.widths
          .slice(cell.column, cell.column + cell.columnSpan)
          .reduce((a, b) => a + b, 0);
        const width =
          format === "docx"
            ? directV3(directV3(actualCell, "tcPr")!, "tcW")
            : directV3(actualCell, "cellSz");
        if (
          !width ||
          Number(attr(width, format === "docx" ? "w" : "width")) !==
            expectedWidth * (format === "hwpx" ? 5 : 1) ||
          (format === "docx" && attr(width, "type") !== "dxa")
        )
          invalid();
        const sourceCopy = prototype.cloneNode(true) as Element,
          actualCopy = actualCell.cloneNode(true) as Element;
        for (const copy of [sourceCopy, actualCopy]) {
          const paragraphs = walk(copy).filter(
            (n) => n.namespaceURI === ns && n.localName === "p",
          );
          if (copy === actualCopy && paragraphs.length !== 1) invalid();
          for (const para of paragraphs.slice(1))
            para.parentNode!.removeChild(para);
        }
        if (
          !equal(
            skeleton(sourceCopy, true, true),
            skeleton(actualCopy, true, true),
          )
        )
          invalid();
        const first = walk(prototype).find(
            (n) => n.namespaceURI === ns && n.localName === "p",
          )!,
          out = walk(actualCell).find(
            (n) => n.namespaceURI === ns && n.localName === "p",
          )!;
        if (
          !equal(
            paragraphView(
              first,
              ns,
              [{ start: 0, end: textOf(first, ns).length, text: value.text }],
              true,
            ),
            paragraphView(out, ns, [], true),
          )
        )
          invalid();
        if (
          format === "hwpx" &&
          attr(actualCell, "header") !== (r < layout.headerRows ? "1" : "0")
        )
          invalid();
      }
    }
  };
  const children = (node: Node) =>
    Array.from(node.childNodes).filter(
      (n) =>
        n.nodeType !== 3 ||
        !!n.nodeValue?.trim() ||
        (n.parentNode as Element)?.localName === "t",
    );
  const compare = (source: Node, result: Node) => {
    if (source.nodeType !== result.nodeType) invalid();
    if (source.nodeType === 1) {
      const a = source as Element,
        b = result as Element;
      if (
        a.namespaceURI !== b.namespaceURI ||
        a.localName !== b.localName ||
        !equal(attributes(a), attributes(b))
      )
        invalid();
    } else if (source.nodeType !== 9) {
      if (source.nodeValue !== result.nodeValue) invalid();
      return;
    }
    const cachedLayout = (node: Node) =>
      node.nodeType === 1 &&
      (node as Element).namespaceURI === ns &&
      (node as Element).localName === "linesegarray";
    if (layoutHosts.has(source) && children(result).some(cachedLayout))
      invalid();
    const a = children(source).filter(
        (node) => !layoutHosts.has(source) || !cachedLayout(node),
      ),
      b = children(result);
    let index = 0;
    for (const sourceChild of a) {
      const entries = active.get(sourceChild as Element);
      if (entries) {
        const entry = entries[0]!,
          p = entry.plan,
          d = entry.definition;
        if (p.kind === "text") {
          const actual = b[index++];
          if (!actual || actual.nodeType !== 1) invalid();
          const changes = entries.map((e) => ({
            start: e.definition.range?.start ?? 0,
            end: e.definition.range?.end ?? e.source.text.length,
            text: (e.plan as Extract<RegionPlanV3, { kind: "text" }>).text,
          }));
          if (
            !equal(
              paragraphView(sourceChild as Element, ns, changes),
              paragraphView(actual as Element, ns),
            )
          )
            invalid();
        } else if (p.kind === "paragraphRepeat") {
          const texts = p.items.length
            ? p.items.map((i) => i.text)
            : d.policy.empty === "remove"
              ? []
              : [""];
          for (const text of texts) {
            const actual = b[index++];
            if (
              !actual ||
              actual.nodeType !== 1 ||
              !equal(
                paragraphView(
                  sourceChild as Element,
                  ns,
                  [{ start: 0, end: entry.source.text.length, text }],
                  true,
                ),
                paragraphView(actual as Element, ns, [], true),
              )
            )
              invalid();
          }
        } else {
          if (
            tableLayoutV3(p, d, entry.source, before.structure).plan.rows.length
          ) {
            const actual = b[index++];
            if (!actual || actual.nodeType !== 1) invalid();
            tableCheck(entry.source, d, p, actual as Element);
          }
        }
      } else {
        const actual = b[index++];
        if (!actual) invalid();
        compare(sourceChild, actual);
      }
    }
    if (index !== b.length) invalid();
  };
  for (const part of before.opened.bodyParts)
    compare(before.opened.xml.get(part)!, after.opened.xml.get(part)!);
  const ids = new Set<string>();
  for (const part of after.opened.bodyParts)
    for (const p of walk(after.opened.xml.get(part)!).filter(
      (n) => n.namespaceURI === ns && n.localName === "p",
    )) {
      for (const a of Array.from(p.attributes).filter((a) =>
        format === "hwpx"
          ? a.localName === "id"
          : ["paraId", "textId"].includes(a.localName ?? ""),
      )) {
        const key = `${a.namespaceURI}:${a.localName}:${a.value}`;
        if (ids.has(key)) invalid();
        ids.add(key);
      }
    }
  return {
    sourceIdentity: definition.identity,
    planDigest: validatedPlan.planDigest,
    outputDigest,
    protectedPartDigests: { ...before.structure.protectedParts },
    gridValid: true,
    stylesPreserved: true,
    runtimeProfile: await workingRuntimeV3(),
  };
}
