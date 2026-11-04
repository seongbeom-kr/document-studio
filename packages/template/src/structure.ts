import {
  attr,
  elements,
  walk,
  parent,
  NS,
  openArchive,
  digest,
  textOf,
  type Element,
} from "./xml";
import {
  TEMPLATE_LIMITS,
  fail,
  type TemplateFormat,
  type TemplateStructure,
  type TemplateTarget,
  type TemplateRow,
} from "./types";
const unsafe = new Set([
  "drawing",
  "pict",
  "object",
  "fldChar",
  "instrText",
  "fldSimple",
  "ins",
  "del",
  "sdt",
  "hyperlink",
  "txbxContent",
  "tbl",
  "pic",
  "rect",
  "ellipse",
  "line",
  "shape",
  "ctrl",
  "equation",
  "container",
]);
function safety(p: Element, ns: string, preservePageNumberReset = false) {
  const columnProperties = (node: Element) => {
    if (node.namespaceURI !== NS.hwpx || node.localName !== "ctrl")
      return false;
    const children = elements(node);
    if (
      preservePageNumberReset &&
      children.length === 1 &&
      children[0]!.namespaceURI === NS.hwpx &&
      children[0]!.localName === "newNum" &&
      attr(children[0]!, "numType") === "PAGE" &&
      /^[1-9]\d{0,4}$/.test(attr(children[0]!, "num") ?? "") &&
      Number(attr(children[0]!, "num")) <= 65535 &&
      elements(children[0]!).length === 0 &&
      Array.from(children[0]!.attributes).every((attribute) =>
        ["num", "numType"].includes(attribute.name),
      )
    )
      return true;
    return (
      children.length === 1 &&
      children[0]!.namespaceURI === NS.hwpx &&
      children[0]!.localName === "colPr" &&
      walk(children[0]!).every(
        (child) =>
          child.namespaceURI === NS.hwpx &&
          ["colSz", "colLine"].includes(child.localName ?? ""),
      )
    );
  };
  if (
    walk(p).some((n) => unsafe.has(n.localName ?? "") && !columnProperties(n))
  )
    return "문단 안의 표·개체·필드 구조는 보존만 지원합니다.";
  for (let at = p.parentNode; at && at.nodeType !== 9; at = at.parentNode) {
    const n = at as Element;
    if (
      [
        "ins",
        "del",
        "sdt",
        "fldSimple",
        "txbxContent",
        "drawing",
        "pict",
        "ctrl",
        "subList",
      ].includes(n.localName ?? "") &&
      !(n.localName === "subList" && parent(n, "tc", ns))
    )
      return "도형·필드·추적 변경 내부는 보존만 지원합니다.";
  }
  const table = parent(p, "tbl", ns);
  if (table && parent(table, "tbl", ns))
    return "중첩 표 내부는 보존만 지원합니다.";
  if (
    walk(p).some(
      (n) =>
        n.namespaceURI === ns &&
        (["tab", "columnBreak", "pageBreak"].includes(n.localName ?? "") ||
          (n.localName === "br" &&
            attr(n, "type") !== undefined &&
            attr(n, "type") !== "textWrapping")),
    )
  )
    return "탭·페이지 구분이 포함된 문단의 직접 치환은 아직 지원하지 않습니다.";
  return undefined;
}
import { cellColumn, crossedByMerge } from "./table-grid";
export async function inspectInternal(
  input: {
    bytes: Uint8Array;
    format: TemplateFormat;
  },
  options: { preservePageNumberReset?: boolean } = {},
) {
  const { bytes, format } = input,
    opened = openArchive(bytes, format),
    sourceHash = await digest(bytes),
    ns = NS[format];
  const targets: TemplateTarget[] = [],
    rows: TemplateRow[] = [];
  const nodes = new Map<string, Element>(),
    rowNodes = new Map<string, Element>();
  opened.bodyParts.forEach((part, partIndex) => {
    const doc = opened.xml.get(part)!,
      all = walk(doc),
      tables = all.filter(
        (n) => n.namespaceURI === ns && n.localName === "tbl",
      );
    const rowIds = new Map<Element, string>();
    tables.forEach((table, ti) => {
      const tableId = `table_${partIndex}_${ti}_${sourceHash.slice(7, 23)}`;
      elements(table)
        .filter((n) => n.namespaceURI === ns && n.localName === "tr")
        .forEach((row, ri) => {
          const id = `row_${partIndex}_${ti}_${ri}_${sourceHash.slice(7, 23)}`;
          const cells = elements(row).filter((n) => n.localName === "tc");
          const forbidden = walk(row).some(
            (n) =>
              [
                "vMerge",
                "gridSpan",
                "drawing",
                "pict",
                "object",
                "fldChar",
                "instrText",
                "sdt",
                "ins",
                "del",
                "pic",
                "tbl",
                "ctrl",
                "bookmarkStart",
                "bookmarkEnd",
                "commentRangeStart",
                "commentRangeEnd",
                "commentReference",
                "footnoteReference",
                "endnoteReference",
                "permStart",
                "permEnd",
                "hyperlink",
              ].includes(n.localName ?? "") ||
              (n.localName === "cellSpan" &&
                (attr(n, "rowSpan") !== "1" || attr(n, "colSpan") !== "1")),
          );
          const repeatable =
            !forbidden &&
            !crossedByMerge(table, row, format) &&
            !parent(table, "tbl", ns) &&
            cells.length > 0;
          rows.push({
            id,
            tableId,
            address: `${partIndex + 1}구역 ${ti + 1}번 표 ${ri + 1}행`,
            targetIds: [],
            repeatable,
            ...(!repeatable
              ? { reason: "병합·개체·중첩 표가 있는 행은 반복할 수 없습니다." }
              : {}),
          });
          rowNodes.set(id, row);
          rowIds.set(row, id);
        });
    });
    all
      .filter((n) => n.namespaceURI === ns && n.localName === "p")
      .forEach((p, pi) => {
        const id = `target_${partIndex}_${pi}_${sourceHash.slice(7, 23)}`;
        const row = parent(p, "tr", ns),
          cell = parent(p, "tc", ns),
          rowId = row && rowIds.get(row),
          meta = rows.find((r) => r.id === rowId);
        const reason = safety(p, ns, options.preservePageNumberReset),
          column = row && cell ? cellColumn(cell, row, format) : undefined;
        const address = meta
          ? `${meta.address} ${column}열 문단`
          : `${partIndex + 1}구역 ${pi + 1}번 문단`;
        targets.push({
          id,
          kind: "text",
          part,
          text: textOf(p, ns),
          address,
          editable: !reason,
          ...(reason ? { reason } : {}),
          ...(meta ? { rowId, tableId: meta.tableId, column } : {}),
        });
        nodes.set(id, p);
        meta?.targetIds.push(id);
        if (targets.length > TEMPLATE_LIMITS.targets)
          fail("TEMPLATE_STRUCTURE_LIMIT");
      });
  });
  if (!targets.length) fail("TEMPLATE_NO_TARGETS");
  const structure: TemplateStructure = {
    schemaVersion: 2,
    sourceHash,
    format,
    targets,
    rows,
    warnings: targets.some((t) => !t.editable)
      ? ["일부 개체는 그대로 보존됩니다. 작성 위치별 지원 여부를 확인하세요."]
      : [],
  };
  return { structure, opened, nodes, rowNodes };
}
export async function inspectTemplate(input: {
  bytes: Uint8Array;
  format: TemplateFormat;
}): Promise<TemplateStructure> {
  return (await inspectInternal(input)).structure;
}
