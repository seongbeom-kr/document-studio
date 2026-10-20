import { expect, test } from "@playwright/test";
import type {
  MailMergePreview,
  MailMergeReceipt,
  SearchResult,
  TableColumnPreview,
  TableColumnReceipt,
} from "@document-studio/core";

for (const format of ["docx", "hwpx"] as const) {
  test(`${format}: reference tools verify table edits, stale requests and replayed saves`, async ({
    page,
  }) => {
    await page.goto("/harness.html");
    await page.waitForFunction(() => window.documentStudioTest);
    await page.evaluate(async (format) => {
      await window.documentStudioTest.createTemplate(format, {
        fileName: `참조 검증.${format}`,
        blocks: [
          { kind: "paragraph", text: "수정 대상 문단" },
          {
            kind: "table",
            rows: [
              ["항목", "금액", "사번"],
              ["가", "12340", "001234"],
              ["나", "20000", "000007"],
            ],
          },
        ],
      });
    }, format);
    await expect
      .poll(() => page.evaluate(() => window.documentStudioTest.state()?.ready))
      .toBe(true);
    const result = await page.evaluate(async () => {
      const host = window.documentStudioTest,
        tools = host.createSessionTools();
      let response = await tools.invoke("getState", {});
      const found = await tools.invoke("search", {
        contextRef: response.context!.contextRef,
        query: "12340",
      });
      response = await tools.invoke("select", {
        contextRef: found.context!.contextRef,
        matchId: (found.result as SearchResult).matches[0]!.id,
      });
      const preview = await tools.invoke("previewTableColumn", {
        contextRef: response.context!.contextRef,
        columnRequest: {
          column: 2,
          columnKind: "number",
          headerRows: 1,
          operation: { kind: "commas" },
        },
      });
      const request = {
        contextRef: preview.context!.contextRef,
        previewId: (preview.result as TableColumnPreview).previewId,
        operationId: "column",
      };
      const applied = await tools.invoke("applyTableColumn", request);
      const replayed = await tools.invoke("applyTableColumn", request);
      let stale;
      try {
        await tools.invoke("readTable", {
          contextRef: preview.context!.contextRef,
        });
      } catch (error) {
        stale = {
          code: (error as { code: string }).code,
          field: (error as { field: string }).field,
        };
      }
      const save = {
        contextRef: applied.context!.contextRef,
        operationId: "save",
      };
      const committed = await tools.invoke("commit", save);
      const committedAgain = await tools.invoke("commit", save);
      tools.dispose();
      return {
        applied,
        replayed,
        stale,
        committed,
        committedAgain,
        saves: host.saves,
        bytes: host.saved,
      };
    });
    expect(
      (result.applied.result as TableColumnReceipt).verification.status,
    ).toBe("verified");
    expect((result.applied.result as TableColumnReceipt).changedCells).toBe(2);
    expect(result.replayed).toEqual(result.applied);
    expect(result.stale).toMatchObject({ code: "agent-context-mismatch" });
    expect(result.committedAgain).toEqual(result.committed);
    expect(result.saves).toBe(1);
    await page.evaluate(
      async ({ bytes, format }) => {
        window.documentStudioTest.loadBytes(bytes, format);
      },
      { bytes: result.bytes, format },
    );
    await expect
      .poll(() => page.evaluate(() => window.documentStudioTest.state()?.ready))
      .toBe(true);
    const content = await page.evaluate(() =>
      window.documentStudioTest.agent.readDocument({
        documentId: window.documentStudioTest.agent.getState().documentId,
      }),
    );
    expect(content.text).toContain("12,340");
    expect(content.text).toContain("001234");
  });

  test(`${format}: repeated field targets and fill verification use exact token locations`, async ({
    page,
  }) => {
    await page.goto("/harness.html");
    await page.waitForFunction(() => window.documentStudioTest);
    await page.evaluate(async (format) => {
      await window.documentStudioTest.createTemplate(format, {
        fileName: `서식.${format}`,
        blocks: [
          { kind: "paragraph", text: "대표 {{이름}} 확인 {{이름}}" },
          {
            kind: "table",
            rows: [
              ["구분", "값"],
              ["사번", "{{사번}}"],
              ["담당", "{{이름}}"],
            ],
          },
          { kind: "paragraph", text: "보존할 본문 [1]" },
        ],
      });
    }, format);
    await expect
      .poll(() => page.evaluate(() => window.documentStudioTest.state()?.ready))
      .toBe(true);
    const result = await page.evaluate(async (format) => {
      const tools = window.documentStudioTest.createSessionTools();
      const context = (await tools.invoke("getState", {})).context!;
      const registration = await tools.invoke(
        "registerCurrentMailMergeTemplate",
        { contextRef: context.contextRef },
      );
      const template = registration.result as { templateId: string };
      const preview = await tools.invoke("previewMailMerge", {
        contextRef: registration.context!.contextRef,
        mergeRequest: {
          templateId: template.templateId,
          data: "이름,사번\n홍길동,001234\n김철수,000007",
          delimiter: ",",
          mapping: { 이름: "이름", 사번: "사번" },
          fileNamePattern: `사본-{{#}}.${format}`,
          allowEmpty: false,
        },
      });
      const p = preview.result as MailMergePreview;
      const generated = await tools.invoke("generateMailMerge", {
        contextRef: preview.context!.contextRef,
        previewId: p.previewId,
        operationId: "copies",
      });
      tools.dispose();
      return { preview: p, receipt: generated.result as MailMergeReceipt };
    }, format);
    expect(result.preview.checks.every((c) => c.status === "passed")).toBe(
      true,
    );
    const names = result.preview.fieldPlan.find((f) => f.field === "이름")!;
    expect(names.targets).toHaveLength(3);
    expect(
      new Set(names.targets.map((t) => JSON.stringify(t.source))).size,
    ).toBe(3);
    expect(result.receipt.verification).toMatchObject({
      status: "verified",
      checkedLocationsPerFile: 4,
      files: 2,
    });
  });

  test(`${format}: paste-clean UI previews before inserting and one undo restores the document`, async ({
    page,
  }) => {
    await page.goto("/harness.html");
    await page.waitForFunction(() => window.documentStudioTest);
    await page.evaluate(async (format) => {
      await window.documentStudioTest.createTemplate(format, {
        fileName: `원고.${format}`,
        blocks: [{ kind: "paragraph", text: "원본문단" }],
      });
    }, format);
    await expect
      .poll(() => page.evaluate(() => window.documentStudioTest.state()?.ready))
      .toBe(true);
    await page.getByRole("button", { name: "빠른 작업", exact: true }).click();
    await page
      .getByLabel("정리할 붙여넣기 원고")
      .fill("검증원고\u200b 【4:0†source】 [1] 👩‍💻");
    await page.getByRole("button", { name: "원고 정리 미리보기" }).click();
    await expect(
      page.getByText("바뀌는 줄 1개", { exact: true }),
    ).toBeVisible();
    const before = await page.evaluate(() =>
      window.documentStudioTest.agent.readDocument({
        documentId: window.documentStudioTest.agent.getState().documentId,
      }),
    );
    await page.getByRole("button", { name: "확인한 빠른 작업 적용" }).click();
    await expect(
      page.getByText(
        "적용했습니다. 한 번 되돌릴 수 있으며 파일 저장은 별도입니다.",
        { exact: true },
      ),
    ).toBeVisible();
    const after = await page.evaluate(() =>
      window.documentStudioTest.agent.readDocument({
        documentId: window.documentStudioTest.agent.getState().documentId,
      }),
    );
    expect(after.text).toContain("검증원고 [1] 👩‍💻");
    expect(after.text).not.toContain("†source");
    await page.evaluate(() =>
      window.documentStudioTest.execute({ id: "undo" }),
    );
    const undo = await page.evaluate(() =>
      window.documentStudioTest.agent.readDocument({
        documentId: window.documentStudioTest.agent.getState().documentId,
      }),
    );
    expect(undo.text).toBe(before.text);
  });
}
