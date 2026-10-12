import { expect, it } from "vitest";
import { fitPageWidth } from "../../packages/react/src/fit-page-width";

it.each([210, 297, 148])(
  "fits a %s mm page inside the usable width",
  (widthMm) => {
    const zoom = fitPageWidth(768, widthMm)!;
    expect(((widthMm * 96) / 25.4) * zoom).toBeLessThanOrEqual(704);
    expect(((widthMm * 96) / 25.4) * (zoom + 0.01)).toBeGreaterThan(704);
  },
);
it("respects engine zoom limits", () => {
  expect(fitPageWidth(100, 210)).toBe(0.25);
  expect(fitPageWidth(4000, 210)).toBe(3);
});
it.each([
  [0, 210],
  [64, 210],
  [768, 0],
  [768, undefined],
  [NaN, 210],
  [768, Infinity],
])("does not guess missing page geometry %j", (width, page) => {
  expect(fitPageWidth(width!, page)).toBeUndefined();
});
