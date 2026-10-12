import { expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import { unzipSync } from "fflate";
import {
  imageDimensions,
  fitImage,
  validateCommand,
} from "../../packages/core/src/index";
test("image preflight reads a real PNG and honors typed-array offsets", async () => {
  const zip = unzipSync(new Uint8Array(await readFile("fixtures/rich.docx")));
  const image =
    zip[Object.keys(zip).find((name) => /^word\/media\/.*\.png$/.test(name))!]!;
  const padded = new Uint8Array(image.length + 7);
  padded.set(image, 7);
  expect(imageDimensions(padded.subarray(7), "image/png")).toEqual(
    imageDimensions(image, "image/png"),
  );
});
test("agent image commands reject an oversized decompressed image before decoding", () => {
  const header = new Uint8Array(24);
  header.set([137, 80, 78, 71]);
  header.set([73, 72, 68, 82], 12);
  const view = new DataView(header.buffer);
  view.setUint32(16, 20000);
  view.setUint32(20, 20000);
  expect(() =>
    validateCommand({
      id: "insertImage",
      value: { bytes: header, mimeType: "image/png" },
    }),
  ).toThrow("화소");
});
test("image fitting keeps portrait and landscape ratios and never enlarges a legal original", () => {
  for (const dimensions of [
    { width: 1200, height: 600 },
    { width: 600, height: 1200 },
  ]) {
    const size = fitImage(dimensions, 100);
    expect(size.widthMm).toBeLessThanOrEqual(100);
    expect(size.widthMm / size.heightMm).toBeCloseTo(
      dimensions.width / dimensions.height,
      8,
    );
  }
  const original = fitImage({ width: 96, height: 48 }, 160);
  expect(original.widthMm).toBeCloseTo(25.4, 10);
  expect(original.heightMm).toBeCloseTo(12.7, 10);
});
test("JPEG preflight reads SOF bounds and refuses truncated segments", () => {
  const jpeg = new Uint8Array([
    255, 216, 255, 192, 0, 8, 8, 0, 48, 0, 96, 1, 255, 217,
  ]);
  expect(imageDimensions(jpeg, "image/jpeg")).toEqual({
    width: 96,
    height: 48,
  });
  expect(() => imageDimensions(jpeg.subarray(0, 9), "image/jpeg")).toThrow();
});
test("GIF preflight checks every frame budget and truncated sub-blocks", () => {
  const gif = Uint8Array.from(
    Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64"),
  );
  expect(imageDimensions(gif, "image/gif")).toEqual({ width: 1, height: 1 });
  expect(() =>
    imageDimensions(gif.subarray(0, gif.length - 2), "image/gif"),
  ).toThrow();
  const animation = new Uint8Array([
    71,
    73,
    70,
    56,
    57,
    97,
    1,
    0,
    1,
    0,
    0,
    0,
    0,
    ...Array.from({ length: 41 }, () => [
      44, 0, 0, 0, 0, 232, 3, 232, 3, 0, 2, 1, 0, 0,
    ]).flat(),
    59,
  ]);
  expect(() => imageDimensions(animation, "image/gif")).toThrow("프레임");
});
test("fit rejects unavailable body width and invalid dimensions", () => {
  expect(() => fitImage({ width: 0, height: 1 }, 160)).toThrow();
  expect(() => fitImage({ width: 10, height: 10 }, NaN)).toThrow();
  const tiny = fitImage({ width: 1, height: 1 }, 160);
  expect(tiny).toEqual({ widthMm: 1, heightMm: 1 });
});
