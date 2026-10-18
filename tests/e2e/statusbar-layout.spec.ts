import { expect, test } from "@playwright/test";

for (const format of ["docx", "hwpx"]) {
  for (const host of ["browser", "react"]) {
    test(`${host}/${format}: external status controls fit their host and resizing preserves the document`, async ({
      page,
    }) => {
      await page.goto(`/ui-harness.html?format=${format}&host=${host}`);
      await page.waitForFunction(() => Boolean(window.uiStudioTest));
      await page.evaluate(() => window.uiStudioTest.mount());
      await expect
        .poll(() => page.evaluate(() => window.uiStudioTest.state().ready))
        .toBe(true);
      const before = await page.evaluate(() => window.uiStudioTest.state());
      const footer = page.locator("#bottom .ds-document-footer");
      const zoom = footer.getByRole("combobox", { name: "확대", exact: true });
      for (const width of [277, 341, 390, 480, 1366]) {
        await page.setViewportSize({ width, height: 900 });
        await expect(zoom).toHaveValue("100");
        if (width < 600)
          await expect(
            footer.getByRole("button", {
              name: "좁은 화면: 페이지 너비에 맞춤",
              exact: true,
            }),
          ).toBeVisible();
        await expect
          .poll(
            async () =>
              footer.evaluate((element) => {
                const box = element.getBoundingClientRect();
                const controls = Array.from(
                  element.querySelectorAll("button,select"),
                );
                return (
                  document.documentElement.scrollWidth <=
                    document.documentElement.clientWidth + 1 &&
                  controls.every((control) => {
                    const rect = control.getBoundingClientRect();
                    return (
                      rect.left >= box.left - 1 &&
                      rect.right <= box.right + 1 &&
                      rect.top >= box.top - 1 &&
                      rect.bottom <= box.bottom + 1
                    );
                  })
                );
              }),
            {
              message: `${host}/${format}/${width}: footer controls stay inside the host`,
            },
          )
          .toBe(true);
        await zoom.selectOption("125");
        await expect
          .poll(() => page.evaluate(() => window.uiStudioTest.state().zoom))
          .toBe(1.25);
        await zoom.selectOption("100");
        await expect
          .poll(() => page.evaluate(() => window.uiStudioTest.state().zoom))
          .toBe(1);
      }
      await page.setViewportSize({ width: 277, height: 900 });
      await footer
        .getByRole("button", {
          name: "좁은 화면: 페이지 너비에 맞춤",
          exact: true,
        })
        .click();
      await expect(zoom).toHaveValue("width");
      await expect
        .poll(() => page.evaluate(() => window.uiStudioTest.state().zoom))
        .toBeLessThan(1);
      await zoom.selectOption("100");
      await expect
        .poll(() => page.evaluate(() => window.uiStudioTest.state().zoom))
        .toBe(1);
      // Move the same status region back into the editor; wrapping must also
      // avoid clipping when the editor has a constrained height.
      await page.evaluate(() =>
        window.uiStudioTest.ui({
          containers: {
            toolbar: document.getElementById("top")!,
            tools: document.getElementById("side")!,
          },
        }),
      );
      const internal = page.locator("#editor .ds-document-footer");
      await expect(
        internal.getByRole("combobox", { name: "확대", exact: true }),
      ).toHaveValue("100");
      const internalGeometry = await internal.evaluate((element) => {
        const footer = element.getBoundingClientRect();
        const editor = element.closest(".ds-editor")!.getBoundingClientRect();
        return Array.from(element.querySelectorAll("button,select")).every(
          (control) => {
            const box = control.getBoundingClientRect();
            return (
              box.left >= footer.left - 1 &&
              box.right <= footer.right + 1 &&
              box.top >= footer.top - 1 &&
              box.bottom <= footer.bottom + 1 &&
              box.bottom <= editor.bottom + 1
            );
          },
        );
      });
      expect(internalGeometry).toBe(true);
      const after = await page.evaluate(() => window.uiStudioTest.state());
      expect(after.sessionId).toBe(before.sessionId);
      expect(after.revision).toBe(before.revision);
      expect(after.dirty).toBe(false);
    });
  }
}
