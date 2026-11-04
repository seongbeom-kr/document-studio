import { NS, elements, type Element } from "../xml";
export function directV3(node: Element, name: string) {
  return elements(node).find(
    (n) => n.namespaceURI === node.namespaceURI && n.localName === name,
  );
}
export function ensureV3(node: Element, name: string) {
  let n = directV3(node, name);
  if (!n) {
    n = node.ownerDocument!.createElementNS(
      node.namespaceURI,
      `${node.prefix}:${name}`,
    );
    if (
      node.namespaceURI === NS.docx &&
      ["tblPr", "trPr", "tcPr"].includes(name)
    )
      node.insertBefore(n, node.firstChild);
    else if (node.namespaceURI === NS.docx && name === "tblGrid")
      node.insertBefore(
        n,
        elements(node).find((child) => child.localName === "tr") ?? null,
      );
    else node.appendChild(n);
  }
  return n;
}
export function wordAttrV3(
  node: Element,
  name: string,
  value: string | number,
) {
  node.setAttributeNS(NS.docx, `${node.prefix}:${name}`, String(value));
}
export function docxTableV3(table: Element, widths: number[]) {
  const grid = ensureV3(table, "tblGrid");
  while (grid.firstChild) grid.removeChild(grid.firstChild);
  for (const width of widths) {
    const col = table.ownerDocument!.createElementNS(
      NS.docx,
      `${table.prefix}:gridCol`,
    );
    wordAttrV3(col, "w", width);
    grid.appendChild(col);
  }
  const width = ensureV3(ensureV3(table, "tblPr"), "tblW");
  wordAttrV3(
    width,
    "w",
    widths.reduce((n, w) => n + w, 0),
  );
  wordAttrV3(width, "type", "dxa");
}
export function docxRowV3(row: Element, header: boolean) {
  const pr = ensureV3(row, "trPr");
  for (const node of elements(pr))
    if (["tblHeader", "cantSplit"].includes(node.localName ?? ""))
      pr.removeChild(node);
  const height = directV3(pr, "trHeight");
  if (height) wordAttrV3(height, "hRule", "atLeast");
  if (header) ensureV3(pr, "tblHeader");
}
export function docxCellV3(
  cell: Element,
  width: number,
  rowSpan: number,
  columnSpan: number,
  continuation: boolean,
) {
  const pr = ensureV3(cell, "tcPr");
  for (const n of elements(pr))
    if (["gridSpan", "vMerge"].includes(n.localName ?? "")) pr.removeChild(n);
  const w = ensureV3(pr, "tcW");
  wordAttrV3(w, "w", width);
  wordAttrV3(w, "type", "dxa");
  if (columnSpan > 1) wordAttrV3(ensureV3(pr, "gridSpan"), "val", columnSpan);
  if (rowSpan > 1) {
    const merge = ensureV3(pr, "vMerge");
    wordAttrV3(merge, "val", continuation ? "continue" : "restart");
  }
}
