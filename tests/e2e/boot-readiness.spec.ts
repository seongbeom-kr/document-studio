import { test, expect } from "@playwright/test";

test("HWPX can connect to the ready runtime while a nonessential iframe image keeps the load event pending", async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/stalled-decoration.png", async (route) => {
    await gate;
    await route.abort().catch(() => undefined);
  });
  await page.route("**/editor-assets/rhwp/index.html?*", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: (await response.text()).replace(
        "</body>",
        '<img src="/stalled-decoration.png" alt="" /></body>',
      ),
    });
  });
  try {
    await page.goto("/harness.html?rhwpInitializationTimeoutMs=6000");
    await page.waitForFunction(() => !!window.documentStudioTest);
    await page.evaluate(() =>
      window.documentStudioTest.load("hwpx", "blank.hwpx"),
    );
    await expect
      .poll(
        () => page.evaluate(() => window.documentStudioTest.state()?.ready),
        { timeout: 10000 },
      )
      .toBe(true);
    await page.evaluate(() =>
      window.documentStudioTest.execute({
        id: "insertText",
        value: "첫 연결 성공",
      }),
    );
    expect(
      await page.evaluate(async () => {
        const a = window.documentStudioTest.agent;
        return (await a.readDocument({ documentId: a.getState().documentId }))
          .text;
      }),
    ).toContain("첫 연결 성공");
  } finally {
    release();
  }
});
