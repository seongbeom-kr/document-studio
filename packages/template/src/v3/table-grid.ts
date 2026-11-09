import type { TablePlanV3 } from "./types";

/** Covered positions have no separate value: merging must never discard text. */
export function validPlanGridV3(
  plan: TablePlanV3,
  headerRows: number,
): boolean {
  const height = plan.rows.length,
    width = plan.columns.length,
    occupied = new Set<number>(),
    covered = new Set<number>();
  for (const merge of plan.merges) {
    const { row, column, rowSpan, columnSpan } = merge;
    if (
      row + rowSpan > height ||
      column + columnSpan > width ||
      rowSpan * columnSpan < 2 ||
      (row < headerRows && row + rowSpan > headerRows)
    )
      return false;
    const group = plan.rows[row]?.groupKey;
    if (
      rowSpan > 1 &&
      (!group ||
        plan.rows.slice(row, row + rowSpan).some((r) => r.groupKey !== group))
    )
      return false;
    for (let r = row; r < row + rowSpan; r++)
      for (let c = column; c < column + columnSpan; c++) {
        const key = r * width + c;
        if (occupied.has(key)) return false;
        occupied.add(key);
        if (r !== row || c !== column) covered.add(key);
      }
  }
  const cells = new Set<number>();
  for (const [r, row] of plan.rows.entries())
    for (const cell of row.cells) {
      const c = plan.columns.findIndex(
          (column) => column.key === cell.columnKey,
        ),
        key = r * width + c;
      if (c < 0 || cells.has(key) || covered.has(key)) return false;
      cells.add(key);
    }
  if (cells.size + covered.size !== height * width) return false;
  for (const key of occupied)
    if (!covered.has(key) && !cells.has(key)) return false;
  return true;
}

/** Reserve reviewed minima first; distribute remaining source width without shrinking fonts. */
export function allocateColumnWidthsV3(
  total: number,
  minima: number[],
  weights: number[],
): number[] {
  const remaining = total - minima.reduce((sum, n) => sum + n, 0),
    weight = weights.reduce((sum, n) => sum + n, 0);
  if (remaining < 0 || !weight) throw new Error("REPORT_TABLE_WIDTH_EXCEEDED");
  const result = minima.map(
    (n, i) => n + Math.floor((remaining * weights[i]!) / weight),
  );
  let rest = total - result.reduce((sum, n) => sum + n, 0);
  for (let i = 0; rest > 0; i = (i + 1) % result.length, rest--) result[i]!++;
  return result;
}
