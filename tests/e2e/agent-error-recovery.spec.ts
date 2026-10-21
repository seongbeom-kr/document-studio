import { expect, test } from "@playwright/test";
for (const format of ["docx", "hwpx"] as const) {
  test(`${format}: public tool failures preserve search and input recovery without changing the document`, async ({
    page,
  }) => {
    await page.goto("/harness.html");
    await page.waitForFunction(() => window.documentStudioTest);
    await page.evaluate(
      (format) => window.documentStudioTest.load(format),
      format,
    );
    await expect
      .poll(() => page.evaluate(() => window.documentStudioTest.state()?.ready))
      .toBe(true);
    const results = await page.evaluate(async () => {
      const host = window.documentStudioTest,
        tools = host.createSessionTools();
      const before = host.agent.getState();
      const context = (await tools.invoke("getState", {})).context!;
      const failures = [];
      for (const [method, input] of [
        [
          "select",
          { contextRef: context.contextRef, matchId: "missing-search-result" },
        ],
        [
          "previewQuickAction",
          {
            contextRef: context.contextRef,
            action: {
              kind: "date",
              baseDate: "2026-02-30",
              period: "today",
              week: "calendar",
              format: "iso",
            },
          },
        ],
      ] as const) {
        try {
          await tools.invoke(method, input);
          failures.push({ unexpectedSuccess: true });
        } catch (error) {
          failures.push(host.agentToolFailure(error));
        }
      }
      const after = host.agent.getState();
      tools.dispose();
      return {
        failures,
        before: { revision: before.revision, dirty: before.dirty },
        after: { revision: after.revision, dirty: after.dirty },
      };
    });
    expect(results.failures).toMatchObject([
      {
        code: "search-result-expired",
        effect: "none",
        requiredAction: "search-again",
      },
      {
        code: "invalid-quick-action-input",
        effect: "none",
        requiredAction: "correct-input",
      },
    ]);
    expect(results.after).toEqual(results.before);
  });
}
