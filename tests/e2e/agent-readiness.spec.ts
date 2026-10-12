import { expect, test } from "@playwright/test";

for (const format of ["docx", "hwpx"] as const) {
  test(`${format}: revoking permission while a guarded command waits prevents the native mutation`, async ({
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
    await page.evaluate(async () => {
      const api = window.documentStudioTest;
      await api.execute({ id: "insertText", value: "권한 철회 전 원문" });
      api.pauseNextCommand = true;
      api.commandsStarted = [];
      const s = api.agent.getState();
      void api.agent
        .execute({
          documentId: s.documentId,
          expectedSessionId: s.sessionId,
          expectedRevision: s.revision,
          expectedSelectionKey: s.selectionKey!,
          command: { id: "insertText", value: "금지된 후속 입력" },
        })
        .catch((cause) => {
          api.presetFailure = { message: String(cause) };
        });
    });
    await expect
      .poll(() =>
        page.evaluate(() => window.documentStudioTest.commandsStarted),
      )
      .toContain("insertText");
    await page.evaluate(() => {
      const api = window.documentStudioTest;
      api.readOnly = true;
      api.rerender();
    });
    await expect(
      page.getByRole("button", { name: "굵게", exact: true }),
    ).toBeDisabled();
    await page.evaluate(() =>
      window.documentStudioTest.releasePausedCommand?.(),
    );
    await expect
      .poll(() =>
        page.evaluate(() => window.documentStudioTest.presetFailure?.message),
      )
      .toContain("권한");
    const content = await page.evaluate(() => {
      const a = window.documentStudioTest.agent;
      return a.readDocument({ documentId: a.getState().documentId });
    });
    expect(content.text).toContain("권한 철회 전 원문");
    expect(content.text).not.toContain("금지된 후속 입력");
  });
  test(`${format}: guarded agent range rejects paragraph and character-range moves, applies the stable target and confirms a replayable commit`, async ({
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
      await api.execute({
        id: "insertText",
        value: "FIRST RANGE SECOND RANGE\nOTHER PARAGRAPH",
      });
      const pick = async (query: string) => {
        const state = agent.getState();
        const found = await agent.search({
          documentId: state.documentId,
          query,
        });
        await agent.select({
          documentId: state.documentId,
          expectedSessionId: state.sessionId,
          expectedRevision: found.revision,
          matchId: found.matches[0]!.id,
        });
        return agent.getState();
      };
      const failures = [];
      for (const other of ["RANGE", "SECOND RANGE", "OTHER PARAGRAPH"]) {
        const captured = await pick("FIRST RANGE");
        await pick(other);
        try {
          await agent.execute({
            documentId: captured.documentId,
            expectedSessionId: captured.sessionId,
            expectedRevision: captured.revision,
            expectedSelectionKey: captured.selectionKey!,
            command: { id: "insertText", value: "WRONG TARGET" },
          });
          failures.push("accepted");
        } catch (error) {
          failures.push({
            code: (error as { code?: string }).code,
            message: String(error),
          });
        }
      }
      const stable = await pick("FIRST RANGE");
      await agent.execute({
        documentId: stable.documentId,
        expectedSessionId: stable.sessionId,
        expectedRevision: stable.revision,
        expectedSelectionKey: stable.selectionKey!,
        command: { id: "insertText", value: "RIGHT TARGET" },
      });
      const current = agent.getState();
      const request = {
        documentId: current.documentId,
        expectedSessionId: current.sessionId,
        expectedRevision: current.revision,
        expectedVersion: current.version,
        operationId: "range-task-commit",
      };
      const commit = await agent.commit(request);
      commit.version = "caller must not mutate the receipt";
      const replay = await agent.commit(request);
      const storedHash = await crypto.subtle.digest(
        "SHA-256",
        new Uint8Array(api.saved),
      );
      const storedDigest = `sha256:${Array.from(new Uint8Array(storedHash), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
      const document = await agent.readDocument({
        documentId: current.documentId,
      });
      const inspection = await agent.inspect({
        documentId: current.documentId,
      });
      return {
        failures,
        commit: replay,
        storedDigest,
        document,
        inspection,
        saves: api.saves,
        state: api.state(),
      };
    });
    expect(result.failures).toHaveLength(3);
    for (const failure of result.failures)
      expect(failure).toMatchObject({ code: "selection-conflict" });
    expect(result.document.text).toContain("RIGHT TARGET");
    expect(result.document.text).toContain("SECOND RANGE");
    expect(result.document.text).toContain("OTHER PARAGRAPH");
    expect(result.document.text).not.toContain("WRONG TARGET");
    expect(result.saves).toBe(1);
    expect(result.commit).toMatchObject({
      destination: "storage",
      version: "v2",
      savedRevision: result.document.revision,
      digest: result.storedDigest,
    });
    expect(result.state?.dirty).toBe(false);
    expect(result.inspection).toMatchObject({
      format,
      tables: [],
      scope: "exported-body-structure",
      truncated: false,
    });
  });

  test(`${format}: preview distinguishes plain-text insertion and structural creation with title-based filename and bounded exported table inspection`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto("/harness.html");
    await page.waitForFunction(() => window.documentStudioTest);
    await page.evaluate((format) => {
      window.documentStudioTest.persistAutomation = true;
      return window.documentStudioTest.load(format, `blank.${format}`);
    }, format);
    await expect
      .poll(() => page.evaluate(() => window.documentStudioTest.state()?.ready))
      .toBe(true);
    await page
      .getByRole("button", { name: "문단·표·그림", exact: true })
      .click();
    await page.getByRole("tab", { name: "업무 자동화", exact: true }).click();
    await page
      .getByLabel("자동화 기능", { exact: true })
      .selectOption("마크다운 보고서");
    await page
      .getByLabel("보고서 마크다운", { exact: true })
      .fill("# 확인 보고서\n| 항목 | 결과 |\n|---|---|\n| SDK | 완료 |");
    await page
      .getByRole("button", { name: "결과 미리보기", exact: true })
      .click();
    await expect(
      page.getByRole("table", { name: "마크다운 보고서 · 표 1", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByLabel("업무 자동화 결과", { exact: true }),
    ).toBeHidden();
    await expect(
      page.getByLabel("새 문서 파일명", { exact: true }),
    ).toHaveValue(`확인 보고서.${format}`);
    await page
      .getByRole("button", {
        name: "텍스트로 삽입 · 표/서식 제외",
        exact: true,
      })
      .click();
    await expect(
      page.getByText(
        "텍스트 3줄을 선택 위치에 삽입했습니다. 표·서식은 제외됐습니다.",
        { exact: true },
      ),
    ).toBeVisible();
    const plain = await page.evaluate(() => {
      const a = window.documentStudioTest.agent;
      return a.inspect({ documentId: a.getState().documentId });
    });
    expect(plain.tables).toHaveLength(0);
    await page.evaluate(() => window.documentStudioTest.save());
    const previousSession = await page.evaluate(
      () => window.documentStudioTest.state()!.sessionId,
    );
    await page
      .getByLabel("새 문서 파일명", { exact: true })
      .fill(`검토 완료.${format}`);
    await page
      .getByRole("button", {
        name: "구조를 유지해 새 문서 만들기",
        exact: true,
      })
      .click();
    await expect
      .poll(() =>
        page.evaluate(() => window.documentStudioTest.creationsCompleted),
      )
      .toBe(1);
    await expect
      .poll(() =>
        page.evaluate((previous) => {
          const state = window.documentStudioTest.state();
          return state?.ready && state.sessionId !== previous;
        }, previousSession),
      )
      .toBe(true);
    const structured = await page.evaluate(() => {
      const a = window.documentStudioTest.agent;
      return a.inspect({ documentId: a.getState().documentId });
    });
    expect(structured.tables).toHaveLength(1);
    expect(structured.tables[0]).toMatchObject({
      rows: 2,
      columns: 2,
      cells: [
        expect.objectContaining({ row: 0, column: 0, text: "항목" }),
        expect.objectContaining({ row: 0, column: 1, text: "결과" }),
        expect.objectContaining({ row: 1, column: 0, text: "SDK" }),
        expect.objectContaining({ row: 1, column: 1, text: "완료" }),
      ],
    });
    expect(structured.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    const cells = await page.evaluate(async () => {
      const a = window.documentStudioTest.agent;
      const pick = async (query: string) => {
        const s = a.getState();
        const result = await a.search({ documentId: s.documentId, query });
        await a.select({
          documentId: s.documentId,
          expectedSessionId: s.sessionId,
          expectedRevision: result.revision,
          matchId: result.matches[0]!.id,
        });
        return a.getState();
      };
      const before = await pick("SDK");
      await pick("완료");
      let error = "";
      try {
        await a.applyPreset({
          documentId: before.documentId,
          expectedSessionId: before.sessionId,
          expectedRevision: before.revision,
          expectedSelectionKey: before.selectionKey!,
          preset: {
            id: "wrong-cell",
            name: "wrong-cell",
            description: "",
            commands: [{ id: "fontSize", value: 30 }],
          },
        });
      } catch (failure) {
        error = String(failure);
      }
      return {
        error,
        revision: a.getState().revision,
        before: before.revision,
      };
    });
    expect(cells.error).toContain("선택 범위");
    expect(cells.revision).toBe(cells.before);
  });
}
