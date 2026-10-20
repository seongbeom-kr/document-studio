import { expect, it } from "vitest";
import { questionPosition } from "../../packages/react/src/question-position";
const host = { left: 100, top: 80, right: 900, bottom: 780 };
it("attaches below the selected text instead of the host corner", () => {
  expect(
    questionPosition(
      [{ left: 200, top: 200, right: 400, bottom: 230 }],
      host,
      400,
      180,
    ),
  ).toEqual({ left: 100, top: 158, attached: true });
});
it("flips above and clamps horizontally near the host edge", () => {
  expect(
    questionPosition(
      [{ left: 800, top: 700, right: 850, bottom: 730 }],
      host,
      400,
      180,
    ),
  ).toEqual({ left: 392, top: 432, attached: true });
});
it("docks when the target is offscreen or geometry is invalid", () => {
  const rects = [
    { left: NaN, top: 100, right: 400, bottom: 200 },
    { left: 200, top: -200, right: 400, bottom: -100 },
  ];
  expect(questionPosition(rects, host, 400, 180)).toEqual({
    left: 392,
    top: 512,
    attached: false,
  });
});
