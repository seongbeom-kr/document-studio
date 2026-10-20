import { expect, test } from "@playwright/test";

for (const format of ["docx", "hwpx"] as const) {
  test(`${format}: a failed contextual commit requires a fresh observation and preserves replay history`, async ({
    page,
  }) => {
    await page.goto("/harness.html");
    await page.waitForFunction(() => window.documentStudioTest);
    await page.evaluate(async (format) => {
      await window.documentStudioTest.createTemplate(format, {
        fileName: `저장 재검토.${format}`,
        blocks: [{ kind: "paragraph", text: "재시도 전 확인할 문단" }],
      });
    }, format);
    await expect
      .poll(() => page.evaluate(() => window.documentStudioTest.state()?.ready))
      .toBe(true);
    const result = await page.evaluate(async () => {
      const host = window.documentStudioTest;
      await host.execute({ id: "insertText", value: "미저장 수정 " });
      const tools = host.createSessionTools();
      const context = (await tools.invoke("getState", {})).context!;
      const request = {
        contextRef: context.contextRef,
        operationId: "failed-commit",
      };
      const failures: string[] = [];
      host.mode = "failure";
      try {
        await tools.invoke("commit", request);
      } catch (error) {
        failures.push((error as Error).message);
      }
      host.mode = "success";
      try {
        await tools.invoke("commit", request);
      } catch (error) {
        failures.push((error as Error).message);
      }
      let staleCode;
      try {
        await tools.invoke("commit", {
          ...request,
          operationId: "different-id",
        });
      } catch (error) {
        staleCode = (error as { code: string }).code;
      }
      const savesBeforeReview = host.saves;
      const fresh = (await tools.invoke("getState", {})).context!;
      const saved = await tools.invoke("commit", {
        contextRef: fresh.contextRef,
        operationId: "reviewed-save",
      });
      tools.dispose();
      return {
        failures,
        staleCode,
        savesBeforeReview,
        saves: host.saves,
        saved,
        dirty: host.state()?.dirty,
      };
    });
    expect(result.failures).toHaveLength(2);
    expect(result.failures[0]).toBe(result.failures[1]);
    expect(result.staleCode).toBe("agent-context-mismatch");
    expect(result.savesBeforeReview).toBe(1);
    expect(result.saves).toBe(2);
    expect(result.dirty).toBe(false);
    expect(result.saved.result).toMatchObject({ version: "v3" });
  });
}
