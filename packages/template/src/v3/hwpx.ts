import { attr, elements, type Element } from "../xml";
import { directV3, ensureV3 } from "./docx";
export function hwpxTableV3(
  table: Element,
  widths: number[],
  rowCount: number,
  totalHeight: number,
) {
  table.setAttribute("rowCnt", String(rowCount));
  table.setAttribute("colCnt", String(widths.length));
  table.setAttribute("pageBreak", "CELL");
  const size = directV3(table, "sz");
  if (size) {
    size.setAttribute("width", String(widths.reduce((n, w) => n + w, 0) * 5));
    size.setAttribute("height", String(totalHeight));
  }
}
export function hwpxCellV3(
  cell: Element,
  row: number,
  column: number,
  rowSpan: number,
  columnSpan: number,
  width: number,
  totalHeight: number,
  header: boolean,
) {
  const address = ensureV3(cell, "cellAddr"),
    span = ensureV3(cell, "cellSpan"),
    size = ensureV3(cell, "cellSz");
  address.setAttribute("rowAddr", String(row));
  address.setAttribute("colAddr", String(column));
  span.setAttribute("rowSpan", String(rowSpan));
  span.setAttribute("colSpan", String(columnSpan));
  size.setAttribute("width", String(width * 5));
  size.setAttribute("height", String(totalHeight));
  cell.setAttribute("header", header ? "1" : "0");
}
export function hwpxRowHeightV3(row: Element) {
  return Math.max(
    1,
    ...elements(row)
      .filter((n) => n.localName === "tc")
      .map((cell) => {
        const size = directV3(cell, "cellSz"),
          span = directV3(cell, "cellSpan");
        const rows = Math.max(1, Number(span && attr(span, "rowSpan")) || 1);
        return Math.ceil(
          Math.max(1, Number(size && attr(size, "height")) || 2000) / rows,
        );
      }),
  );
}
