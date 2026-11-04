import { zipSync, strToU8 } from "fflate";
import {
  digest,
  NS,
  elements,
  walk,
  textOf,
  serialize,
  attr,
  type Element,
} from "../xml";
import { writeRange } from "../render";
import { previewThumbnail } from "../preview-cache";
import { inspectV3Internal, sourceNodeV3 } from "./structure";
import { canonicalV3, digestV3 } from "./contract";
import { validateRenderPlanV3 } from "./plan";
import { tableLayoutV3, prototypeNodeV3 } from "./layout";
import { directV3, docxTableV3, docxCellV3, docxRowV3 } from "./docx";
import { hwpxTableV3, hwpxCellV3, hwpxRowHeightV3 } from "./hwpx";
import { verifyWorkingDocumentV3 } from "./verify";
import type {
  DigestV3,
  TemplateStructureV3,
  TemplateDefinitionV3,
  ValidatedPlanV3,
} from "./types";
export interface RenderInputV3 {
  values: Record<string, unknown>;
  evidenceRefs: string[];
  sourceSnapshotDigest: DigestV3;
}
export async function renderTemplateV3(input: {
  bytes: Uint8Array;
  structure: TemplateStructureV3;
  definition: TemplateDefinitionV3;
  input: RenderInputV3;
  validatedPlan: ValidatedPlanV3;
}) {
  const state = await inspectV3Internal({
    bytes: input.bytes,
    format: input.structure.format,
    identity: input.structure.identity,
  });
  if (canonicalV3(state.structure) !== canonicalV3(input.structure))
    throw new Error("TEMPLATE_SELECTION_STALE");
  const validated = await validateRenderPlanV3({
    structure: state.structure,
    definition: input.definition,
    plan: input.validatedPlan.plan,
    inputDigest: await digestV3(input.input.values),
    sourceSnapshotDigest: input.input.sourceSnapshotDigest,
    evidenceRefs: input.input.evidenceRefs,
  });
  if (validated.planDigest !== input.validatedPlan.planDigest)
    throw new Error("REPORT_PLAN_DIGEST_MISMATCH");
  const format = state.structure.format,
    ns = NS[format],
    parts = new Set<string>();
  const ids = new Set<string>();
  let nextId = 1;
  for (const doc of state.opened.xml.values())
    for (const n of walk(doc))
      for (const a of Array.from(n.attributes))
        if (["id", "paraId", "textId"].includes(a.localName ?? ""))
          ids.add(a.value);
  const fresh = (hex = false) => {
    let id: string;
    do {
      id = hex ? (nextId++).toString(16).padStart(8, "0") : String(nextId++);
    } while (ids.has(id));
    ids.add(id);
    return id;
  };
  const renew = (node: Element) => {
    for (const p of [node, ...walk(node)].filter(
      (n) => n.namespaceURI === ns && n.localName === "p",
    )) {
      if (format === "hwpx") p.setAttribute("id", fresh());
      for (const a of Array.from(p.attributes))
        if (["paraId", "textId"].includes(a.localName ?? ""))
          p.setAttributeNS(a.namespaceURI, a.name, fresh(true));
    }
  };
  const fillCell = (cell: Element, text: string) => {
    const paragraphs = walk(cell).filter(
      (n) => n.namespaceURI === ns && n.localName === "p",
    );
    for (const p of paragraphs.slice(1)) p.parentNode!.removeChild(p);
    const p = paragraphs[0];
    if (!p) throw new Error("REPORT_INVALID_PROTOTYPE");
    writeRange(p, 0, textOf(p, ns).length, text, format);
    renew(cell);
  };
  const textGroups = new Map<
    Element,
    Array<{ start: number; end: number; text: string }>
  >();
  for (const p of validated.plan.regions) {
    const d = input.definition.regions.find((r) => r.id === p.regionId)!,
      source = state.structure.regions.find((r) => r.id === d.sourceRegionId)!,
      node = state.nodes.get(source.id)!;
    parts.add(source.address.part);
    if (p.kind === "text") {
      textGroups.set(node, [
        ...(textGroups.get(node) ?? []),
        {
          start: d.range?.start ?? 0,
          end: d.range?.end ?? source.text.length,
          text: p.text,
        },
      ]);
    } else if (p.kind === "paragraphRepeat") {
      const items = p.items.length
        ? p.items.map((i) => i.text)
        : d.policy.empty === "remove"
          ? []
          : [""];
      for (const text of items) {
        const copy = node.cloneNode(true) as Element;
        writeRange(copy, 0, source.text.length, text, format);
        renew(copy);
        node.parentNode!.insertBefore(copy, node);
      }
      node.parentNode!.removeChild(node);
    } else {
      const layout = tableLayoutV3(p, d, source, state.structure),
        plan = layout.plan;
      if (!plan.rows.length) {
        node.parentNode!.removeChild(node);
        continue;
      }
      const copy = node.cloneNode(true) as Element;
      for (const r of elements(copy).filter(
        (n) => n.namespaceURI === ns && n.localName === "tr",
      ))
        copy.removeChild(r);
      const sourceRows = elements(node).filter(
          (n) => n.namespaceURI === ns && n.localName === "tr",
        ),
        doc = state.opened.xml.get(source.address.part)!;
      const baseCell = prototypeNodeV3(
          doc,
          source,
          d,
          layout.headerRows,
          0,
          plan,
        ),
        height = hwpxRowHeightV3(baseCell);
      if (format === "docx") docxTableV3(copy, layout.widths);
      else hwpxTableV3(copy, layout.widths, plan.rows.length, height);
      for (const [ri, row] of plan.rows.entries()) {
        const prototype =
            sourceRows[
              ri < layout.headerRows
                ? ri
                : (d.prototypeRow ??
                  Math.min(source.table!.headerRows, sourceRows.length - 1))
            ]!,
          tr = prototype.cloneNode(true) as Element;
        for (const c of elements(tr).filter(
          (n) => n.namespaceURI === ns && n.localName === "tc",
        ))
          tr.removeChild(c);
        if (format === "docx") docxRowV3(tr, ri < layout.headerRows);
        for (let ci = 0; ci < plan.columns.length; ci++) {
          const merge = plan.merges.find(
              (m) =>
                ri >= m.row &&
                ri < m.row + m.rowSpan &&
                ci >= m.column &&
                ci < m.column + m.columnSpan,
            ),
            covered = merge && (ri !== merge.row || ci !== merge.column),
            continuation = !!merge && ri > merge.row && ci === merge.column;
          if (covered && !(format === "docx" && continuation)) continue;
          const cell = prototypeNodeV3(doc, source, d, ri, ci, plan).cloneNode(
              true,
            ) as Element,
            rs = merge?.rowSpan ?? 1,
            cs = merge?.columnSpan ?? 1;
          const width = layout.widths
              .slice(ci, ci + cs)
              .reduce((n, w) => n + w, 0),
            value = continuation
              ? ""
              : (row.cells.find((c) => c.columnKey === plan.columns[ci]!.key)
                  ?.text ?? "");
          fillCell(cell, value);
          if (format === "docx") docxCellV3(cell, width, rs, cs, continuation);
          else
            hwpxCellV3(
              cell,
              ri,
              ci,
              rs,
              cs,
              width,
              height,
              ri < layout.headerRows,
            );
          tr.appendChild(cell);
        }
        copy.appendChild(tr);
      }
      node.parentNode!.replaceChild(copy, node);
    }
  }
  for (const [node, changes] of textGroups)
    for (const change of changes.sort((a, b) => b.start - a.start))
      writeRange(node, change.start, change.end, change.text, format);
  for (const part of parts)
    state.opened.parts[part] = serialize(state.opened.xml.get(part)!);
  if (format === "hwpx" && state.opened.parts["Preview/PrvText.txt"])
    state.opened.parts["Preview/PrvText.txt"] = strToU8(
      state.opened.bodyParts
        .flatMap((part) =>
          walk(state.opened.xml.get(part)!)
            .filter((n) => n.namespaceURI === ns && n.localName === "p")
            .map((n) => textOf(n, ns)),
        )
        .join("\n")
        .slice(0, 32000),
    );
  for (const name of Object.keys(state.opened.parts)) {
    const blank = previewThumbnail(name);
    if (blank) state.opened.parts[name] = new Uint8Array(blank);
  }
  const bytes = zipSync(
    Object.fromEntries(
      Object.entries(state.opened.parts).map(([name, data]) => [
        name,
        [data, { mtime: new Date(2000, 0, 1) }],
      ]),
    ),
    { level: 6 },
  );
  if (bytes.length > 64 * 1024 * 1024) throw new Error("TEMPLATE_OUTPUT_LIMIT");
  return {
    bytes,
    proof: await verifyWorkingDocumentV3({
      source: input.bytes,
      output: bytes,
      definition: input.definition,
      validatedPlan: validated,
    }),
  };
}
