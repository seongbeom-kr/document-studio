import type { QuestionRect } from "@document-studio/core";

/** Place below the visible selection, above when necessary, inside the host. */
export function questionPosition(
  rects: readonly QuestionRect[],
  host: QuestionRect,
  width: number,
  height: number,
) {
  const gap = 8;
  const visible = rects.filter(
    (r) =>
      [r.left, r.top, r.right, r.bottom].every(Number.isFinite) &&
      r.right > r.left &&
      r.bottom > r.top &&
      r.bottom > host.top &&
      r.top < host.bottom &&
      r.right > host.left &&
      r.left < host.right,
  );
  const maxLeft = Math.max(gap, host.right - host.left - width - gap);
  const maxTop = Math.max(gap, host.bottom - host.top - height - gap);
  if (!visible.length) return { left: maxLeft, top: maxTop, attached: false };
  const anchor = visible[visible.length - 1]!;
  const below = anchor.bottom - host.top + gap;
  const above = anchor.top - host.top - height - gap;
  return {
    left: Math.max(gap, Math.min(maxLeft, anchor.left - host.left)),
    top: Math.max(gap, Math.min(maxTop, below <= maxTop ? below : above)),
    attached: true,
  };
}
