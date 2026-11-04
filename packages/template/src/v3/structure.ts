import { inspectInternal } from "../structure";
import {
  attr,
  elements,
  walk,
  parent,
  NS,
  textOf,
  digest,
  type Element,
  type Node,
} from "../xml";
import { cellColumn } from "../table-grid";
import { fail, type TemplateFormat } from "../types";
import { digestV3, validateContractV3 } from "./contract";
import { createStyleRegistryV3 } from "./styles";
import { previewThumbnail } from "../preview-cache";
import type {
  SourceAddressV3,
  SourceIdentityV3,
  SourceTableV3,
  TemplateStructureV3,
  TemplateRegionV3,
  PageBaselineV3,
  SourceCellV3,
  DigestV3,
} from "./types";

export function sourcePathV3(node: Node): number[] {
  if (!node.parentNode) return [];
  const step = elements(node.parentNode).indexOf(node as Element);
  return node.parentNode.nodeType === 9
    ? [step]
    : [...sourcePathV3(node.parentNode), step];
}
export function sourceNodeV3(root: Node, address: SourceAddressV3): Element {
  let at = root;
  for (const index of address.path) {
    const next = elements(at)[index];
    if (!next) fail("TEMPLATE_SELECTION_STALE");
    at = next;
  }
  return at as Element;
}
const child = (node: Element, name: string) =>
  elements(node).find(
    (n) => n.namespaceURI === node.namespaceURI && n.localName === name,
  );
const number = (value?: string, fallback = 0) =>
  value !== undefined &&
  /^\d+$/.test(value) &&
  Number.isSafeInteger(Number(value))
    ? Number(value)
    : fallback;
const disabled = {
  rowChanges: false,
  columnChanges: false,
  merges: false,
  paragraphRepeat: false,
};

function pageOf(all: Element[], format: TemplateFormat): PageBaselineV3 {
  const node = all.find(
    (n) =>
      n.namespaceURI === NS[format] &&
      n.localName === (format === "docx" ? "sectPr" : "pagePr"),
  );
  if (!node) fail("TEMPLATE_PAGE_UNSUPPORTED");
  const size = format === "docx" ? child(node, "pgSz") : node;
  const margin = child(node, format === "docx" ? "pgMar" : "margin");
  if (!size || !margin) fail("TEMPLATE_PAGE_UNSUPPORTED");
  const units = format === "hwpx" ? 5 : 1;
  let width = Math.round(
      number(attr(size, format === "docx" ? "w" : "width")) / units,
    ),
    height = Math.round(
      number(attr(size, format === "docx" ? "h" : "height")) / units,
    );
  if (
    format === "hwpx" &&
    attr(size, "landscape") === "WIDELY" &&
    width < height
  )
    [width, height] = [height, width];
  if (!width || !height) fail("TEMPLATE_PAGE_UNSUPPORTED");
  return {
    width,
    height,
    marginTop: Math.round(number(attr(margin, "top")) / units),
    marginRight: Math.round(number(attr(margin, "right")) / units),
    marginBottom: Math.round(number(attr(margin, "bottom")) / units),
    marginLeft: Math.round(number(attr(margin, "left")) / units),
    orientation: width > height ? "landscape" : "portrait",
  };
}

export async function inspectV3Internal(input: {
  bytes: Uint8Array;
  format: TemplateFormat;
  identity: SourceIdentityV3;
}) {
  const {
    opened,
    nodes: legacyNodes,
    structure: legacy,
  } = await inspectInternal(input);
  if (input.identity.normalizedHash !== (await digest(input.bytes)))
    fail("TEMPLATE_SELECTION_STALE");
  if (
    !/^sha256:[0-9a-f]{64}$/.test(input.identity.sourceHash) ||
    !Number.isSafeInteger(input.identity.structureRevision) ||
    input.identity.structureRevision < 1
  )
    fail("TEMPLATE_SELECTION_IDENTITY");
  const registry = createStyleRegistryV3(),
    regions: TemplateRegionV3[] = [],
    nodes = new Map<string, Element>();
  const legacyTargets = new Map(legacy.targets.map((t) => [t.id, t]));
  const targetByNode = new Map(
    [...legacyNodes].map(([id, node]) => [node, legacyTargets.get(id)!]),
  );
  const all = opened.bodyParts.flatMap((part) => walk(opened.xml.get(part)!));
  const page = pageOf(all, input.format),
    ns = NS[input.format];
  const nodeIds = new Map<Element, string>();
  for (const part of opened.bodyParts)
    for (const node of walk(opened.xml.get(part)!))
      if (
        node.namespaceURI === ns &&
        ["p", "tbl", "tr", "tc"].includes(node.localName ?? "")
      )
        nodeIds.set(
          node,
          (
            await digestV3({
              normalizedHash: input.identity.normalizedHash,
              part,
              path: sourcePathV3(node),
            })
          ).slice(7, 39),
        );
  const idFor = (_part: string, node: Element, prefix = "region") =>
    `${prefix}_${nodeIds.get(node)!}`;
  const tableIds = new Map<Element, string>();
  for (const part of opened.bodyParts)
    for (const node of walk(opened.xml.get(part)!).filter(
      (n) => n.namespaceURI === ns && n.localName === "tbl",
    ))
      tableIds.set(node, idFor(part, node));
  for (const part of opened.bodyParts)
    for (const node of walk(opened.xml.get(part)!)) {
      if (
        node.namespaceURI !== ns ||
        !["p", "tbl"].includes(node.localName ?? "")
      )
        continue;
      const id = idFor(part, node),
        address = { part, path: sourcePathV3(node) },
        tableParent = parent(node, "tbl", ns);
      const styleKind = node.localName === "tbl" ? "table" : "paragraph";
      const styleId = await registry.add(
        styleKind,
        node,
        child(node, node.localName === "tbl" ? "tblPr" : "pPr"),
      );
      const region: TemplateRegionV3 = {
        id,
        kind: node.localName === "tbl" ? "table" : "text",
        address,
        text: node.localName === "p" ? textOf(node, ns) : "",
        styleIds: [styleId],
        editable: true,
        capabilities: { ...disabled },
        ...(tableParent ? { parentId: tableIds.get(tableParent)! } : {}),
      };
      if (region.kind === "text") {
        const target = targetByNode.get(node)!;
        region.editable = target.editable;
        if (target.reason) region.reason = target.reason;
        region.capabilities.paragraphRepeat =
          target.editable &&
          !tableParent &&
          !walk(node).some(
            (n) =>
              n.namespaceURI === ns &&
              ["secPr", "sectPr", "colPr"].includes(n.localName ?? ""),
          );
        let offset = 0;
        region.textRuns = [];
        for (const run of elements(node).filter(
          (n) =>
            n.namespaceURI === ns &&
            n.localName === (input.format === "docx" ? "r" : "run"),
        )) {
          const text = textOf(run, ns),
            runStyle = await registry.add("run", run, child(run, "rPr"));
          region.styleIds.push(runStyle);
          if (text.length)
            region.textRuns.push({
              start: offset,
              end: offset + text.length,
              styleId: runStyle,
            });
          offset += text.length;
        }
        // Other inline containers are protected by the legacy safety check.
      } else {
        const rows = elements(node).filter(
          (n) => n.namespaceURI === ns && n.localName === "tr",
        );
        if (rows.length > 1000) fail("TEMPLATE_STRUCTURE_LIMIT");
        const table: SourceTableV3 = {
          rows: [],
          columns: [],
          headerRows: 0,
          styleIds: [styleId],
        };
        let valid = true,
          widths: number[] = [],
          previous = new Map<number, SourceCellV3>();
        if (input.format === "docx")
          widths = elements(child(node, "tblGrid") ?? node)
            .filter((n) => n.localName === "gridCol")
            .map((n) => number(attr(n, "w")));
        else
          widths = Array.from(
            { length: number(attr(node, "colCnt")) },
            () => 0,
          );
        for (const [ri, row] of rows.entries()) {
          const cells: SourceCellV3[] = [],
            next = new Map<number, SourceCellV3>();
          if (
            input.format === "docx"
              ? !!child(child(row, "trPr") ?? row, "tblHeader")
              : elements(row).some((tc) => attr(tc, "header") === "1")
          ) {
            if (table.headerRows === ri) table.headerRows++;
          }
          for (const cell of elements(row).filter(
            (n) => n.namespaceURI === ns && n.localName === "tc",
          )) {
            const column = cellColumn(cell, row, input.format) - 1,
              pr = child(cell, "tcPr"),
              span =
                input.format === "docx"
                  ? pr && child(pr, "gridSpan")
                  : child(cell, "cellSpan"),
              merge = pr && child(pr, "vMerge");
            const columnSpan = number(
                span && attr(span, input.format === "docx" ? "val" : "colSpan"),
                1,
              ),
              rowSpan =
                input.format === "docx"
                  ? 1
                  : number(span && attr(span, "rowSpan"), 1);
            if (merge && attr(merge, "val") !== "restart") {
              const anchor = previous.get(column);
              if (!anchor || anchor.columnSpan !== columnSpan) valid = false;
              else {
                anchor.rowSpan++;
                next.set(column, anchor);
              }
              continue;
            }
            const cellStyle = await registry.add("cell", cell, pr);
            const value: SourceCellV3 = {
              id: idFor(part, cell, "cell"),
              address: { part, path: sourcePathV3(cell) },
              row: ri,
              column,
              rowSpan,
              columnSpan,
              text: walk(cell)
                .filter(
                  (n) =>
                    n.namespaceURI === ns &&
                    n.localName === "p" &&
                    parent(n, "tc", ns) === cell,
                )
                .map((p) => textOf(p, ns))
                .join("\n"),
              styleIds: [cellStyle],
            };
            cells.push(value);
            if (merge) next.set(column, value);
            if (input.format === "hwpx") {
              const sz = child(cell, "cellSz"),
                w = Math.round(
                  number(sz && attr(sz, "width")) / 5 / columnSpan,
                );
              for (let c = column; c < column + columnSpan; c++)
                if (!widths[c]) widths[c] = w;
            }
          }
          table.rows.push({ id: idFor(part, row, "row"), cells });
          previous = next;
        }
        const columns = Math.max(
          widths.length,
          ...table.rows.flatMap((r) =>
            r.cells.map((c) => c.column + c.columnSpan),
          ),
        );
        if (columns > 64) fail("TEMPLATE_STRUCTURE_LIMIT");
        const occupied = new Set<number>();
        for (const row of table.rows)
          for (const cell of row.cells) {
            if (
              cell.rowSpan < 1 ||
              cell.columnSpan < 1 ||
              cell.row + cell.rowSpan > rows.length ||
              cell.column < 0
            )
              valid = false;
            for (let r = cell.row; r < cell.row + cell.rowSpan; r++)
              for (
                let c = cell.column;
                c < cell.column + cell.columnSpan;
                c++
              ) {
                const k = r * columns + c;
                if (occupied.has(k)) valid = false;
                occupied.add(k);
              }
          }
        valid &&= occupied.size === rows.length * columns && columns > 0;
        const hasWidths =
          widths.length === columns && widths.every((w) => w > 0);
        table.columns = Array.from({ length: columns }, (_, i) => ({
          key: `column_${i}`,
          width:
            widths[i] ||
            Math.max(
              1,
              Math.floor(
                (page.width - page.marginLeft - page.marginRight) /
                  Math.max(1, columns),
              ),
            ),
        }));
        region.table = table;
        region.text = table.rows
          .map((r) => r.cells.map((c) => c.text).join("\t"))
          .join("\n");
        const unsafe = walk(node).some((n) =>
          [
            "tbl",
            "drawing",
            "pict",
            "object",
            "pic",
            "ctrl",
            "fldChar",
            "sdt",
            "ins",
            "del",
            "hyperlink",
            "bookmarkStart",
            "commentRangeStart",
            "footnoteReference",
          ].includes(n.localName ?? ""),
        );
        const reason = tableParent
          ? "중첩 표는 보존만 지원합니다."
          : unsafe
            ? "그림·필드·중첩 구조가 있는 표는 보존만 지원합니다."
            : !valid
              ? "표의 병합 격자를 확인할 수 없습니다."
              : !hasWidths
                ? "원본 열 너비를 확인할 수 없습니다."
                : undefined;
        if (reason) {
          region.editable = false;
          region.reason = reason;
        } else
          region.capabilities = {
            rowChanges: true,
            columnChanges: true,
            merges: true,
            paragraphRepeat: false,
          };
      }
      region.styleIds = [...new Set(region.styleIds)];
      regions.push(region);
      nodes.set(id, node);
    }
  // Section properties and every non-body package part remain protected.
  for (const node of all.filter(
    (n) =>
      n.namespaceURI === ns && ["sectPr", "secPr"].includes(n.localName ?? ""),
  ))
    await registry.add("section", node, node);
  const protectedParts: Record<string, DigestV3> = {};
  for (const [part, bytes] of Object.entries(opened.parts))
    if (
      !opened.bodyParts.includes(part) &&
      part !== "Preview/PrvText.txt" &&
      !previewThumbnail(part)
    )
      protectedParts[part] = (await digest(bytes)) as DigestV3;
  const structure: TemplateStructureV3 = {
    schemaVersion: 3,
    identity: { ...input.identity },
    format: input.format,
    regions,
    styles: [...registry.styles.values()],
    page,
    protectedParts,
    warnings: [
      ...new Set(regions.filter((r) => r.reason).map((r) => r.reason!)),
    ],
  };
  validateContractV3("structure", structure);
  return { structure, opened, nodes, legacyNodes };
}
export async function inspectTemplateV3(input: {
  bytes: Uint8Array;
  format: TemplateFormat;
  identity: SourceIdentityV3;
}): Promise<TemplateStructureV3> {
  return (await inspectV3Internal(input)).structure;
}
