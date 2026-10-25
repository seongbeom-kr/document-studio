import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import init, { HwpDocument } from "../../third_party/rhwp-core/rhwp.js";
import { strFromU8, unzipSync } from "fflate";

const sample = "한글 글머리 ⦁ ∙ • ☞ ※ □ ○ ① Ⅰ";
let fixture: number[];
test.beforeAll(async () => {
  await init({ module_or_path: await readFile("third_party/rhwp-core/rhwp_bg.wasm") });
  const doc = new HwpDocument(await readFile("fixtures/blank.hwpx"));
  try {
    const count = doc.getParagraphLength(0, 0);
    doc.insertText(0, 0, 0, sample);
    doc.deleteText(0, 0, [...sample].length, count);
    fixture = [...doc.exportHwpx()];
  } finally { doc.free(); }
});

test("CanvasKit resolves original U+2981 through the shipped symbol face and preserves text", async ({ page }) => {
  const requested: string[] = [];
  page.on("request", request => {
    if (/NotoSans(Symbols2|KR)-Regular\.ttf$/.test(request.url())) requested.push(request.url());
  });
  await page.goto("/rhwp-font-probe.html");
  await page.waitForFunction(() => Boolean(window.rhwpFontProbe));
  await page.evaluate(bytes => window.rhwpFontProbe.load(bytes, "symbols.hwpx"), fixture);
  await expect.poll(async () => {
    const diagnostic = await page.evaluate(() => window.rhwpFontProbe.diagnostics());
    return JSON.stringify(diagnostic);
  }).toContain("missingGlyphSymbol");
  const diagnostic = await page.evaluate(() => window.rhwpFontProbe.diagnostics());
  expect(diagnostic.effectiveBackend).toBe("canvaskit");
  expect(requested.some(url => url.endsWith("NotoSansSymbols2-Regular.ttf"))).toBe(true);
  expect(requested.some(url => url.endsWith("NotoSansKR-Regular.ttf"))).toBe(true);
  const output = unzipSync(new Uint8Array(await page.evaluate(() => window.rhwpFontProbe.export())));
  expect(strFromU8(output["Contents/section0.xml"]!)).toContain(sample);
  await page.screenshot({ path: ".build/report-agent-20261025/symbols-canvaskit.png" });
  await page.evaluate(() => window.rhwpFontProbe.dispose());
});
