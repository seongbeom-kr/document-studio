import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { PNG } from "pngjs";
import init, { HwpDocument } from "../../third_party/rhwp-core/rhwp.js";

let hwpx: number[], hwp: number[];
test.beforeAll(async () => {
  await init({
    module_or_path: await readFile("third_party/rhwp-core/rhwp_bg.wasm"),
  });
  const bytes = await readFile("fixtures/paragraph-overlay.hwpx");
  hwpx = [...bytes];
  const doc = new HwpDocument(bytes);
  try {
    hwp = [...doc.exportHwp()];
  } finally {
    doc.free();
  }
});
async function ready(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const state = window.documentStudioTest.state();
        return state?.ready && state.fonts?.ready;
      }),
    )
    .toBe(true);
}
for (const format of ["hwpx", "hwp"] as const) {
  test(`${format}: inline table does not displace overlay paint or selection, including zoom and saved reopen`, async ({
    page,
  }, info) => {
    await page.goto("/harness.html");
    await page.waitForFunction(() => Boolean(window.documentStudioTest));
    await page.evaluate(
      ({ bytes, format }) => window.documentStudioTest.loadBytes(bytes, format),
      { bytes: format === "hwpx" ? hwpx : hwp, format },
    );
    await ready(page);
    const frame = page.frameLocator("iframe");
    const canvas = frame.locator("canvas.document-page-canvas").first();
    for (const zoom of [1, 0.75, 1.25]) {
      await page
        .getByRole("combobox", { name: "확대", exact: true })
        .selectOption(String(zoom * 100));
      await expect
        .poll(() =>
          page.evaluate(() => window.documentStudioTest.state()?.zoom),
        )
        .toBe(zoom);
      // Zoom intentionally retains the current scroll/caret position. Bring the
      // page top into the viewport before measuring this top-of-page marker.
      await frame.locator("#scroll-container").evaluate((el) => {
        el.scrollTop = 0;
      });
      // Front pictures occupy a separate overlay canvas. Check the final paint.
      await expect
        .poll(async () => {
          const box = (await canvas.boundingBox())!;
          const png = PNG.sync.read(await page.screenshot({ scale: "css" }));
          let sum = 0,
            count = 0;
          for (
            let y = Math.max(0, Math.ceil(box.y));
            y < Math.min(png.height, box.y + box.height);
            y++
          )
            for (
              let x = Math.max(0, Math.ceil(box.x));
              x < Math.min(png.width, box.x + box.width);
              x++
            ) {
              const i = (y * png.width + x) * 4;
              if (
                png.data[i + 1]! > 120 &&
                png.data[i + 1]! > png.data[i]! * 2 &&
                png.data[i + 1]! > png.data[i + 2]! * 2
              ) {
                sum += y;
                count++;
              }
            }
          return count ? Math.abs((sum / count - box.y) / zoom - 117.6) : 1e5;
        })
        .toBeLessThan(1.5);
      await canvas.click({
        position: { x: (126.7 + 120) * zoom, y: (105.6 + 12) * zoom },
      });
      await expect
        .poll(async () =>
          frame.locator(".table-object-layer > div").evaluateAll(
            (elements) =>
              elements.filter((el) => {
                const bounds = el.getBoundingClientRect();
                return (
                  bounds.width > 100 && bounds.height > 10 && bounds.height < 40
                );
              }).length,
          ),
        )
        .toBe(1);
      const canvasBox = await canvas.evaluate((el) => {
        const b = el.getBoundingClientRect();
        return { x: b.x, y: b.y };
      });
      const borders = await frame
        .locator(".table-object-layer > div")
        .evaluateAll((elements) =>
          elements
            .map((el) => {
              const b = el.getBoundingClientRect();
              return { x: b.x, y: b.y, w: b.width, h: b.height };
            })
            .filter((b) => b.w > 100 && b.h > 10 && b.h < 40),
        );
      expect(borders[0]!.y - canvasBox.y).toBeCloseTo(105.6 * zoom, 0);
      expect(borders[0]!.x - canvasBox.x).toBeCloseTo(126.7 * zoom, 0);
      await page.keyboard.press("Escape");
    }
    await page.screenshot({
      path: info.outputPath(`${format}-paragraph-overlay.png`),
    });
    await page.evaluate(() => window.documentStudioTest.save());
    const bytes = await page.evaluate(() => window.documentStudioTest.saved);
    const saved = new HwpDocument(new Uint8Array(bytes));
    try {
      const image = JSON.parse(saved.getPageControlLayout(0)).controls.find(
        (c: { type: string }) => c.type === "image",
      );
      expect(image.y).toBeCloseTo(105.6, 1);
    } finally {
      saved.free();
    }
    await page.evaluate(
      ({ bytes, format }) => window.documentStudioTest.loadBytes(bytes, format),
      { bytes, format },
    );
    await ready(page);
  });
}
