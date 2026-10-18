import { expect, test } from "@playwright/test";

for (const format of ["docx", "hwpx"] as const) {
  for (const width of [320, 355, 390, 560]) {
    test(`${format}/${width}: all toolbar actions fit while document zoom remains100%`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto("/harness.html?questions=1");
      await page.waitForFunction(() => Boolean(window.documentStudioTest));
      await page.evaluate(async (format) => {
        window.documentStudioTest.embedded = true;
        await window.documentStudioTest.load(format, `blank.${format}`);
      }, format);
      await expect
        .poll(() =>
          page.evaluate(() => window.documentStudioTest.state()?.ready),
        )
        .toBe(true);
      const toolbar = page.getByRole("toolbar", {
        name: "문서 서식",
        exact: true,
      });
      const geometry = await toolbar.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return {
          viewport: document.documentElement.clientWidth,
          scroll: document.documentElement.scrollWidth,
          box: { left: box.left, right: box.right },
          items: Array.from(
            element.querySelectorAll("button,input,select"),
          ).map((item) => {
            const rect = item.getBoundingClientRect();
            return {
              label: item.getAttribute("aria-label") ?? item.textContent,
              left: rect.left,
              right: rect.right,
            };
          }),
        };
      });
      expect(geometry.scroll).toBeLessThanOrEqual(geometry.viewport + 1);
      for (const item of geometry.items) {
        expect(
          item.left,
          item.label ?? "toolbar control",
        ).toBeGreaterThanOrEqual(geometry.box.left - 1);
        expect(item.right, item.label ?? "toolbar control").toBeLessThanOrEqual(
          geometry.box.right + 1,
        );
      }
      await expect(
        toolbar.getByRole("button", { name: "이 단락 질문", exact: true }),
      ).toBeVisible();
      await toolbar.getByRole("button", { name: "찾기", exact: true }).click();
      await expect(
        page.getByRole("tab", { name: "찾기와 바꾸기", exact: true }),
      ).toHaveAttribute("aria-selected", "true");
      expect(
        await page.evaluate(() => window.documentStudioTest.state()?.zoom),
      ).toBe(1);
    });
  }
}
