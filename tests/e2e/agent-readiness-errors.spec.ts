import { expect, test } from "@playwright/test";

test("public SDK reads distinguish loading, failed initialization and an explicit healthy retry", async ({
  page,
}) => {
  let blocked = true;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/editor-assets/rhwp/index.html?*", async (route) => {
    if (!blocked) return route.continue();
    await gate;
    await route
      .fulfill({
        status: 200,
        contentType: "text/html",
        body: "<!doctype html><title>Missing transport</title>",
      })
      .catch(() => undefined);
  });
  try {
    await page.goto("/harness.html?rhwpInitializationTimeoutMs=4000");
    await page.waitForFunction(() => !!window.documentStudioTest);
    await page.evaluate(() =>
      window.documentStudioTest.load("hwpx", "blank.hwpx"),
    );
    await expect
      .poll(() =>
        page.evaluate(
          () => window.documentStudioTest.state()?.initialization?.status,
        ),
      )
      .toBe("loading");
    const readFailure = () =>
      page.evaluate(async () => {
        const host = window.documentStudioTest;
        try {
          return await host.agent.readDocument({
            documentId: host.agent.getState().documentId,
          });
        } catch (cause) {
          return host.agentToolFailure(cause);
        }
      });
    expect(await readFailure()).toMatchObject({
      code: "editor-not-ready",
      effect: "none",
      requiredAction: "wait-for-ready",
      retryable: false,
    });
    release();
    await expect
      .poll(() =>
        page.evaluate(
          () => window.documentStudioTest.state()?.initialization?.status,
        ),
      )
      .toBe("failed");
    expect(await readFailure()).toMatchObject({
      code: "editor-initialization-failed",
      effect: "none",
      requiredAction: "retry-initialization",
      retryable: false,
    });
    expect(
      await page.evaluate(() => ({
        saves: window.documentStudioTest.saves,
        commands: window.documentStudioTest.commandsStarted,
        dirty: window.documentStudioTest.state()?.dirty,
      })),
    ).toEqual({ saves: 0, commands: [], dirty: false });
    blocked = false;
    const previousSession = await page.evaluate(() => {
      const agent = window.documentStudioTest.agent;
      const state = agent.getState();
      agent.retryInitialization({
        documentId: state.documentId,
        expectedSessionId: state.sessionId,
        expectedVersion: state.version,
      });
      return state.sessionId;
    });
    await expect
      .poll(() => page.evaluate(() => window.documentStudioTest.state()?.ready))
      .toBe(true);
    const read = await page.evaluate(() => {
      const agent = window.documentStudioTest.agent;
      return agent.readDocument({ documentId: agent.getState().documentId });
    });
    expect(read.sessionId).not.toBe(previousSession);
    expect(read.truncated).toBe(false);
    expect(read.dirty).toBe(false);
  } finally {
    release();
  }
});
