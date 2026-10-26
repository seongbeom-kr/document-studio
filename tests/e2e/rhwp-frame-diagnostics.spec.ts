import { expect, test } from "@playwright/test";

for (const fault of ["html", "boot-script", "detached-parent"] as const) {
  test(`HWPX timeout distinguishes ${fault} before removing its frame`, async ({
    page,
  }) => {
    let release!: () => void;
    const stalled = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/editor-assets/rhwp/index.html?*", async (route) => {
      if (fault === "html") {
        await stalled;
        await route.abort().catch(() => undefined);
        return;
      }
      await route.fulfill({
        contentType: "text/html",
        body: '<!doctype html><head><script src="./document-studio-boot.js"></script></head>',
      });
    });
    await page.route(
      "**/editor-assets/rhwp/document-studio-boot.js",
      async (route) => {
        await stalled;
        await route.abort().catch(() => undefined);
      },
    );
    try {
      await page.goto("/harness.html?rhwpInitializationTimeoutMs=4000");
      await page.waitForFunction(() => Boolean(window.documentStudioTest));
      await page.evaluate(() => {
        window.documentStudioTest.draftsDisabled = true;
        return window.documentStudioTest.load("hwpx", "blank.hwpx");
      });
      await expect(page.locator("iframe")).toHaveCount(1);
      if (fault === "detached-parent") {
        // Detach the host-owned React root, leaving React's own child ownership intact.
        await page.locator("#root").evaluate((root) => root.remove());
      }
      await expect
        .poll(() =>
          page.evaluate(
            () => window.documentStudioTest.state()?.initialization?.status,
          ),
        )
        .toBe("failed");
      const state = await page.evaluate(
        () => window.documentStudioTest.state()?.initialization,
      );
      if (state?.status !== "failed") throw new Error("Expected a timeout");
      const diagnostics = state.error.diagnostics!;
      expect(diagnostics.stage).toBe("iframe-loading");
      expect(diagnostics.observations?.at(-1)?.event).toBe("frame-timeout");
      expect(diagnostics.frame).toEqual(
        fault === "html"
          ? {
              connected: true,
              containerConnected: true,
              navigation: "initial-blank",
              documentReadyState: "complete",
              bootScript: "absent",
            }
          : fault === "boot-script"
            ? {
                connected: true,
                containerConnected: true,
                navigation: "expected-runtime",
                documentReadyState: "loading",
                bootScript: "present-no-completion",
              }
            : {
                connected: false,
                containerConnected: false,
                navigation: "unavailable",
                documentReadyState: "unavailable",
                bootScript: "unavailable",
              },
      );
      await expect(page.locator("iframe")).toHaveCount(0);
    } finally {
      release();
    }
  });
}
