import { expect, test } from "@playwright/test";

for (const resize of [false, true]) {
  test(`HWPX saved close/reopen ten times, resizing during boot: ${resize}`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(300_000);
    const diagnostics: unknown[] = [];
    page.on("console", (message) => {
      if (message.type() === "error")
        diagnostics.push({ console: message.text() });
    });
    page.on("requestfailed", (request) =>
      diagnostics.push({
        url: request.url(),
        error: request.failure()?.errorText,
      }),
    );
    try {
      await page.goto("/harness.html");
      await page.waitForFunction(() => !!window.documentStudioTest);
      await page.evaluate(() =>
        window.documentStudioTest.load("hwpx", "blank.hwpx"),
      );
      await expect
        .poll(
          () => page.evaluate(() => window.documentStudioTest.state()?.ready),
          { timeout: 35000 },
        )
        .toBe(true);
      await page.evaluate(async () => {
        const host = window.documentStudioTest;
        await host.execute({
          id: "insertText",
          value: "재열기 보존 표식 20261018",
        });
        await host.save();
      });
      const bytes = await page.evaluate(
        () => window.documentStudioTest.savedEvent!.bytes,
      );
      for (let index = 0; index < 10; index++) {
        await page.evaluate(() => window.documentStudioTest.closeAfterDraft());
        await expect(page.locator("iframe")).toHaveCount(0);
        await page.setViewportSize({ width: 1366, height: 900 });
        await page.evaluate(
          (bytes) => window.documentStudioTest.loadBytes(bytes, "hwpx"),
          bytes,
        );
        await expect(page.locator("iframe")).toHaveCount(1);
        if (resize) {
          await page.setViewportSize({ width: 429, height: 990 });
          await page.setViewportSize({ width: 390, height: 900 });
        }
        await expect
          .poll(
            () => page.evaluate(() => window.documentStudioTest.state()?.ready),
            { timeout: 35000 },
          )
          .toBe(true);
        const result = await page.evaluate(async () => {
          const agent = window.documentStudioTest.agent;
          return agent.readDocument({
            documentId: agent.getState().documentId,
          });
        });
        expect(result.text).toContain("재열기 보존 표식 20261018");
        diagnostics.push({ iteration: index + 1, ready: true, resize });
      }
    } finally {
      diagnostics.push({
        finalState: await page
          .evaluate(() => window.documentStudioTest?.state())
          .catch(() => null),
      });
      await testInfo.attach("reconnection-diagnostics", {
        body: JSON.stringify(diagnostics, null, 2),
        contentType: "application/json",
      });
    }
  });
}
