import { expect, test } from "@playwright/test";

for (const format of ["docx", "hwpx"] as const) {
  test(`${format}: automation preview, guarded apply, replay, commit and reopen preserve one result`, async ({
    page,
  }) => {
    await page.goto("/harness.html");
    await page.waitForFunction(() => window.documentStudioTest);
    await page.evaluate(
      (format) => window.documentStudioTest.load(format, `blank.${format}`),
      format,
    );
    await expect
      .poll(() => page.evaluate(() => window.documentStudioTest.state()?.ready))
      .toBe(true);
    const result = await page.evaluate(async () => {
      const api = window.documentStudioTest,
        agent = api.agent;
      await api.execute({ id: "insertText", value: "교체할금액" });
      const before = agent.getState();
      const found = await agent.search({
        documentId: before.documentId,
        query: "교체할금액",
      });
      await agent.select({
        documentId: before.documentId,
        expectedSessionId: before.sessionId,
        expectedRevision: found.revision,
        matchId: found.matches[0]!.id,
      });
      const state = agent.getState();
      const preview = agent.previewAutomation({
        documentId: state.documentId,
        expectedSessionId: state.sessionId,
        automation: { actionId: "amount-korean", input: "1250000" },
      });
      const afterPreview = agent.getState();
      const request = {
        documentId: state.documentId,
        expectedSessionId: state.sessionId,
        expectedRevision: state.revision,
        expectedSelectionKey: state.selectionKey!,
        previewId: preview.previewId,
        mode: "text" as const,
        operationId: "automation-apply",
      };
      const applied = await agent.applyAutomation(request);
      const replay = await agent.applyAutomation(request);
      const afterApply = agent.getState();
      const saved = await agent.commit({
        documentId: state.documentId,
        expectedSessionId: state.sessionId,
        expectedRevision: afterApply.revision,
        operationId: "automation-save",
      });
      return {
        preview,
        applied,
        replay,
        saved,
        before: state,
        afterPreview,
        afterApply,
        bytes: api.saved,
        saves: api.saves,
      };
    });
    expect(result.afterPreview.revision).toBe(result.before.revision);
    expect(result.applied).toEqual(result.replay);
    expect(result.applied.committed).toBe(false);
    expect(result.afterApply.dirty).toBe(true);
    expect(result.saved.destination).toBe("storage");
    expect(result.saves).toBe(1);
    await page.evaluate(
      ({ bytes, format }) => window.documentStudioTest.loadBytes(bytes, format),
      { bytes: result.bytes, format },
    );
    await expect
      .poll(() =>
        page.evaluate((previous) => {
          const state = window.documentStudioTest.state();
          return state?.ready && state.sessionId !== previous;
        }, result.before.sessionId),
      )
      .toBe(true);
    const reopened = await page.evaluate(async () => {
      const agent = window.documentStudioTest.agent;
      return agent.readDocument({ documentId: agent.getState().documentId });
    });
    expect(reopened.text).toContain(result.preview.text);
    expect(reopened.text.split(result.preview.text)).toHaveLength(2);
    expect(reopened.text).not.toContain("교체할금액");
  });

  test(`${format}: automation creates a structured table without changing or saving the source`, async ({
    page,
  }) => {
    await page.goto("/harness.html");
    await page.waitForFunction(() => window.documentStudioTest);
    await page.evaluate(
      (format) => window.documentStudioTest.load(format, `blank.${format}`),
      format,
    );
    await expect
      .poll(() => page.evaluate(() => window.documentStudioTest.state()?.ready))
      .toBe(true);
    const result = await page.evaluate(async () => {
      const api = window.documentStudioTest,
        agent = api.agent,
        before = agent.getState();
      const preview = agent.previewAutomation({
        documentId: before.documentId,
        automation: {
          actionId: "markdown-report",
          input:
            "# 검토 보고서\n\n| 항목 | 결과 |\n| --- | --- |\n| 테스트 | 통과 |",
        },
      });
      const created = await agent.createAutomationDocument({
        documentId: before.documentId,
        expectedSessionId: before.sessionId,
        expectedRevision: before.revision,
        previewId: preview.previewId,
        fileName: "검토 보고서",
      });
      const inspection = api.inspectBytes(
        Array.from(created.document.bytes),
        created.document.format as "docx" | "hwpx",
      );
      return {
        created: { created: created.created, committed: created.committed },
        before,
        after: agent.getState(),
        inspection,
        saves: api.saves,
        bytes: Array.from(created.document.bytes),
      };
    });
    expect(result.created).toEqual({ created: true, committed: false });
    expect(result.after.revision).toBe(result.before.revision);
    expect(result.after.dirty).toBe(false);
    expect(result.saves).toBe(0);
    expect(result.inspection.tables).toHaveLength(1);
    await page.evaluate(
      ({ bytes, format }) => window.documentStudioTest.loadBytes(bytes, format),
      { bytes: result.bytes, format },
    );
    await expect
      .poll(() =>
        page.evaluate((previous) => {
          const state = window.documentStudioTest.state();
          return state?.ready && state.sessionId !== previous;
        }, result.before.sessionId),
      )
      .toBe(true);
    const document = await page.evaluate(() => {
      const agent = window.documentStudioTest.agent;
      return agent.readDocument({ documentId: agent.getState().documentId });
    });
    expect(document.text).toContain("검토 보고서");
    expect(document.text).toContain("테스트");
  });
}
