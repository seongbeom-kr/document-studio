import { expect, it } from "vitest";

const modulePath = new URL(
  "../../packages/template/src/v3/native-layout-bounds.ts",
  import.meta.url,
).href;
const cell = (text: string) => ({
  type: "Cell",
  bbox: { x: 0, y: 0, w: 10, h: 10 },
  children: [{ type: "TextRun", bbox: { x: 8, y: 1, w: 4, h: 3 }, text }],
});
const layout = (text: string, charX: number[], extra = {}) => ({
  runs: [{ text, x: 8, y: 1, w: 4, h: 3, charX, ...extra }],
});

it("uses recorded character advances to exclude trailing whitespace without hiding actual glyph overflow", async () => {
  const { checkNativeBoundsV3 } = await import(modulePath);
  expect(() =>
    checkNativeBoundsV3(cell("A "), 100, 100, layout("A ", [0, 1, 4])),
  ).not.toThrow();
  expect(() =>
    checkNativeBoundsV3(cell("AB"), 100, 100, layout("AB", [0, 1, 4])),
  ).toThrow("REPORT_LAYOUT_OVERFLOW");
  expect(() => checkNativeBoundsV3(cell("A "), 100, 100, { runs: [] })).toThrow(
    "REPORT_LAYOUT_OVERFLOW",
  );
  expect(() =>
    checkNativeBoundsV3(
      cell("A "),
      100,
      100,
      layout("A ", [0, 1, 4], { underline: true }),
    ),
  ).toThrow("REPORT_LAYOUT_OVERFLOW");
});

it("ignores empty line placeholders while still rejecting visible out-of-page text and images", async () => {
  const { checkNativeBoundsV3 } = await import(modulePath);
  const node = {
    type: "TextRun",
    text: "",
    bbox: { x: 50, y: 1, w: 90, h: 4 },
  };
  expect(() => checkNativeBoundsV3(node, 100, 100, { runs: [] })).not.toThrow();
  expect(() =>
    checkNativeBoundsV3({ ...node, text: "visible" }, 100, 100, { runs: [] }),
  ).toThrow("REPORT_LAYOUT_OVERFLOW");
  expect(() =>
    checkNativeBoundsV3({ ...node, type: "Image" }, 100, 100, { runs: [] }),
  ).toThrow("REPORT_LAYOUT_OVERFLOW");
});

it("accepts exact UTF-16 or scalar advances for emoji and rejects ambiguous metrics", async () => {
  const { checkNativeBoundsV3 } = await import(modulePath);
  for (const advances of [
    [0, 0, 1, 4],
    [0, 1, 4],
  ])
    expect(() =>
      checkNativeBoundsV3(cell("😀 "), 100, 100, layout("😀 ", advances)),
    ).not.toThrow();
  const a = layout("A ", [0, 1, 4]).runs[0];
  expect(() =>
    checkNativeBoundsV3(cell("A "), 100, 100, {
      runs: [a, { ...a, charX: [0, 3, 4] }],
    }),
  ).toThrow("REPORT_LAYOUT_OVERFLOW");
});

it("rejects incomplete or non-finite geometry even when a text placeholder is empty", async () => {
  const { checkNativeBoundsV3 } = await import(modulePath);
  expect(() =>
    checkNativeBoundsV3(
      { type: "TextRun", text: "", bbox: { y: 0, w: 1, h: 1 } },
      100,
      100,
      { runs: [] },
    ),
  ).toThrow("REPORT_LAYOUT_INVALID");
  expect(() =>
    checkNativeBoundsV3(cell("A"), Number.NaN, 100, { runs: [] }),
  ).toThrow("REPORT_LAYOUT_INVALID");
});
