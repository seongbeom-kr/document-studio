import { expect, test } from "@playwright/test";
for (const format of ["docx", "hwpx"] as const) {
  test(`${format}: mobile fit is offered but only applied on request`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/harness.html");
    await page.waitForFunction(() => window.documentStudioTest);
    await page.evaluate(
      (format) => window.documentStudioTest.load(format),
      format,
    );
    await expect
      .poll(() => page.evaluate(() => window.documentStudioTest.state()?.ready))
      .toBe(true);
    await expect
      .poll(() => page.evaluate(() => window.documentStudioTest.state()?.zoom))
      .toBe(1);
    await page
      .getByRole("button", {
        name: "좁은 화면: 페이지 너비에 맞춤",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("combobox", { name: "확대", exact: true }),
    ).toHaveValue("width");
    await expect
      .poll(() => page.evaluate(() => window.documentStudioTest.state()?.zoom))
      .toBeLessThan(1);
    expect(
      await page.evaluate(() => window.documentStudioTest.state()?.dirty),
    ).toBe(false);
  });
  for (const readOnly of [false, true]) {
    test(`${format}: a narrow embedded ${readOnly ? "readonly" : "editable"} view opens at 100% and keeps manual zoom on rerender`, async ({
      page,
    }) => {
      await page.goto("/harness.html");
      await page.waitForFunction(() => window.documentStudioTest);
      await page.evaluate(
        async ({ format, readOnly }) => {
          const api = window.documentStudioTest;
          api.embedded = true;
          api.readOnly = readOnly;
          await api.load(format);
          (
            document.querySelector("[data-test-host]") as HTMLElement
          ).style.maxWidth = "700px";
        },
        { format, readOnly },
      );
      await expect
        .poll(() =>
          page.evaluate(() => window.documentStudioTest.state()?.ready),
        )
        .toBe(true);
      await expect
        .poll(() =>
          page.evaluate(() => window.documentStudioTest.state()?.zoom),
        )
        .toBe(1);
      expect(
        await page.evaluate(() => window.documentStudioTest.state()?.dirty),
      ).toBe(false);
      if (!readOnly) {
        await page.getByLabel("확대", { exact: true }).selectOption("75");
        await expect
          .poll(() =>
            page.evaluate(() => window.documentStudioTest.state()?.zoom),
          )
          .toBe(0.75);
      }
      await page.evaluate(() => {
        (
          document.querySelector("[data-test-host]") as HTMLElement
        ).style.maxWidth = "990px";
        window.documentStudioTest.rerender();
      });
      await expect(page.getByLabel("확대", { exact: true })).toHaveValue(
        readOnly ? "100" : "75",
      );
      expect(
        await page.evaluate(() => window.documentStudioTest.state()?.dirty),
      ).toBe(false);
      if (readOnly)
        await expect(
          page.getByRole("button", { name: "굵게", exact: true }),
        ).toBeDisabled();
    });
  }
}
