import { test, expect, type Page } from "@playwright/test";
import { unzipSync, strFromU8 } from "fflate";
import { PNG } from "pngjs";
const picture = new PNG({ width: 8, height: 8 });
picture.data.fill(255);
const image = Array.from(PNG.sync.write(picture));
async function open(page: Page, format: "docx" | "hwpx") {
  await page.goto("/harness.html");
  await page.waitForFunction(() => !!window.documentStudioTest);
  await page.evaluate(
    async (format) =>
      window.documentStudioTest.createTemplate(format, {
        fileName: `서식.${format}`,
        blocks: [
          { kind: "heading", level: 1, text: "안내 {{이름}}" },
          {
            kind: "paragraph",
            text: "{{이름}}님, 사번 {{사번}} / 날짜 {{날짜}}",
          },
          {
            kind: "table",
            rows: [
              ["이름", "사번"],
              ["{{이름}}", "{{사번}}"],
            ],
          },
          { kind: "paragraph", text: "원본고정본문" },
        ],
      }),
    format,
  );
  await expect
    .poll(() => page.evaluate(() => window.documentStudioTest.state()?.ready))
    .toBe(true);
}
async function select(page: Page, query: string) {
  await page.evaluate(async (query) => {
    const a = window.documentStudioTest.agent,
      s = a.getState(),
      found = await a.search({ documentId: s.documentId, query });
    if (!found.matches.length) throw new Error("fixture selection missing");
    await a.select({
      documentId: s.documentId,
      expectedSessionId: s.sessionId,
      expectedRevision: found.revision,
      matchId: found.matches[0]!.id,
    });
  }, query);
}
async function register(page: Page) {
  return page.evaluate(() => {
    const a = window.documentStudioTest.agent;
    return a.registerCurrentMailMergeTemplate({
      documentId: a.getState().documentId,
    });
  });
}
async function preview(
  page: Page,
  templateId: string,
  format: "docx" | "hwpx",
  data = "이름,사번,날짜\n홍길동,001234,20261016\nA<&> 👩‍💻,000007,2026-10-17",
) {
  return page.evaluate(
    ({ templateId, format, data }) => {
      const a = window.documentStudioTest.agent;
      return a.previewMailMerge({
        documentId: a.getState().documentId,
        mergeRequest: {
          templateId,
          data,
          delimiter: ",",
          mapping: { 이름: "이름", 사번: "사번", 날짜: "날짜" },
          fileNamePattern: `결과-{{#}}.${format}`,
          allowEmpty: false,
        },
      });
    },
    { templateId, format, data },
  );
}
async function generate(
  page: Page,
  p: Awaited<ReturnType<typeof preview>>,
  operationId = "merge-test",
) {
  return page.evaluate(
    ({ p, operationId }) =>
      window.documentStudioTest.agent.generateMailMerge({
        documentId: p.documentId,
        expectedSessionId: p.sessionId,
        expectedRevision: p.revision,
        previewId: p.previewId,
        operationId,
      }),
    { p, operationId },
  );
}
const read = (page: Page) =>
  page.evaluate(() => {
    const a = window.documentStudioTest.agent;
    return a.readDocument({ documentId: a.getState().documentId });
  });
for (const format of ["docx", "hwpx"] as const) {
  test(`${format} mail merge isolates template bytes and preserves the previous successful output after a mid-generation revision or permission change`, async ({
    page,
  }) => {
    await open(page, format);
    const result = await page.evaluate(async (format) => {
      const api = window.documentStudioTest;
      const state = {
        documentId: "test",
        sessionId: "test-session",
        revision: "1",
      };
      let writable = true;
      const session = api.createMailMergeSession({
        state: () => ({ ...state }),
        assertWritable() {
          if (!writable) throw new Error("permission revoked");
        },
      });
      const bytes = new Uint8Array(await api.export());
      const registration = session.register({
        id: "template",
        fileName: `서식.${format}`,
        format,
        bytes,
      });
      bytes.fill(0);
      const template = await registration;
      let notifications = 0;
      session.subscribe(() => {
        notifications++;
        throw new Error("observer-failure");
      });
      (template.fields as string[]).length = 0;
      const makePreview = () =>
        session.preview({
          templateId: template.templateId,
          data: "이름,사번,날짜\n홍길동,001234,20261016\n김이름,000001,20261017",
          delimiter: ",",
          mapping: { 이름: "이름", 사번: "사번", 날짜: "날짜" },
          fileNamePattern: `결과-{{#}}.${format}`,
          allowEmpty: false,
        });
      const initial = makePreview();
      const good = await session.generate({
        previewId: initial.previewId,
        operationId: "success",
      });
      const originalResult = session.results("success")[0]!.bytes;
      const cloned = session.results("success");
      cloned[0]!.bytes.fill(0);
      const preserved = session
        .results("success")[0]!
        .bytes.every((b, i) => b === originalResult[i]);
      const Original = window.XMLSerializer;
      const failures = [];
      for (const mode of ["revision", "permission"] as const) {
        const p = makePreview();
        let calls = 0;
        window.XMLSerializer = class extends Original {
          override serializeToString(node: Node) {
            const xml = super.serializeToString(node);
            if (++calls === 1) {
              if (mode === "revision") state.revision = "2";
              else writable = false;
            }
            return xml;
          }
        };
        let error = "",
          exportable = true;
        try {
          await session.generate({ previewId: p.previewId, operationId: mode });
        } catch (cause) {
          error = String(cause);
        } finally {
          window.XMLSerializer = Original;
        }
        try {
          session.results(mode);
        } catch {
          exportable = false;
        }
        failures.push({
          error,
          exportable,
          status: session.getSnapshot(),
          previous: session.results("success").length,
        });
        writable = true;
      }
      return {
        preserved,
        notifications,
        good,
        failures,
        frozen:
          Object.isFrozen(session.getSnapshot()) &&
          Object.isFrozen(session.getSnapshot().lastResult?.files),
        fields: session.list()[0]!.fields,
      };
    }, format);
    expect(result.preserved).toBe(true);
    expect(result.notifications).toBeGreaterThan(0);
    expect(result.frozen).toBe(true);
    expect(result.fields).toHaveLength(3);
    expect(result.good.files).toHaveLength(2);
    for (const failure of result.failures) {
      expect(failure.error).toContain("모두 폐기");
      expect(failure.exportable).toBe(false);
      expect(failure.previous).toBe(2);
      expect(failure.status).toMatchObject({
        phase: "failed",
        completed: 0,
        lastResult: { operationId: "success" },
      });
    }
    expect((await read(page)).text).toContain("{{이름}}");
  });
  test(`${format} quick date uses explicit calendar boundaries, shared agent guards, undo and saved reopen`, async ({
    page,
  }) => {
    await open(page, format);
    await select(page, "원본고정본문");
    const original = await read(page);
    const p = await page.evaluate(() => {
      const a = window.documentStudioTest.agent;
      return a.previewQuickAction({
        documentId: a.getState().documentId,
        action: {
          kind: "date",
          baseDate: "2026-12-31",
          period: "nextWeek",
          week: "workweek",
          format: "iso",
        },
      });
    });
    expect(p.text).toBe("2027-01-04 ~ 2027-01-08");
    expect((await read(page)).text).toBe(original.text);
    const result = await page.evaluate(async (p) => {
      const a = window.documentStudioTest.agent,
        r = {
          documentId: p.documentId,
          expectedSessionId: p.sessionId,
          expectedRevision: p.revision,
          expectedSelectionKey: p.selectionKey!,
          previewId: p.previewId,
          operationId: "quick",
        };
      const receipt = await a.applyQuickAction(r);
      return { receipt, replayed: await a.applyQuickAction(r) };
    }, p);
    expect(result.receipt).toEqual(result.replayed);
    expect(result.receipt).toMatchObject({ committed: false, undoSteps: 1 });
    expect((await read(page)).text).toContain(p.text!);
    await page.evaluate(() =>
      window.documentStudioTest.execute({ id: "undo" }),
    );
    expect((await read(page)).text).toBe(original.text);
    await page.evaluate(() =>
      window.documentStudioTest.execute({ id: "redo" }),
    );
    await page.evaluate(() => window.documentStudioTest.save());
    const bytes = await page.evaluate(() => window.documentStudioTest.saved),
      session = await page.evaluate(
        () => window.documentStudioTest.state()!.sessionId,
      );
    await page.evaluate(
      ({ bytes, format }) => window.documentStudioTest.loadBytes(bytes, format),
      { bytes, format },
    );
    await expect
      .poll(() =>
        page.evaluate(
          (session) =>
            window.documentStudioTest.state()?.ready &&
            window.documentStudioTest.state()?.sessionId !== session,
          session,
        ),
      )
      .toBe(true);
    expect((await read(page)).text).toContain(p.text!);
  });
  test(`${format} quick UI previews presets and blocks a stale selection`, async ({
    page,
  }) => {
    await open(page, format);
    await select(page, "원본고정본문");
    await page.getByRole("button", { name: "빠른 작업", exact: true }).click();
    await page
      .getByRole("button", { name: "보고서 제목", exact: true })
      .click();
    await expect(page.getByLabel("빠른 작업 미리보기")).toContainText("16pt");
    await select(page, "안내");
    await expect(
      page.getByRole("button", { name: "확인한 빠른 작업 적용" }),
    ).toBeDisabled();
    await page
      .getByRole("button", { name: "보고서 제목", exact: true })
      .click();
    await page.getByRole("button", { name: "확인한 빠른 작업 적용" }).click();
    await expect(
      page.getByText(
        "적용했습니다. 한 번 되돌릴 수 있으며 파일 저장은 별도입니다.",
      ),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => window.documentStudioTest.state()?.fontSize),
      )
      .toBe(16);
    await page.evaluate(() =>
      window.documentStudioTest.execute({ id: "undo" }),
    );
  });
  test(`${format} table affixes and whitespace cleanup preserve protected cells and undo as one edit`, async ({
    page,
  }) => {
    await page.goto("/harness.html");
    await page.waitForFunction(() => !!window.documentStudioTest);
    await page.evaluate(
      async (format) =>
        window.documentStudioTest.createTemplate(format, {
          fileName: `표.${format}`,
          blocks: [
            {
              kind: "table",
              rows: [
                ["항목", "내용"],
                ["첫째", "  가  나  "],
                ["둘째", "다"],
                ["셋째", "001234"],
              ],
            },
          ],
        }),
      format,
    );
    await expect
      .poll(() => page.evaluate(() => window.documentStudioTest.state()?.ready))
      .toBe(true);
    await select(page, "가  나");
    const before = await read(page);
    for (const operation of [
      { kind: "prefix", text: "앞 " },
      { kind: "suffix", text: " 뒤" },
      { kind: "trim" },
      { kind: "collapseSpaces" },
    ] as const) {
      const p = await page.evaluate((operation) => {
        const a = window.documentStudioTest.agent;
        return a.previewTableColumn({
          documentId: a.getState().documentId,
          columnRequest: {
            column: 2,
            columnKind: "text",
            headerRows: 1,
            operation,
          },
        });
      }, operation);
      expect(p.excluded.some((c) => c.value === "001234")).toBe(true);
      await page.evaluate(
        (p) =>
          window.documentStudioTest.agent.applyTableColumn({
            documentId: p.documentId,
            expectedSessionId: p.sessionId,
            expectedRevision: p.revision,
            expectedSelectionKey: p.selectionKey!,
            previewId: p.previewId,
            operationId: `column:${p.previewId}`,
          }),
        p,
      );
      expect((await read(page)).text).toContain("001234");
      await page.evaluate(() =>
        window.documentStudioTest.execute({ id: "undo" }),
      );
      expect((await read(page)).text).toBe(before.text);
      await select(page, "가  나");
    }
  });
  test(`${format} mail merge preserves original, native formatting, images and string identifiers across export and reopen`, async ({
    page,
  }) => {
    await open(page, format);
    await select(page, "원본고정본문");
    await page.evaluate(() =>
      window.documentStudioTest.execute({
        id: "insertText",
        value: "원본고정본문",
      }),
    );
    await page.evaluate(
      async (image) =>
        window.documentStudioTest.execute({
          id: "insertImage",
          value: {
            bytes: new Uint8Array(image),
            mimeType: "image/png",
            widthMm: 12,
            heightMm: 8,
            alt: "보존할 로고",
          },
        }),
      image,
    );
    await page.evaluate(() => window.documentStudioTest.save());
    const before = await read(page),
      original = await page.evaluate(() => window.documentStudioTest.export());
    const t = await register(page);
    expect([...t.fields].sort()).toEqual(["날짜", "사번", "이름"]);
    expect(t.issues).toEqual([]);
    const p = await preview(page, t.templateId, format);
    expect(p.issues).toEqual([]);
    expect(p.files[0]!.values.사번).toBe("001234");
    p.files[0]!.values = { ...p.files[0]!.values, 이름: "외부변조" };
    const receipt = await generate(page, p);
    expect(await generate(page, p)).toEqual(receipt);
    expect(receipt.files).toHaveLength(2);
    expect(receipt.committed).toBe(false);
    expect((await read(page)).text).toBe(before.text);
    const files = await page.evaluate(
        (id) => window.documentStudioTest.exportMailMerge(id),
        receipt.operationId,
      ),
      source = unzipSync(new Uint8Array(original));
    for (const [i, file] of files.entries()) {
      const parts = unzipSync(new Uint8Array(file.bytes));
      for (const name of Object.keys(source).filter((n) =>
        /^(?:word\/media\/|BinData\/)/.test(n),
      ))
        expect(Buffer.from(parts[name]!)).toEqual(Buffer.from(source[name]!));
      const styles =
        format === "docx" ? "word/styles.xml" : "Contents/header.xml";
      expect(Buffer.from(parts[styles]!)).toEqual(Buffer.from(source[styles]!));
      const outputPage = await page.context().newPage();
      await outputPage.goto("/harness.html");
      await outputPage.waitForFunction(() => !!window.documentStudioTest);
      await outputPage.evaluate(
        ({ bytes, format }) =>
          window.documentStudioTest.loadBytes(bytes, format),
        { bytes: file.bytes, format },
      );
      await expect
        .poll(() =>
          outputPage.evaluate(() => window.documentStudioTest.state()?.ready),
        )
        .toBe(true);
      const text = (await read(outputPage)).text;
      expect(text).toContain(i === 0 ? "홍길동" : "A<&> 👩‍💻");
      expect(text).toContain(i === 0 ? "001234" : "000007");
      expect(text).not.toContain("외부변조");
      expect(text).not.toContain("{{이름}}");
      const inspected = await outputPage.evaluate(
        ({ bytes, format }) =>
          window.documentStudioTest.inspectBytes(bytes, format),
        { bytes: file.bytes, format },
      );
      expect(inspected.images.length).toBeGreaterThan(0);
      await outputPage.close();
    }
    expect((await read(page)).text).toBe(before.text);
  });
  test(`${format} mail merge handles a placeholder split across formatted runs and never recursively substitutes data`, async ({
    page,
  }) => {
    await open(page, format);
    await select(page, "이름");
    await page.evaluate(() =>
      window.documentStudioTest.execute({ id: "bold" }),
    );
    const t = await register(page);
    expect(t.issues).toEqual([]);
    const p = await preview(
      page,
      t.templateId,
      format,
      "이름,사번,날짜\n{{사번}},001234,20261016",
    );
    const r = await generate(page, p);
    const files = await page.evaluate(
      (id) => window.documentStudioTest.exportMailMerge(id),
      r.operationId,
    );
    const parts = unzipSync(new Uint8Array(files[0]!.bytes)),
      xml = strFromU8(
        parts[
          format === "docx" ? "word/document.xml" : "Contents/section0.xml"
        ]!,
      );
    expect(xml).toContain("{{사번}}");
    expect(xml).toContain("001234");
  });
  test(`${format} mail merge second-row failure discards the complete batch and repeated IDs do not generate again`, async ({
    page,
  }) => {
    await open(page, format);
    const t = await register(page),
      p = await preview(page, t.templateId, format),
      before = await read(page);
    const result = await page.evaluate(async (p) => {
      const Original = window.XMLSerializer;
      let calls = 0;
      window.XMLSerializer = class extends Original {
        override serializeToString(node: Node) {
          calls++;
          if (calls === 2) throw new Error("second-row-failure");
          return super.serializeToString(node);
        }
      };
      const a = window.documentStudioTest.agent,
        input = {
          documentId: p.documentId,
          expectedSessionId: p.sessionId,
          expectedRevision: p.revision,
          previewId: p.previewId,
          operationId: "forced-failure",
        };
      let message = "",
        repeated = "",
        exportable = true;
      try {
        await a.generateMailMerge(input);
      } catch (error) {
        message = String(error);
      }
      try {
        await a.generateMailMerge(input);
      } catch (error) {
        repeated = String(error);
      }
      try {
        window.documentStudioTest.exportMailMerge(input.operationId);
      } catch {
        exportable = false;
      } finally {
        window.XMLSerializer = Original;
      }
      return {
        message,
        repeated,
        calls,
        exportable,
        status: a.getMailMergeStatus({ documentId: p.documentId }),
      };
    }, p);
    expect(result.message).toContain("모두 폐기");
    expect(result.repeated).toBe(result.message);
    expect(result.calls).toBe(2);
    expect(result.exportable).toBe(false);
    expect(result.status).toMatchObject({ phase: "failed", completed: 0 });
    expect((await read(page)).text).toBe(before.text);
  });
  test(`${format} mail merge rejects stale and read-only previews, supports cancellation without files`, async ({
    page,
  }) => {
    await open(page, format);
    const t = await register(page),
      p = await preview(page, t.templateId, format);
    await select(page, "원본고정본문");
    await page.evaluate(() =>
      window.documentStudioTest.execute({
        id: "insertText",
        value: "현재문서편집",
      }),
    );
    await expect(generate(page, p, "stale")).rejects.toThrow();
    const q = await preview(page, t.templateId, format);
    await page.evaluate(() => {
      window.documentStudioTest.readOnly = true;
      window.documentStudioTest.rerender();
    });
    await expect
      .poll(() =>
        page.evaluate(
          () => window.documentStudioTest.state()?.commands.insertText?.enabled,
        ),
      )
      .toBe(false);
    await expect(generate(page, q, "readonly")).rejects.toThrow();
    await page.evaluate(() => {
      window.documentStudioTest.readOnly = false;
      window.documentStudioTest.rerender();
    });
    await expect
      .poll(() =>
        page.evaluate(
          () => window.documentStudioTest.state()?.commands.insertText?.enabled,
        ),
      )
      .toBe(true);
    const r = await preview(page, t.templateId, format);
    const cancelled = await page.evaluate(async (p) => {
      const a = window.documentStudioTest.agent,
        task = a.generateMailMerge({
          documentId: p.documentId,
          expectedSessionId: p.sessionId,
          expectedRevision: p.revision,
          previewId: p.previewId,
          operationId: "cancel",
        });
      a.cancelMailMerge({ documentId: p.documentId, operationId: "cancel" });
      try {
        await task;
        return "unexpected";
      } catch {
        return a.getMailMergeStatus({ documentId: p.documentId }).phase;
      }
    }, r);
    expect(cancelled).toBe("cancelled");
    expect((await read(page)).text).toContain("현재문서편집");
  });
  test(`${format} mail merge UI persists inputs across tools and creates a downloadable batch through the shared session`, async ({
    page,
  }) => {
    await open(page, format);
    await page
      .getByRole("button", { name: "문단·표·그림", exact: true })
      .click();
    await page.getByRole("tab", { name: "서식·메일머지", exact: true }).click();
    await page
      .getByRole("button", { name: "현재 편집본을 서식으로 등록", exact: true })
      .click();
    await expect(page.getByLabel("메일머지 등록한 서식")).not.toHaveValue("");
    await page
      .getByLabel("메일머지 입력 데이터", { exact: true })
      .fill("이름,사번,날짜\n홍길동,001234,20261016");
    for (const field of ["이름", "사번", "날짜"])
      await page
        .getByLabel(`필드 ${field} 데이터 열`, { exact: true })
        .selectOption(field);
    await page.getByRole("tab", { name: "글자", exact: true }).click();
    await page.getByRole("tab", { name: "서식·메일머지", exact: true }).click();
    await expect(
      page.getByLabel("메일머지 입력 데이터", { exact: true }),
    ).toContainText("001234");
    await expect(
      page.getByLabel("필드 이름 데이터 열", { exact: true }),
    ).toHaveValue("이름");
    await page
      .getByRole("button", { name: "메일머지 미리보기", exact: true })
      .click();
    await expect(
      page.getByRole("table", { name: "생성할 파일과 필드 값" }),
    ).toContainText("홍길동");
    await page
      .getByRole("button", { name: "확인한 1개 문서 생성", exact: true })
      .click();
    await expect(
      page.getByText("새 문서 1개 생성 완료 · 서버 미저장", { exact: true }),
    ).toBeVisible();
    const download = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "생성 파일 ZIP 내려받기", exact: true })
      .click();
    expect((await download).suggestedFilename()).toBe("메일머지-결과.zip");
    expect((await read(page)).text).toContain("{{이름}}");
  });
}
