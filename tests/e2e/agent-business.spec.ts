import { expect, test } from "@playwright/test";
import { unzipSync } from "fflate";

// Public SDK workflow with the harness storage adapter. This is deliberately
// separate from acceptance with a real model, authenticated host and server.
for (const format of ["docx", "hwpx"] as const) {
  test(`${format}: report task preserves read state, rejects a stale preview and verifies the saved file`, async ({
    page,
  }, info) => {
    await page.goto("/harness.html");
    await page.waitForFunction(() => window.documentStudioTest);
    await page.evaluate(async (format) => {
      await window.documentStudioTest.createTemplate(format, {
        fileName: `업무 검증.${format}`,
        blocks: [
          { kind: "paragraph", text: "담당 부서: 문서개발팀" },
          { kind: "paragraph", text: "보고 기간: 2026-10-01 ~ 2026-10-15" },
          {
            kind: "paragraph",
            text: "이전 보고 기간: 2026-10-01 ~ 2026-10-15",
          },
          {
            kind: "table",
            rows: [
              ["항목", "금액", "사번", "날짜"],
              ["첫째", "12340", "001234", "2026-10-19"],
              ["둘째", "00100", "000007", "2026-10-20"],
              ["셋째", "2026-10-19", "A-01", "2026-10-21"],
              ["넷째", "25000", "A-02", "2026-10-22"],
            ],
          },
          { kind: "paragraph", text: "원본고정본문" },
        ],
      });
    }, format);
    await expect
      .poll(() => page.evaluate(() => window.documentStudioTest.state()?.ready))
      .toBe(true);

    const result = await page.evaluate(async () => {
      const host = window.documentStudioTest,
        agent = host.agent,
        initial = agent.getState();
      const original = await host.export();
      const content = await agent.readDocument({
        documentId: initial.documentId,
      });
      const periods = await agent.search({
        documentId: initial.documentId,
        query: "보고 기간: 2026-10-01 ~ 2026-10-15",
      });
      // A later, unrelated read must not invalidate the chosen report target.
      await agent.search({
        documentId: initial.documentId,
        query: "담당 부서",
      });
      const afterReads = agent.getState();
      const unchanged = await host.export();
      if (periods.matches.length !== 2)
        throw new Error("Expected two report periods");
      await agent.replace({
        documentId: initial.documentId,
        expectedSessionId: initial.sessionId,
        expectedRevision: periods.revision,
        matchId: periods.matches[0]!.id,
        replacement: "보고 기간: 2026-10-19 ~ 2026-10-23",
      });
      const select = async (query: string) => {
        const state = agent.getState();
        const found = await agent.search({
          documentId: state.documentId,
          query,
        });
        if (found.matches.length !== 1)
          throw new Error("Ambiguous fixture target");
        await agent.select({
          documentId: state.documentId,
          expectedSessionId: state.sessionId,
          expectedRevision: found.revision,
          matchId: found.matches[0]!.id,
        });
      };
      const preview = () =>
        agent.previewTableColumn({
          documentId: agent.getState().documentId,
          columnRequest: {
            column: 2,
            columnKind: "number",
            headerRows: 1,
            operation: { kind: "commas" },
          },
        });
      await select("12340");
      const oldPreview = await preview();
      // Simulate a person's intervening edit through the same host controller.
      await select("원본고정본문");
      await host.execute({ id: "bold" });
      const beforeRejection = await agent.readDocument({
        documentId: initial.documentId,
      });
      let rejection = "";
      try {
        await agent.applyTableColumn({
          documentId: oldPreview.documentId,
          expectedSessionId: oldPreview.sessionId,
          expectedRevision: oldPreview.revision,
          expectedSelectionKey: oldPreview.selectionKey!,
          previewId: oldPreview.previewId,
          operationId: "outdated-report-preview",
        });
      } catch (error) {
        rejection = error instanceof Error ? error.name : String(error);
      }
      const afterRejection = await agent.readDocument({
        documentId: initial.documentId,
      });
      // Explicitly select and preview again; never substitute fresh guards into
      // the old preview to make a rejected operation pass.
      await select("12340");
      const approved = await preview();
      const applyRequest = {
        documentId: approved.documentId,
        expectedSessionId: approved.sessionId,
        expectedRevision: approved.revision,
        expectedSelectionKey: approved.selectionKey!,
        previewId: approved.previewId,
        operationId: "approved-report-preview",
      };
      const applied = await agent.applyTableColumn(applyRequest);
      const replayedApply = await agent.applyTableColumn(applyRequest);
      const state = agent.getState();
      const commitRequest = {
        documentId: state.documentId,
        expectedSessionId: state.sessionId,
        expectedRevision: state.revision,
        expectedVersion: state.version,
        operationId: "approved-report-save",
      };
      const receipt = await agent.commit(commitRequest);
      const replayedCommit = await agent.commit(commitRequest);
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new Uint8Array(host.saved),
      );
      return {
        initial: { revision: initial.revision, dirty: initial.dirty },
        afterReads: { revision: afterReads.revision, dirty: afterReads.dirty },
        original,
        unchanged,
        content,
        rejection,
        beforeRejection,
        afterRejection,
        approved,
        applied,
        replayedApply,
        receipt,
        replayedCommit,
        digest: `sha256:${Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")}`,
        bytes: host.saved,
        saves: host.saves,
      };
    });
    expect(result.content.text).toContain("담당 부서: 문서개발팀");
    expect(result.content.text).toContain("보고 기간: 2026-10-01 ~ 2026-10-15");
    expect(result.afterReads).toEqual(result.initial);
    const before = unzipSync(new Uint8Array(result.original));
    const after = unzipSync(new Uint8Array(result.unchanged));
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    for (const name of Object.keys(before))
      expect(after[name]).toEqual(before[name]);
    expect(result.rejection).toBe("SaveConflictError");
    expect(result.afterRejection).toEqual(result.beforeRejection);
    expect(result.approved.changes.map((cell) => cell.after)).toEqual([
      "12,340",
      "25,000",
    ]);
    expect(result.approved.excluded).toHaveLength(3);
    expect(result.replayedApply).toEqual(result.applied);
    expect(result.replayedCommit).toEqual(result.receipt);
    expect(result.receipt.digest).toBe(result.digest);
    expect(result.saves).toBe(1);
    await info.attach(`saved-report.${format}`, {
      body: Buffer.from(result.bytes),
      contentType: "application/octet-stream",
    });
    await info.attach("save-receipt", {
      body: JSON.stringify(result.receipt),
      contentType: "application/json",
    });
    await page.evaluate(
      ({ bytes, format }) => window.documentStudioTest.loadBytes(bytes, format),
      {
        bytes: result.bytes,
        format,
      },
    );
    await expect
      .poll(() => page.evaluate(() => window.documentStudioTest.state()?.ready))
      .toBe(true);
    const reopened = await page.evaluate(async () => {
      const host = window.documentStudioTest,
        agent = host.agent;
      const read = await agent.readDocument({
        documentId: agent.getState().documentId,
      });
      await host.execute({ id: "insertText", value: "사람의 후속 편집 " });
      return {
        read,
        state: agent.getState(),
        afterHuman: await agent.readDocument({
          documentId: agent.getState().documentId,
        }),
      };
    });
    for (const text of [
      "담당 부서: 문서개발팀",
      "보고 기간: 2026-10-19 ~ 2026-10-23",
      "이전 보고 기간: 2026-10-01 ~ 2026-10-15",
      "12,340",
      "25,000",
      "00100",
      "001234",
      "000007",
      "2026-10-19",
      "원본고정본문",
    ])
      expect(reopened.read.text).toContain(text);
    expect(reopened.afterHuman.text).toContain("사람의 후속 편집");
    expect(reopened.state.dirty).toBe(true);
  });
}
