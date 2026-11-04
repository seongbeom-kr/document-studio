import { zipSync, strToU8 } from "fflate";
import { inspectInternal } from "./structure";
import { previewThumbnail } from "./preview-cache";
import {
  validateTemplateDefinition,
  validateTemplateInput,
  decimal,
} from "./definition";
import {
  NS,
  elements,
  walk,
  parent,
  inlineTokens,
  textOf,
  serialize,
  parseXml,
  digest,
  attr,
  type Element,
  type Node,
} from "./xml";
import {
  fail,
  TEMPLATE_LIMITS,
  type TemplateDefinition,
  type TemplateFormat,
  type TemplateBinding,
} from "./types";
export function valueOf(value: unknown, b: TemplateBinding): string {
  if (value === undefined || value === null) return "";
  const text = String(value).replace(/\r\n?/g, "\n"),
    f = b.format;
  if (!f) return text;
  if (f.kind === "date") {
    const [y, m, d] = text.split("-");
    if (f.pattern === "YYYY. M. D.") return `${y}. ${Number(m)}. ${Number(d)}.`;
    if (f.pattern === "YYYY년 M월 D일")
      return `${y}년 ${Number(m)}월 ${Number(d)}일`;
  }
  if (f.kind === "decimal") {
    const dec = decimal(text),
      scale = f.decimals ?? dec.scale;
    // No silent rounding. User must provide a representable amount or change the format.
    const divisor = 10n ** BigInt(Math.max(0, dec.scale - scale));
    if (dec.number % divisor !== 0n)
      fail("TEMPLATE_DECIMAL_PRECISION", b.fieldId);
    const scaled =
      dec.scale > scale
        ? dec.number / divisor
        : dec.number * 10n ** BigInt(scale - dec.scale);
    const negative = scaled < 0n,
      raw = (negative ? -scaled : scaled).toString().padStart(scale + 1, "0");
    return (
      (negative ? "-" : "") +
      (scale ? raw.slice(0, -scale) + "." + raw.slice(-scale) : raw) +
      (f.unit ?? "")
    );
  }
  return text;
}
function writeTextNode(
  node: Node,
  value: string,
  format: TemplateFormat,
): void {
  const t = node.parentNode as Element,
    doc = t.ownerDocument!,
    ns = NS[format],
    prefix = t.prefix ?? (format === "docx" ? "w" : "hp"),
    lines = value.split("\n");
  node.nodeValue = lines[0]!;
  if (format === "hwpx") {
    let previous: Node = node;
    for (const line of lines.slice(1)) {
      const br = doc.createElementNS(ns, `${prefix}:lineBreak`),
        text = doc.createTextNode(line);
      t.insertBefore(br, previous.nextSibling);
      t.insertBefore(text, br.nextSibling);
      previous = text;
    }
  } else {
    t.setAttributeNS(
      "http://www.w3.org/XML/1998/namespace",
      "xml:space",
      "preserve",
    );
    let previous: Element = t;
    for (const line of lines.slice(1)) {
      const br = doc.createElementNS(ns, `${prefix}:br`),
        next = doc.createElementNS(ns, `${prefix}:t`);
      next.setAttributeNS(
        "http://www.w3.org/XML/1998/namespace",
        "xml:space",
        "preserve",
      );
      next.appendChild(doc.createTextNode(line));
      t.parentNode!.insertBefore(br, previous.nextSibling);
      t.parentNode!.insertBefore(next, br.nextSibling);
      previous = next;
    }
  }
}
export function writeRange(
  p: Element,
  start: number,
  end: number,
  value: string,
  format: TemplateFormat,
): void {
  const ns = NS[format];
  let tokens = inlineTokens(p, ns);
  if (!tokens.length) {
    const doc = p.ownerDocument!,
      prefix = p.prefix ?? (format === "docx" ? "w" : "hp");
    let run = elements(p).find(
      (n) =>
        n.namespaceURI === ns &&
        n.localName === (format === "docx" ? "r" : "run"),
    );
    if (!run) {
      run = doc.createElementNS(
        ns,
        `${prefix}:${format === "docx" ? "r" : "run"}`,
      );
      if (format === "hwpx") run.setAttribute("charPrIDRef", "0");
      p.appendChild(run);
    }
    let t = elements(run).find(
      (n) => n.namespaceURI === ns && n.localName === "t",
    );
    if (!t) {
      t = doc.createElementNS(ns, `${prefix}:t`);
      run.appendChild(t);
    }
    t.appendChild(doc.createTextNode(""));
    tokens = inlineTokens(p, ns);
  }
  const textToken = (t: (typeof tokens)[number]) =>
    t.node.nodeType === 3 || t.node.nodeType === 4;
  let anchor =
    tokens.find((t) => textToken(t) && t.start <= start && t.end > start) ??
    tokens.find((t) => textToken(t) && t.start === start);
  if (!anchor) {
    const control = tokens.find((t) => !textToken(t) && t.start === start);
    if (control) {
      const doc = p.ownerDocument!,
        created = doc.createTextNode("");
      if (format === "hwpx")
        control.node.parentNode!.insertBefore(created, control.node);
      else {
        const t = doc.createElementNS(ns, `${p.prefix ?? "w"}:t`);
        t.appendChild(created);
        control.node.parentNode!.insertBefore(t, control.node);
      }
      anchor = { node: created, value: "", start, end: start };
      tokens.push(anchor);
    } else {
      anchor = [...tokens]
        .reverse()
        .find((t) => textToken(t) && t.end === start);
      const trailing = [...tokens]
        .reverse()
        .find((t) => !textToken(t) && t.end === start);
      if (!anchor && trailing) {
        const doc = p.ownerDocument!,
          created = doc.createTextNode("");
        if (format === "hwpx")
          trailing.node.parentNode!.insertBefore(
            created,
            trailing.node.nextSibling,
          );
        else {
          const t = doc.createElementNS(ns, `${p.prefix ?? "w"}:t`);
          t.appendChild(created);
          trailing.node.parentNode!.insertBefore(t, trailing.node.nextSibling);
        }
        anchor = { node: created, value: "", start, end: start };
        tokens.push(anchor);
      }
    }
  }
  if (!anchor) fail("TEMPLATE_RANGE_CHANGED");
  for (const token of tokens) {
    if (!textToken(token)) {
      if (token.start >= start && token.end <= end)
        token.node.parentNode!.removeChild(token.node);
      continue;
    }
    if (token === anchor || (token.start < end && token.end > start)) {
      const left = token.value.slice(0, Math.max(0, start - token.start)),
        right = token.value.slice(Math.max(0, end - token.start));
      writeTextNode(
        token.node,
        left + (token === anchor ? value : "") + right,
        format,
      );
    }
  }
  if (format === "hwpx")
    for (const n of elements(p).filter((n) => n.localName === "linesegarray"))
      p.removeChild(n);
}
export async function renderTemplate(input: {
  bytes: Uint8Array;
  format: TemplateFormat;
  definition: TemplateDefinition;
  input: Record<string, unknown>;
}) {
  const state = await inspectInternal(input),
    { structure, opened, nodes, rowNodes } = state,
    def = input.definition,
    ns = NS[input.format];
  validateTemplateDefinition(def, structure);
  validateTemplateInput(def, input.input);
  const changed = new Set<string>(),
    changes: Array<{
      bindingId: string;
      targetId: string;
      before: string;
      after: string;
    }> = [];
  const expected = new Map<Element, string>();
  for (const node of nodes.values()) expected.set(node, textOf(node, ns));
  const apply = (
    bindings: TemplateBinding[],
    values: Record<string, unknown>,
    lookup: Map<string, Element>,
  ) => {
    const grouped = new Map<string, TemplateBinding[]>();
    for (const b of bindings)
      grouped.set(b.targetId, [...(grouped.get(b.targetId) ?? []), b]);
    for (const [targetId, list] of grouped) {
      const p = lookup.get(targetId)!,
        target = structure.targets.find((t) => t.id === targetId)!;
      let wanted = textOf(p, ns);
      for (const b of list.sort((a, z) => (z.start ?? 0) - (a.start ?? 0))) {
        const start = b.start ?? 0,
          end = b.end ?? target.text.length,
          value = valueOf(values[b.fieldId], b);
        wanted = wanted.slice(0, start) + value + wanted.slice(end);
        writeRange(p, start, end, value, input.format);
        changes.push({
          bindingId: b.id,
          targetId,
          before: target.text.slice(start, end),
          after: value,
        });
      }
      expected.set(p, wanted);
      changed.add(target.part);
    }
  };
  apply(def.bindings, input.input, nodes);
  let nextParagraph = 1,
    nextWordId = 1;
  const usedWordIds = new Set<number>();
  for (const doc of opened.xml.values())
    for (const p of walk(doc).filter(
      (n) => n.namespaceURI === ns && n.localName === "p",
    )) {
      const n = Number(attr(p, "id"));
      if (Number.isSafeInteger(n) && n >= nextParagraph) nextParagraph = n + 1;
    }
  for (const doc of opened.xml.values())
    for (const node of walk(doc))
      for (const attribute of Array.from(node.attributes))
        if (
          ["paraId", "textId"].includes(attribute.localName ?? "") &&
          /^[0-9a-f]{1,8}$/i.test(attribute.value)
        )
          usedWordIds.add(Number.parseInt(attribute.value, 16));
  const wordId = () => {
    while (usedWordIds.has(nextWordId)) nextWordId++;
    if (nextWordId > 0x7fffffff) fail("TEMPLATE_IDENTIFIER_LIMIT");
    usedWordIds.add(nextWordId);
    return (nextWordId++).toString(16).padStart(8, "0");
  };
  for (const g of def.repeatGroups) {
    const source = rowNodes.get(g.rowId)!,
      meta = structure.rows.find((r) => r.id === g.rowId)!,
      values = input.input[g.fieldId] ?? [];
    if (!Array.isArray(values) || values.length > g.maxRows)
      fail("TEMPLATE_REPEAT_LIMIT", g.fieldId);
    const originalParagraphs = walk(source).filter(
      (n) => n.namespaceURI === ns && n.localName === "p",
    );
    const rows = values.length ? values : g.empty === "keep" ? [{}] : [];
    for (const rowValue of rows) {
      const clone = source.cloneNode(true) as Element,
        ps = walk(clone).filter(
          (n) => n.namespaceURI === ns && n.localName === "p",
        ),
        mapped = new Map<string, Element>();
      for (const [i, p] of ps.entries()) {
        if (input.format === "hwpx")
          p.setAttribute("id", String(nextParagraph++));
        for (const a of Array.from(p.attributes))
          if (["paraId", "textId"].includes(a.localName ?? ""))
            p.setAttributeNS(a.namespaceURI, a.name, wordId());
        expected.set(p, textOf(originalParagraphs[i]!, ns));
      }
      for (const id of meta.targetIds)
        mapped.set(id, ps[originalParagraphs.indexOf(nodes.get(id)!)]!);
      apply(g.bindings, rowValue as Record<string, unknown>, mapped);
      source.parentNode!.insertBefore(clone, source);
    }
    const table = source.parentNode as Element;
    table.removeChild(source);
    if (input.format === "hwpx") {
      const tableRows = elements(table).filter((n) => n.localName === "tr");
      table.setAttribute("rowCnt", String(tableRows.length));
      for (const [index, row] of tableRows.entries())
        for (const cell of elements(row).filter((n) => n.localName === "tc")) {
          const addr = elements(cell).find((n) => n.localName === "cellAddr");
          if (addr) addr.setAttribute("rowAddr", String(index));
        }
    }
    for (const id of meta.targetIds)
      changed.add(structure.targets.find((t) => t.id === id)!.part);
  }
  for (const part of changed) {
    const doc = opened.xml.get(part)!,
      beforeNodes = walk(doc).filter(
        (n) => n.namespaceURI === ns && n.localName === "p",
      );
    const wanted = beforeNodes.map((n) => expected.get(n) ?? textOf(n, ns));
    const serialized = serialize(doc),
      reparsed = parseXml(serialized),
      after = walk(reparsed).filter(
        (n) => n.namespaceURI === ns && n.localName === "p",
      );
    if (
      after.length !== wanted.length ||
      after.some((p, i) => textOf(p, ns) !== wanted[i])
    )
      fail("TEMPLATE_PRESERVATION_FAILED");
    opened.parts[part] = serialized;
  }
  if (input.format === "hwpx" && opened.parts["Preview/PrvText.txt"]) {
    opened.parts["Preview/PrvText.txt"] = strToU8(
      opened.bodyParts
        .flatMap((part) =>
          walk(opened.xml.get(part)!)
            .filter((n) => n.namespaceURI === ns && n.localName === "p")
            .map((p) => textOf(p, ns)),
        )
        .join("\n")
        .slice(0, 32000),
    );
  }
  for (const name of Object.keys(opened.parts)) {
    const blank = previewThumbnail(name);
    if (blank) opened.parts[name] = new Uint8Array(blank);
  }
  const bytes = zipSync(
    Object.fromEntries(
      Object.entries(opened.parts).map(([name, data]) => [
        name,
        [data, { mtime: new Date(2000, 0, 1, 0, 0, 0) }],
      ]),
    ),
    { level: 6 },
  );
  if (bytes.length > TEMPLATE_LIMITS.outputBytes) fail("TEMPLATE_OUTPUT_LIMIT");
  return {
    bytes,
    sourceHash: structure.sourceHash,
    outputHash: await digest(bytes),
    changes,
  };
}
