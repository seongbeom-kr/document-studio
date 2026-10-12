import { expect, test, type Page } from "@playwright/test";
import { unzipSync, strFromU8 } from "fflate";
type Format = "docx" | "hwpx";
async function begin(page: Page) {
  await page.goto("/harness.html");
  await page.waitForFunction(() => !!window.documentStudioTest);
}
async function ready(page: Page) {
  await expect
    .poll(() => page.evaluate(() => window.documentStudioTest.state()?.ready))
    .toBe(true);
}
async function text(page: Page, format: Format) {
  const bytes = await page.evaluate(() => window.documentStudioTest.export());
  const files = unzipSync(new Uint8Array(bytes));
  return strFromU8(
    files[format === "docx" ? "word/document.xml" : "Contents/section0.xml"]!,
  );
}
async function edit(page: Page, value: string) {
  await page.evaluate(() =>
    window.documentStudioTest.execute({ id: "selectAll" }),
  );
  await page.keyboard.insertText(value);
  await expect
    .poll(() => page.evaluate(() => window.documentStudioTest.state()?.dirty))
    .toBe(true);
}
for (const format of ["docx", "hwpx"] as const) {
  test.describe(`${format} live review corrections`, () => {
    test("rejects an own saved version paired with bytes that were not saved", async ({
      page,
    }) => {
      await begin(page);
      await page.evaluate(
        (format) => window.documentStudioTest.load(format),
        format,
      );
      await ready(page);
      await edit(page, "서버에 저장된 새 내용");
      await page.evaluate(() => window.documentStudioTest.save());
      await edit(page, "저장 이후 편집도 보존");
      // Only the version is returned; the host still presents the old original buffer.
      await page.evaluate(() => window.documentStudioTest.updateVersion("v2"));
      await expect(page.getByText(/원본 문서가 변경됐습니다/)).toBeVisible();
      expect(await text(page, format)).toContain("저장 이후 편집도 보존");
      const message = await page.evaluate(async () => {
        try {
          await window.documentStudioTest.save();
          return "accepted";
        } catch (cause) {
          return String(cause);
        }
      });
      expect(message).toContain("일치하지 않습니다");
      expect(
        await page.evaluate(() => window.documentStudioTest.state()!.dirty),
      ).toBe(true);
    });
    test("accepts its own same-version save after Undo and permits further edits", async ({
      page,
    }) => {
      await begin(page);
      await page.evaluate(async (format) => {
        window.documentStudioTest.retainSavedSource = true;
        window.documentStudioTest.fixedSaveVersion = "v1";
        await window.documentStudioTest.load(format);
      }, format);
      await ready(page);
      const sessionId = await page.evaluate(
        () => window.documentStudioTest.state()!.sessionId,
      );
      await page.evaluate(async () => {
        const bridge = window.documentStudioTest.agent;
        const target = bridge.getState();
        const result = await bridge.search({
          documentId: target.documentId,
          query: "한국어",
        });
        await bridge.replace({
          documentId: result.documentId,
          expectedSessionId: result.sessionId,
          expectedRevision: result.revision,
          query: "한국어",
          replacement: "검토어",
          all: true,
        });
        await window.documentStudioTest.execute({ id: "undo" });
        await window.documentStudioTest.save();
      });
      await expect(page.getByText(/원본 문서가 변경됐습니다/)).toHaveCount(0);
      expect(await text(page, format)).toContain("한국어");
      await edit(page, "같은 버전 저장 뒤 추가 편집");
      await page.evaluate(() => window.documentStudioTest.save());
      await expect(page.getByText(/원본 문서가 변경됐습니다/)).toHaveCount(0);
      expect(await text(page, format)).toContain("같은 버전 저장 뒤 추가 편집");
      expect(
        await page.evaluate(() => window.documentStudioTest.state()!.sessionId),
      ).toBe(sessionId);
      expect(await page.evaluate(() => window.documentStudioTest.saves)).toBe(
        2,
      );
    });
    test("blocks an unread recovery key and retries without overwriting it", async ({
      page,
    }) => {
      await begin(page);
      await page.evaluate(async (format) => {
        await window.documentStudioTest.seedDraft(
          format,
          `sample.${format}`,
          "읽기 실패 전의 복구 자료",
        );
        window.documentStudioTest.failDraftReads = true;
        await window.documentStudioTest.load(format);
      }, format);
      const before = await page.evaluate(
        (format) => window.documentStudioTest.storedDraft(`sample.${format}`),
        format,
      );
      await expect(
        page.getByRole("button", { name: "초안 저장소 다시 확인" }),
      ).toBeVisible();
      expect(
        await page.evaluate(() => window.documentStudioTest.state()?.ready),
      ).toBe(false);
      await page.waitForTimeout(3200);
      expect(
        await page.evaluate(
          (format) => window.documentStudioTest.storedDraft(`sample.${format}`),
          format,
        ),
      ).toEqual(before);
      await page.evaluate(() => {
        window.documentStudioTest.failDraftReads = false;
      });
      await page.getByRole("button", { name: "초안 저장소 다시 확인" }).click();
      await expect(page.getByRole("dialog")).toContainText(
        "저장하지 않은 초안",
      );
      await page
        .getByRole("button", { name: "초안 복구", exact: true })
        .click();
      await ready(page);
      expect(await text(page, format)).toContain("읽기 실패 전의 복구 자료");
    });
    test("preserves both current edits and the replacement store's existing draft", async ({
      page,
    }) => {
      await begin(page);
      await page.evaluate(
        (format) => window.documentStudioTest.load(format),
        format,
      );
      await ready(page);
      await edit(page, "현재 편집본 보존");
      const sessionId = await page.evaluate(
        () => window.documentStudioTest.state()!.sessionId,
      );
      await page.evaluate(async (format) => {
        await window.documentStudioTest.seedDraft(
          format,
          `sample.${format}`,
          "새 저장소 복구 자료",
          false,
          true,
        );
        window.documentStudioTest.setDraftPolicy("secondary");
      }, format);
      await expect(
        page.getByText("현재 편집본을 보존하고 있습니다."),
      ).toBeVisible();
      const before = await page.evaluate(
        (format) =>
          window.documentStudioTest.storedDraft(`sample.${format}`, true),
        format,
      );
      await page.waitForTimeout(3200);
      expect(
        await page.evaluate(
          (format) =>
            window.documentStudioTest.storedDraft(`sample.${format}`, true),
          format,
        ),
      ).toEqual(before);
      expect(
        await page.evaluate(() => window.documentStudioTest.state()!.sessionId),
      ).toBe(sessionId);
      expect(await text(page, format)).toContain("현재 편집본 보존");
      await page.getByRole("button", { name: "새 원본 열기" }).click();
      await expect(page.getByRole("dialog")).toContainText(
        "저장하지 않은 초안",
      );
      await page
        .getByRole("button", { name: "초안 복구", exact: true })
        .click();
      await ready(page);
      expect(await text(page, format)).toContain("새 저장소 복구 자료");
      const previous = await page.evaluate(
        (format) => window.documentStudioTest.storedDraft(`sample.${format}`),
        format,
      );
      expect(
        strFromU8(
          unzipSync(new Uint8Array(previous!))[
            format === "docx" ? "word/document.xml" : "Contents/section0.xml"
          ]!,
        ),
      ).toContain("현재 편집본 보존");
    });
    test("adopts an empty store without remounting or losing current input", async ({
      page,
    }) => {
      await begin(page);
      await page.evaluate(
        (format) => window.documentStudioTest.load(format),
        format,
      );
      await ready(page);
      await edit(page, "새 저장소에도 현재 입력 유지");
      const before = await page.evaluate(
        () => window.documentStudioTest.state()!.sessionId,
      );
      await page.evaluate(() =>
        window.documentStudioTest.setDraftPolicy("secondary"),
      );
      await expect(
        page.getByText("현재 편집본을 보존하고 있습니다."),
      ).toHaveCount(0);
      await page.evaluate(() => window.documentStudioTest.flushDraft());
      expect(
        await page.evaluate(() => window.documentStudioTest.state()!.sessionId),
      ).toBe(before);
      expect(await text(page, format)).toContain(
        "새 저장소에도 현재 입력 유지",
      );
      expect(
        await page.evaluate(
          (format) =>
            window.documentStudioTest.storedDraft(`sample.${format}`, true),
          format,
        ),
      ).not.toBeNull();
    });
    test("rejects an old agent target after a same-ID/version/revision reload", async ({
      page,
    }) => {
      await begin(page);
      await page.evaluate(
        (format) => window.documentStudioTest.load(format),
        format,
      );
      await ready(page);
      const before = await page.evaluate(() =>
        window.documentStudioTest.agent.getState(),
      );
      await page.evaluate(() => window.documentStudioTest.replaceSameVersion());
      await page.getByRole("button", { name: "새 원본 열기" }).click();
      await expect
        .poll(() =>
          page.evaluate(() => window.documentStudioTest.state()?.sessionId),
        )
        .not.toBe(before.sessionId);
      await ready(page);
      const after = await page.evaluate(() =>
        window.documentStudioTest.agent.getState(),
      );
      expect(after.documentId).toBe(before.documentId);
      expect(after.version).toBe(before.version);
      expect(after.revision).toBe(before.revision);
      expect(after.sessionId).not.toBe(before.sessionId);
      const error = await page.evaluate(async (before) => {
        try {
          await window.documentStudioTest.agent.execute({
            documentId: before.documentId,
            expectedSessionId: before.sessionId,
            expectedRevision: before.revision,
            expectedSelectionKey: before.selectionKey!,
            command: { id: "bold" },
          });
          return "accepted";
        } catch (cause) {
          return String(cause);
        }
      }, before);
      expect(error).toContain("세션");
      expect(
        await page.evaluate(() => window.documentStudioTest.state()?.dirty),
      ).toBe(false);
    });
    test("undoes and redoes replace-all in one step across paragraphs and table cells", async ({
      page,
    }) => {
      await begin(page);
      await page.evaluate(
        (format) =>
          window.documentStudioTest.createTemplate(format, {
            fileName: `undo.${format}`,
            blocks: [
              { kind: "paragraph", text: "대상 · 대상" },
              { kind: "paragraph", text: "두 번째 대상" },
              { kind: "table", rows: [["표 안 대상", "보존 내용"]] },
            ],
          }),
        format,
      );
      await ready(page);
      const replace = await page.evaluate(async () => {
        const agent = window.documentStudioTest.agent,
          state = agent.getState();
        return agent.replace({
          documentId: state.documentId,
          expectedSessionId: state.sessionId,
          expectedRevision: state.revision,
          query: "대상",
          replacement: "변경",
          all: true,
        });
      });
      expect(replace.count).toBe(4);
      expect(await text(page, format)).not.toContain("대상");
      // A subsequent formatting edit must remain a separate undo unit.
      await page.evaluate(async () => {
        await window.documentStudioTest.execute({ id: "selectAll" });
        await window.documentStudioTest.execute({ id: "fontSize", value: 18 });
      });
      await page.keyboard.press("Control+z");
      await expect.poll(() => text(page, format)).not.toContain("대상");
      await page.keyboard.press("Control+z");
      await expect
        .poll(async () => (await text(page, format)).match(/대상/g)?.length)
        .toBe(4);
      await page.keyboard.press("Control+y");
      await expect
        .poll(async () => (await text(page, format)).match(/변경/g)?.length)
        .toBe(4);
      expect(await text(page, format)).toContain("보존 내용");
    });
  });
}
