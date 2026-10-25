import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";

for (const format of ["docx", "hwpx"] as const) {
  test(`${format}: self-hosted font pack, shared agent diagnostics and original font names`, async ({
    page,
  }) => {
    const external: string[] = [];
    await page.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (
        ["http:", "https:"].includes(url.protocol) &&
        url.hostname !== "127.0.0.1" &&
        url.hostname !== "localhost"
      ) {
        external.push(url.origin);
        return route.abort();
      }
      return route.continue();
    });
    await page.goto("/harness.html");
    await page.evaluate(
      (format) => window.documentStudioTest.load(format, `rich.${format}`),
      format,
    );
    await expect
      .poll(() => page.evaluate(() => window.documentStudioTest.state()?.ready))
      .toBe(true);
    await expect
      .poll(() =>
        page.evaluate(() => window.documentStudioTest.state()?.fonts?.ready),
      )
      .toBe(true);
    const state = await page.evaluate(() => window.documentStudioTest.state()!);
    const context = await page.evaluate(() =>
      window.documentStudioTest.agent.getContext(),
    );
    expect(context.fonts).toEqual(state.fonts);
    expect(state.fonts!.failures).toEqual([]);
    expect(state.dirty).toBe(false);
    await page.locator(".ds-font-status-trigger").click();
    await expect(page.locator(".ds-font-status-panel")).toContainText(
      "원래 글꼴명은 유지",
    );
    await expect(page.getByRole("dialog", { name: "문서 글꼴" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "문서 글꼴" })).toBeHidden();
    const original = unzipSync(await readFile(`fixtures/rich.${format}`));
    const exported = unzipSync(
      new Uint8Array(
        await page.evaluate(() => window.documentStudioTest.export()),
      ),
    );
    const fontPath =
      format === "docx" ? "word/document.xml" : "Contents/header.xml";
    const pattern =
      format === "docx"
        ? /w:(?:ascii|eastAsia|hAnsi)="([^"]+)"/g
        : /face="([^"]+)"/g;
    const before = [...strFromU8(original[fontPath]!).matchAll(pattern)].map(
      (match) => match[1],
    );
    const after = strFromU8(exported[fontPath]!);
    for (const name of before) expect(after).toContain(name!);
    expect(external).toEqual([]);
    if (format === "hwpx") {
      const loaded = await page
        .locator("iframe")
        .first()
        .contentFrame()
        .locator("body")
        .evaluate(() =>
          [...document.fonts]
            .filter((font) => font.family.startsWith("Noto"))
            .map((font) => [font.family, font.weight, font.status]),
        );
      expect(loaded).toHaveLength(5);
      expect(loaded.every((face) => face[2] === "loaded")).toBe(true);
    }
  });
  test(`${format}: missing font assets are visible and never reported as ready`, async ({
    page,
  }) => {
    await page.route("**/editor-assets/fonts/*.ttf", (route) =>
      route.fulfill({ status: 404, body: "missing" }),
    );
    await page.goto("/harness.html");
    await page.evaluate(
      (format) => window.documentStudioTest.load(format, `blank.${format}`),
      format,
    );
    await expect
      .poll(() => page.evaluate(() => window.documentStudioTest.state()?.ready))
      .toBe(true);
    await expect
      .poll(() =>
        page.evaluate(() => window.documentStudioTest.state()?.fonts?.ready),
      )
      .toBe(false);
    await expect(page.locator(".ds-font-status-trigger")).toHaveText(
      "글꼴 자산 확인 필요",
    );
    await page.locator(".ds-font-status-trigger").click();
    await expect(page.locator(".ds-font-status-panel")).toContainText("404");
  });
}
