import { attr, elements, walk, type Element } from "./xml";
import { type TemplateFormat } from "./types";
const positive = (value: string | undefined, fallback = 1) =>
  value === undefined
    ? fallback
    : /^[0-9]+$/.test(value) && Number(value) > 0 && Number(value) <= 1000
      ? Number(value)
      : NaN;
export function cellColumn(
  cell: Element,
  row: Element,
  format: TemplateFormat,
): number {
  if (format === "hwpx") {
    const position = elements(cell).find((n) => n.localName === "cellAddr"),
      column = position && attr(position, "colAddr");
    if (column !== undefined && /^[0-9]+$/.test(column))
      return Number(column) + 1;
  }
  let column = 1;
  if (format === "docx") {
    const properties=elements(row).find(n=>n.localName==="trPr");
    const before = properties && elements(properties).find((n) => n.localName === "gridBefore");
    if (before) column += Number(attr(before, "val") ?? 0);
  }
  for (const prior of elements(row).filter((n) => n.localName === "tc")) {
    if (prior === cell) break;
    const span =
      format === "hwpx"
        ? elements(prior).find((n) => n.localName === "cellSpan")
        : elements(elements(prior).find(n=>n.localName==="tcPr")??prior).find((n) => n.localName === "gridSpan");
    column += positive(
      span ? attr(span, format === "hwpx" ? "colSpan" : "val") : undefined,
    );
  }
  return column;
}
export function hwpxGridValid(table: Element): boolean {
  const rows = elements(table).filter((n) => n.localName === "tr"),
    width = positive(attr(table, "colCnt"));
  if (
    !Number.isInteger(width) ||
    rows.length > 1000 ||
    Number(attr(table, "rowCnt")) !== rows.length
  )
    return false;
  const occupied = new Set<number>();
  for (const [ri, row] of rows.entries())
    for (const cell of elements(row).filter((n) => n.localName === "tc")) {
      const address = elements(cell).find((n) => n.localName === "cellAddr"),
        span = elements(cell).find((n) => n.localName === "cellSpan");
      const r = address ? Number(attr(address, "rowAddr")) : ri,
        c = cellColumn(cell, row, "hwpx") - 1,
        rs = positive(span ? attr(span, "rowSpan") : undefined),
        cs = positive(span ? attr(span, "colSpan") : undefined);
      if (
        r !== ri ||
        !Number.isInteger(c) ||
        c < 0 ||
        !Number.isInteger(rs) ||
        !Number.isInteger(cs) ||
        r + rs > rows.length ||
        c + cs > width
      )
        return false;
      for (let y = r; y < r + rs; y++)
        for (let x = c; x < c + cs; x++) {
          const key = y * width + x;
          if (occupied.has(key)) return false;
          occupied.add(key);
        }
    }
  return occupied.size === rows.length * width;
}
export function crossedByMerge(
  table: Element,
  row: Element,
  format: TemplateFormat,
): boolean {
  if (format !== "hwpx") return false; // DOCX continuations live in the crossed row and are checked there.
  if (!hwpxGridValid(table)) return true;
  const rows = elements(table).filter((n) => n.localName === "tr"),
    index = rows.indexOf(row);
  return rows.some(
    (r, ri) =>
      ri <= index &&
      elements(r)
        .filter((n) => n.localName === "tc")
        .some((cell) => {
          const span = elements(cell).find((n) => n.localName === "cellSpan"),
            height = positive(span ? attr(span, "rowSpan") : undefined);
          return height > 1 && ri + height > index;
        }),
  );
}
