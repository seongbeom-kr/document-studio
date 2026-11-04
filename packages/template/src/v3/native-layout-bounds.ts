type Box = { x: number; y: number; w: number; h: number };
type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue =>
  !!value && typeof value === "object" && !Array.isArray(value);
const key = (text: unknown, x: unknown, y: unknown, h: unknown) =>
  JSON.stringify([text, x, y, h]);

/** Native line boxes include invisible trailing advances and empty paragraph placeholders. */
export function checkNativeBoundsV3(
  tree: RecordValue,
  width: number,
  height: number,
  textLayout: unknown,
): void {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  )
    throw new Error("REPORT_LAYOUT_INVALID");
  const metrics = new Map<string, RecordValue | null>();
  if (record(textLayout) && Array.isArray(textLayout.runs)) {
    for (const run of textLayout.runs) {
      if (!record(run) || typeof run.text !== "string") continue;
      const id = key(run.text, run.x, run.y, run.h),
        prior = metrics.get(id);
      if (
        metrics.has(id) &&
        (!prior ||
          JSON.stringify([
            prior.charX,
            prior.underline,
            prior.strikethrough,
          ]) !== JSON.stringify([run.charX, run.underline, run.strikethrough]))
      )
        metrics.set(id, null);
      else metrics.set(id, run);
    }
  }
  function visibleBox(node: RecordValue, box: Box): Box | undefined {
    const text = node.text;
    if (typeof text !== "string") return box;
    if (text.length === 0) return undefined;
    const run = metrics.get(key(text, box.x, box.y, box.h));
    if (!run || run.underline || run.strikethrough) return box;
    if (!text.trim()) return undefined;
    const first = text.length - text.trimStart().length,
      last = text.trimEnd().length;
    if (first === 0 && last === text.length) return box;
    const positions = run.charX;
    if (
      !Array.isArray(positions) ||
      positions[0] !== 0 ||
      positions.some(
        (value, index) =>
          typeof value !== "number" ||
          !Number.isFinite(value) ||
          (index > 0 && value < positions[index - 1]),
      )
    )
      return box;
    let start: number, end: number;
    if (positions.length === text.length + 1) {
      start = first;
      end = last;
    } else if (positions.length === [...text].length + 1) {
      start = [...text.slice(0, first)].length;
      end = [...text.slice(0, last)].length;
    } else return box;
    return {
      ...box,
      x: box.x + positions[start],
      w: positions[end] - positions[start],
    };
  }
  function visit(node: RecordValue, cell?: Box): void {
    const type = String(node.type ?? ""),
      box = node.bbox as Box | undefined;
    if (box) {
      if (
        [box.x, box.y, box.w, box.h].some((value) => !Number.isFinite(value)) ||
        box.w < 0 ||
        box.h < 0
      )
        throw new Error("REPORT_LAYOUT_INVALID");
      const visible = type === "TextRun" ? visibleBox(node, box) : box;
      if (visible && ["TextRun", "Image", "Picture"].includes(type)) {
        if (
          visible.x < -0.75 ||
          visible.y < -0.75 ||
          visible.x + visible.w > width + 0.75 ||
          visible.y + visible.h > height + 0.75
        )
          throw new Error("REPORT_LAYOUT_OVERFLOW");
        if (
          cell &&
          (visible.x < cell.x - 0.75 ||
            visible.x + visible.w > cell.x + cell.w + 0.75 ||
            visible.y < cell.y - 0.75 ||
            visible.y + visible.h > cell.y + cell.h + 0.75)
        )
          throw new Error("REPORT_LAYOUT_OVERFLOW");
      }
      if (type === "Cell" || type === "TableCell") cell = box;
    }
    if (Array.isArray(node.children))
      for (const child of node.children) if (record(child)) visit(child, cell);
  }
  visit(tree);
}
