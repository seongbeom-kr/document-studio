/** CSS pixels, matching the engines' physical page dimensions at 100% zoom. */
export function fitPageWidth(
  viewportWidth: number,
  pageWidthMm?: number,
): number | undefined {
  if (
    !Number.isFinite(viewportWidth) ||
    viewportWidth <= 64 ||
    !pageWidthMm ||
    !Number.isFinite(pageWidthMm) ||
    pageWidthMm <= 0
  )
    return;
  return Math.max(
    0.25,
    Math.min(
      3,
      Math.floor(((viewportWidth - 64) / ((pageWidthMm * 96) / 25.4)) * 100) /
        100,
    ),
  );
}
