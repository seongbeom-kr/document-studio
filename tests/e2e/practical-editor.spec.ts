import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";
import { PNG } from "pngjs";
type Format = "docx" | "hwpx";
const errors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  const list: string[] = [];
  errors.set(page, list);
  page.on("pageerror", (e) => list.push(e.message));
});
test.afterEach(({ page }) => expect(errors.get(page)).toEqual([]));
async function load(
  page: Page,
  format: Format,
  name?: string,
  persistAutomation = false,
) {
  await page.goto("/harness.html");
  await page.waitForFunction(() => Boolean(window.documentStudioTest));
  await page.evaluate(
    async ({ format, name, persistAutomation }) => {
      window.documentStudioTest.persistAutomation = persistAutomation;
      await window.documentStudioTest.load(format, name);
    },
    { format, name, persistAutomation },
  );
  await expect
    .poll(() => page.evaluate(() => window.documentStudioTest.state()?.ready))
    .toBe(true);
  await expect(page.locator(".ds-editor").getByRole("alert")).toHaveCount(0);
}
async function zip(page: Page) {
  return unzipSync(
    new Uint8Array(
      await page.evaluate(() => window.documentStudioTest.export()),
    ),
  );
}
function content(data: Record<string, Uint8Array>, format: Format) {
  return strFromU8(
    data[format === "docx" ? "word/document.xml" : "Contents/section0.xml"]!,
  );
}
async function execute(
  page: Page,
  command: Parameters<typeof window.documentStudioTest.execute>[0],
) {
  await page.evaluate(
    (command) => window.documentStudioTest.execute(command),
    command,
  );
}
for (const format of ["docx", "hwpx"] as const)
  test.describe(`${format} practical editing`, () => {
    test("generates a chart preview and inserts its locally rendered PNG", async ({
      page,
    }) => {
      await load(page, format, `blank.${format}`);
      await execute(page, { id: "selectAll" });
      await page
        .getByRole("button", { name: "문단·표·그림", exact: true })
        .click();
      await page.getByRole("tab", { name: "업무 자동화", exact: true }).click();
      await page
        .getByLabel("자동화 기능", { exact: true })
        .selectOption("차트");
      await page
        .getByLabel("차트 데이터", { exact: true })
        .fill("검토\t12\n확정\t8");
      await page
        .getByRole("button", { name: "결과 미리보기", exact: true })
        .click();
      await expect(
        page.getByAltText("업무 자동화 그림 미리보기"),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "그림을 선택 위치에 삽입", exact: true })
        .click();
      await expect(
        page.getByRole("button", {
          name: "그림을 선택 위치에 삽입",
          exact: true,
        }),
      ).toBeEnabled();
      await expect
        .poll(async () => {
          try {
            return content(await zip(page), format);
          } catch (error) {
            if (
              String(error).includes(
                "문서를 내보내는 동안 revision이 변경됐습니다",
              )
            )
              return "";
            throw error;
          }
        })
        .toContain(format === "docx" ? "w:drawing" : "hp:pic");
      if (format === "hwpx")
        expect(content(await zip(page), format)).toContain('treatAsChar="1"');
      await page
        .getByRole("button", { name: "문단·표·그림", exact: true })
        .click();
      if (format === "hwpx")
        await page
          .frameLocator("iframe")
          .locator("#scroll-container")
          .evaluate((el) => {
            el.scrollTop = 0;
          });
      await expect
        .poll(async () => {
          const png = PNG.sync.read(
            await page.locator(".ds-editor-body").screenshot(),
          );
          let colored = 0;
          for (let i = 0; i < png.data.length; i += 4)
            if (
              Math.abs(png.data[i]! - 65) < 3 &&
              Math.abs(png.data[i + 1]! - 110) < 3 &&
              Math.abs(png.data[i + 2]! - 159) < 3
            )
              colored++;
          return colored;
        })
        .toBeGreaterThan(100);
      await page.screenshot({ path: `.build/extended-${format}-chart.png` });
    });
    test("creates a markdown document from a read-only preview and invalidates it when the source changes", async ({
      page,
    }) => {
      await load(page, format, `blank.${format}`, true);
      await page
        .getByRole("button", { name: "문단·표·그림", exact: true })
        .click();
      await page.getByRole("tab", { name: "업무 자동화", exact: true }).click();
      await page
        .getByLabel("자동화 기능", { exact: true })
        .selectOption("마크다운 보고서");
      await page
        .getByLabel("보고서 마크다운", { exact: true })
        .fill(
          "# 회의 보고서\n검토를 마쳤습니다.\n\n| 항목 | 결과 |\n| --- | --- |\n| 서식 | 통과 |",
        );
      await page
        .getByRole("button", { name: "결과 미리보기", exact: true })
        .click();
      await expect(
        page.getByRole("button", {
          name: "구조를 유지해 새 문서 만들기",
          exact: true,
        }),
      ).toBeEnabled();
      await expect(
        page.getByLabel("업무 자동화 결과", { exact: true }),
      ).toHaveAttribute("readonly", "");
      await page
        .getByRole("button", { name: "원본 입력 수정", exact: true })
        .click();
      await expect(
        page.getByLabel("보고서 마크다운", { exact: true }),
      ).toBeFocused();
      await page.getByLabel("보고서 마크다운", { exact: true }).press("End");
      await page.getByLabel("보고서 마크다운", { exact: true }).press("Space");
      await expect(
        page.getByRole("button", {
          name: "구조를 유지해 새 문서 만들기",
          exact: true,
        }),
      ).toBeDisabled();
      await page
        .getByRole("button", { name: "결과 미리보기", exact: true })
        .click();
      await page
        .getByRole("button", {
          name: "구조를 유지해 새 문서 만들기",
          exact: true,
        })
        .click();
      await expect(
        page.getByRole("heading", {
          name: `회의 보고서.${format}`,
          exact: true,
        }),
      ).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(() => window.documentStudioTest.state()?.ready),
        )
        .toBe(true);
      await expect
        .poll(async () => content(await zip(page), format))
        .toContain("회의 보고서");
      expect(content(await zip(page), format)).toContain("통과");
    });
    test("persists text colors, cell alignment and physically converted borders", async ({
      page,
    }) => {
      await load(page, format, `blank.${format}`);
      await execute(page, { id: "selectAll" });
      await page.keyboard.insertText("서식 색상 검증");
      await execute(page, { id: "selectAll" });
      await execute(page, { id: "textColor", value: "#245f56" });
      await execute(page, { id: "highlightColor", value: "#ffff00" });
      const colored = await zip(page);
      const xml = strFromU8(
        colored[
          format === "docx" ? "word/document.xml" : "Contents/header.xml"
        ]!,
      ).toLowerCase();
      expect(xml).toContain("245f56");
      expect(xml).toContain(format === "docx" ? 'w:val="yellow"' : "ffff00");
      await page.keyboard.press("ArrowRight");
      await execute(page, {
        id: "insertTable",
        value: { rows: 2, columns: 2 },
      });
      await execute(page, { id: "cellVerticalAlign", value: "center" });
      await execute(page, {
        id: "tableBorders",
        value: { scope: "all", color: "#416e9f", widthPt: 1 },
      });
      const data = await zip(page);
      const borders = strFromU8(
        data[format === "docx" ? "word/document.xml" : "Contents/header.xml"]!,
      ).toLowerCase();
      expect(borders).toContain("416e9f");
      expect(borders).toContain(
        format === "docx" ? 'w:sz="8"' : 'width="0.4 mm"',
      );
    });
    test("opens and closes native tools without resetting the document", async ({
      page,
    }) => {
      await load(page, format);
      await execute(page, { id: "selectAll" });
      await page.keyboard.insertText("확장 패널 전환 중에도 보존할 편집본");
      const before = await page.evaluate(
        () => window.documentStudioTest.state()?.revision,
      );
      await page
        .getByRole("button", { name: "삽입·쪽 메뉴", exact: true })
        .click();
      if (format === "docx")
        await expect(
          page.getByLabel("DOCX 확장 도구", { exact: true }),
        ).toBeVisible();
      await page
        .getByRole("button", { name: "삽입·쪽 메뉴", exact: true })
        .click();
      expect(
        await page.evaluate(() => window.documentStudioTest.state()?.revision),
      ).toBe(before);
      expect(content(await zip(page), format)).toContain(
        "확장 패널 전환 중에도 보존할 편집본",
      );
    });
    for (const kind of ["unicode", "long"])
      test(`reads the complete ${kind} corpus, edits a targeted match and reopens`, async ({
        page,
      }) => {
        await load(page, format, `${kind}.${format}`);
        const before = await page.evaluate(async () =>
          window.documentStudioTest.agent.readDocument({
            documentId: window.documentStudioTest.agent.getState().documentId,
          }),
        );
        expect(before.truncated).toBe(false);
        expect(before.text).toContain(kind === "long" ? "업무 문단 200" : "👨‍👩‍👧‍👦");
        const request = await page.evaluate(
          async (query) => {
            const agent = window.documentStudioTest.agent,
              state = agent.getState();
            const found = await agent.search({
              documentId: state.documentId,
              query,
            });
            return {
              documentId: state.documentId,
              expectedSessionId: window.documentStudioTest.state()!.sessionId,
              expectedRevision: found.revision,
              matchId: found.matches[0]!.id,
              replacement: "정확히 지정한 위치 수정",
            };
          },
          kind === "long" ? "업무 문단 150" : "English",
        );
        await page.evaluate(
          (request) => window.documentStudioTest.agent.replace(request),
          request,
        );
        const bytes = await page.evaluate(() =>
          window.documentStudioTest.export(),
        );
        await page.reload();
        await page.waitForFunction(() => Boolean(window.documentStudioTest));
        await page.evaluate(
          ({ bytes, format }) =>
            window.documentStudioTest.loadBytes(bytes, format),
          { bytes, format },
        );
        await expect
          .poll(() =>
            page.evaluate(() => window.documentStudioTest.state()?.ready),
          )
          .toBe(true);
        const after = await page.evaluate(async () =>
          window.documentStudioTest.agent.readDocument({
            documentId: window.documentStudioTest.agent.getState().documentId,
          }),
        );
        expect(after.text).toContain("정확히 지정한 위치 수정");
        expect(after.text).toContain(kind === "long" ? "업무 문단 200" : "👨‍👩‍👧‍👦");
        expect(after.paragraphs.length).toBe(before.paragraphs.length);
      });
    test("matches whole words after emoji and can replace text with an empty string", async ({
      page,
    }) => {
      await load(page, format, `blank.${format}`);
      await execute(page, { id: "selectAll" });
      await page.keyboard.insertText("😀 cat concatenate CAT cat · 끝");
      // Native input publishes its revision asynchronously. Search is allowed to
      // reject a concurrent revision change, so first observe this edit settling.
      await expect
        .poll(() =>
          page.evaluate(() => window.documentStudioTest.state()?.dirty),
        )
        .toBe(true);
      const result = await page.evaluate(async () => {
        const a = window.documentStudioTest.agent,
          s = a.getState();
        const f = await a.search({
          documentId: s.documentId,
          query: "cat",
          wholeWord: true,
          matchCase: true,
        });
        const replaced = await a.replace({
          documentId: s.documentId,
          expectedSessionId: window.documentStudioTest.state()!.sessionId,
          expectedRevision: f.revision,
          matchId: f.matches[0]!.id,
          replacement: "",
        });
        return { found: f.total, replaced };
      });
      expect(result.found).toBe(2);
      expect(result.replaced.count).toBe(1);
      const xml = content(await zip(page), format);
      expect(xml).toContain("concatenate CAT cat · 끝");
      expect(xml).not.toContain("😀 cat");
    });
    test("exports a complete preset while its commands are in flight", async ({
      page,
    }) => {
      await load(page, format);
      await execute(page, { id: "selectAll" });
      const bytes = await page.evaluate(async () => {
        const agent = window.documentStudioTest.agent,
          state = agent.getState();
        const task = agent.applyPreset({
          documentId: state.documentId,
          expectedSessionId: window.documentStudioTest.state()!.sessionId,
          expectedRevision: state.revision,
          expectedSelectionKey: state.selectionKey!,
          preset: {
            id: "test",
            name: "제목",
            description: "",
            commands: [
              { id: "fontSize", value: 16 },
              { id: "alignCenter" },
              { id: "lineSpacing", value: 1.5 },
            ],
          },
        });
        const bytes = await window.documentStudioTest.export();
        await task;
        return bytes;
      });
      const data = unzipSync(new Uint8Array(bytes));
      const xml = strFromU8(
        data[format === "docx" ? "word/document.xml" : "Contents/header.xml"]!,
      );
      expect(xml).toContain(format === "docx" ? 'w:val="32"' : 'height="1600"');
      expect(xml).toContain(format === "docx" ? 'w:line="360"' : 'value="150"');
    });
    test("refuses invalid image decoding without changing the document", async ({
      page,
    }) => {
      await load(page, format);
      const before = await page.evaluate(
        () => window.documentStudioTest.state()?.revision,
      );
      const error = await page.evaluate(async () => {
        try {
          await window.documentStudioTest.execute({
            id: "insertImage",
            value: {
              bytes: new Uint8Array([137, 80, 78, 71]),
              mimeType: "image/png",
            },
          });
          return "";
        } catch (cause) {
          return String(cause);
        }
      });
      expect(error).not.toBe("");
      expect(
        await page.evaluate(() => window.documentStudioTest.state()?.revision),
      ).toBe(before);
      expect(content(await zip(page), format)).toContain("한국어 문장");
    });
    test("rejects a stale preset and destructive preset commands before mutation", async ({
      page,
    }) => {
      await load(page, format);
      const before = await page.evaluate(
        () => window.documentStudioTest.state()?.revision,
      );
      const failures = await page.evaluate(async () => {
        const a = window.documentStudioTest.agent,
          s = a.getState(),
          failures = [];
        for (const [revision, commands] of [
          ["stale", [{ id: "fontSize", value: 16 }]],
          [s.revision, [{ id: "insertText", value: "버리기" }]],
        ] as const) {
          try {
            await a.applyPreset({
              documentId: s.documentId,
              expectedSessionId: window.documentStudioTest.state()!.sessionId,
              expectedRevision: revision,
              expectedSelectionKey: a.getState().selectionKey!,
              preset: { id: "bad", name: "bad", description: "", commands },
            });
            failures.push("");
          } catch (c) {
            failures.push(String(c));
          }
        }
        return failures;
      });
      expect(failures.every(Boolean)).toBe(true);
      expect(
        await page.evaluate(() => window.documentStudioTest.state()?.revision),
      ).toBe(before);
    });
    test("generates a markdown report with a list and table, then edits its generated document", async ({
      page,
    }) => {
      await page.goto("/harness.html");
      await page.waitForFunction(() => Boolean(window.documentStudioTest));
      await page.evaluate(
        async (format) =>
          window.documentStudioTest.createTemplate(format, {
            fileName: "생성 보고서.docx",
            blocks: [
              { kind: "heading", level: 1, text: "자동 생성 한국어 보고서" },
              { kind: "paragraph", text: "근거와 검토 내용을 확인합니다." },
              { kind: "bullet", text: "첫 번째 항목" },
              { kind: "numbered", text: "추진 순서" },
              {
                kind: "table",
                rows: [
                  ["구분", "내용"],
                  ["검증", "마크다운 표"],
                ],
              },
            ],
          }),
        format,
      );
      await expect
        .poll(() =>
          page.evaluate(() => window.documentStudioTest.state()?.ready),
        )
        .toBe(true);
      const generated = content(await zip(page), format);
      expect(generated).toContain("자동 생성 한국어 보고서");
      expect(generated).toContain("마크다운 표");
      expect(generated).toContain(format === "docx" ? "w:tbl" : "hp:tbl");
      const state = await page.evaluate(
        () => window.documentStudioTest.state()!,
      );
      const found = await page.evaluate(
        (documentId) =>
          window.documentStudioTest.agent.search({
            documentId,
            query: "검토 내용",
          }),
        state.documentId,
      );
      await page.evaluate(
        ({ documentId, revision, matchId }) =>
          window.documentStudioTest.agent.replace({
            expectedSessionId: window.documentStudioTest.state()!.sessionId,
            documentId,
            expectedRevision: revision,
            matchId,
            replacement: "확정된 내용",
          }),
        {
          documentId: state.documentId,
          revision: found.revision,
          matchId: found.matches[0]!.id,
        },
      );
      expect(content(await zip(page), format)).toContain("확정된 내용");
    });
    test("uses the report automation UI to insert an accounting amount", async ({
      page,
    }) => {
      await load(page, format, `blank.${format}`);
      await execute(page, { id: "selectAll" });
      await page
        .getByRole("button", { name: "문단·표·그림", exact: true })
        .click();
      await page.getByRole("tab", { name: "업무 자동화", exact: true }).click();
      await page.getByLabel("금액 목록", { exact: true }).fill("12340");
      await page
        .getByRole("button", { name: "결과 미리보기", exact: true })
        .click();
      await expect(
        page.getByLabel("업무 자동화 결과", { exact: true }),
      ).toHaveValue("금12,340원(금일만이천삼백사십원)");
      await page
        .getByRole("button", {
          name: "텍스트로 삽입 · 표/서식 제외",
          exact: true,
        })
        .click();
      await expect
        .poll(async () => content(await zip(page), format))
        .toContain("금12,340원(금일만이천삼백사십원)");
    });
    test("replaces all duplicated phrases and refuses an old search result", async ({
      page,
    }) => {
      await load(page, format, `blank.${format}`);
      await execute(page, { id: "selectAll" });
      await page.keyboard.insertText("중복 항목 · 중복 항목 · 다른 항목");
      const result = await page.evaluate(async () => {
        const agent = window.documentStudioTest.agent,
          state = agent.getState();
        const found = await agent.search({
          documentId: state.documentId,
          query: "중복",
        });
        const replaced = await agent.replace({
          documentId: state.documentId,
          expectedSessionId: window.documentStudioTest.state()!.sessionId,
          expectedRevision: found.revision,
          query: "중복",
          replacement: "확인",
          all: true,
        });
        let stale = "";
        try {
          await agent.select({
            documentId: state.documentId,
            expectedSessionId: window.documentStudioTest.state()!.sessionId,
            expectedRevision: found.revision,
            matchId: found.matches[0]!.id,
          });
        } catch (cause) {
          stale = String(cause);
        }
        return { found, replaced, stale };
      });
      expect(result.found.total).toBe(2);
      expect(result.replaced.count).toBe(2);
      expect(result.stale).toContain("revision");
      const xml = content(await zip(page), format);
      expect(xml).toContain("확인");
      expect(xml).not.toContain("중복");
      expect(xml).toContain("다른 항목");
    });
    test("changes the page orientation and margins without removing content", async ({
      page,
    }) => {
      await load(page, format);
      await execute(page, {
        id: "pageSetup",
        value: {
          widthMm: 297,
          heightMm: 210,
          topMm: 15,
          bottomMm: 10,
          leftMm: 20,
          rightMm: 20,
          orientation: "landscape",
          scope: "document",
        },
      });
      await expect
        .poll(() =>
          page.evaluate(
            () => window.documentStudioTest.state()?.page?.orientation,
          ),
        )
        .toBe("landscape");
      expect(content(await zip(page), format)).toContain("한국어 문장");
      const snapshot = await page.evaluate(
        () => window.documentStudioTest.state()?.page,
      );
      expect(snapshot!.leftMm).toBeCloseTo(20, 1);
      expect(snapshot!.topMm).toBeCloseTo(15, 1);
    });
    test("applies extended paragraph settings from the shared UI and saves their units", async ({
      page,
    }) => {
      await load(page, format);
      await execute(page, { id: "selectAll" });
      await page
        .getByRole("button", { name: "문단·표·그림", exact: true })
        .click();
      await page.getByLabel("문단 앞 (pt)", { exact: true }).fill("6");
      await page.getByLabel("문단 뒤 (pt)", { exact: true }).fill("9");
      await page.getByLabel("왼쪽 들여쓰기 (mm)", { exact: true }).fill("10");
      await page.getByLabel("첫 줄 들여쓰기 (mm)", { exact: true }).fill("-5");
      await page.getByLabel("행간 종류", { exact: true }).selectOption("exact");
      await page.getByLabel("행간 값", { exact: true }).fill("18");
      await page
        .getByRole("button", { name: "문단 설정 적용", exact: true })
        .click();
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              window.documentStudioTest.state()?.paragraph?.lineSpacing?.rule,
          ),
        )
        .toBe("exact");
      const data = await zip(page);
      if (format === "docx") {
        const xml = content(data, format);
        expect(xml).toContain('w:before="120"');
        expect(xml).toContain('w:after="180"');
        expect(xml).toContain('w:line="360"');
        expect(xml).toContain('w:lineRule="exact"');
        expect(xml).toContain('w:left="567"');
        expect(xml).toContain('w:hanging="283"');
      } else {
        const xml = strFromU8(data["Contents/header.xml"]!);
        expect(xml).toContain('type="FIXED"');
        expect(xml).toContain('value="1800"');
        expect(xml).toContain('value="600"');
        expect(xml).toContain('value="900"');
      }
      expect(content(data, format)).toContain("한국어 문장");
    });
    test("reads, searches, selects and replaces a document-targeted Korean match", async ({
      page,
    }) => {
      await load(page, format);
      const result = await page.evaluate(async () => {
        const agent = window.documentStudioTest.agent,
          state = agent.getState();
        const document = await agent.readDocument({
          documentId: state.documentId,
        });
        const found = await agent.search({
          documentId: state.documentId,
          query: "한국어 문장",
        });
        if (!found.matches[0]) throw new Error("Missing match");
        await agent.select({
          documentId: state.documentId,
          expectedSessionId: window.documentStudioTest.state()!.sessionId,
          expectedRevision: found.revision,
          matchId: found.matches[0].id,
        });
        const changed = await agent.replace({
          documentId: state.documentId,
          expectedSessionId: window.documentStudioTest.state()!.sessionId,
          expectedRevision: found.revision,
          matchId: found.matches[0].id,
          replacement: "실무 보고서의 바뀐 문장",
        });
        return { document, found, changed };
      });
      expect(result.document.text).toContain("한국어 문장");
      expect(result.found.total).toBeGreaterThan(0);
      expect(result.changed).toMatchObject({
        applied: true,
        count: 1,
        dirty: true,
      });
      expect(content(await zip(page), format)).toContain(
        "실무 보고서의 바뀐 문장",
      );
      await execute(page, { id: "undo" });
      expect(content(await zip(page), format)).toContain("한국어 문장");
    });
    test("creates a table, inserts a row and applies a cell fill", async ({
      page,
    }) => {
      await load(page, format, `blank.${format}`);
      await execute(page, { id: "selectAll" });
      await execute(page, {
        id: "insertTable",
        value: { rows: 2, columns: 3 },
      });
      await expect
        .poll(() =>
          page.evaluate(
            () => window.documentStudioTest.state()?.table?.columns,
          ),
        )
        .toBe(3);
      await execute(page, { id: "insertRowBelow" });
      await expect
        .poll(() =>
          page.evaluate(() => window.documentStudioTest.state()?.table?.rows),
        )
        .toBe(3);
      await execute(page, { id: "cellFill", value: "#d9e8f5" });
      const data = await zip(page);
      if (format === "docx") {
        expect(content(data, format)).toContain("<w:tbl>");
        expect(content(data, format).toLowerCase()).toContain(
          'w:fill="d9e8f5"',
        );
      } else {
        expect(content(data, format)).toContain("<hp:tbl");
        expect(strFromU8(data["Contents/header.xml"]!).toLowerCase()).toContain(
          "#d9e8f5",
        );
      }
      await page.evaluate(() => window.documentStudioTest.save());
      expect(
        await page.evaluate(() => window.documentStudioTest.state()?.dirty),
      ).toBe(false);
    });
    test("inserts an image with bounded dimensions and preserves its media", async ({
      page,
    }) => {
      await load(page, format, `blank.${format}`);
      await execute(page, { id: "selectAll" });
      const source = unzipSync(
        new Uint8Array(await readFile("fixtures/rich.docx")),
      );
      const image = Object.entries(source).find(([name]) =>
        /^word\/media\/.*\.png$/.test(name),
      );
      expect(image).toBeDefined();
      await page.evaluate(async (bytes) => {
        await window.documentStudioTest.execute({
          id: "insertImage",
          value: {
            bytes: new Uint8Array(bytes),
            mimeType: "image/png",
            widthMm: 30,
            heightMm: 20,
            alt: "자체 제작 검증 그림",
          },
        });
      }, Array.from(image![1]));
      const data = await zip(page);
      expect(content(data, format)).toContain(
        format === "docx" ? "w:drawing" : "hp:pic",
      );
      const media = Object.entries(data).filter(([name]) =>
        format === "docx"
          ? /^word\/media\//.test(name)
          : /^BinData\//.test(name),
      );
      expect(
        media.some(([, bytes]) =>
          Buffer.from(bytes).equals(Buffer.from(image![1])),
        ),
      ).toBe(true);
      await execute(page, { id: "undo" });
      expect(content(await zip(page), format)).not.toContain(
        format === "docx" ? "w:drawing" : "hp:pic",
      );
    });
  });
test("preserves nested DOCX tables when editing the surrounding body", async ({
  page,
}) => {
  await load(page, "docx", "nested.docx");
  const result = await page.evaluate(async () => {
    const agent = window.documentStudioTest.agent,
      state = agent.getState();
    const doc = await agent.readDocument({ documentId: state.documentId });
    const found = await agent.search({
      documentId: state.documentId,
      query: "중첩 구조 검증",
    });
    await agent.replace({
      documentId: state.documentId,
      expectedSessionId: window.documentStudioTest.state()!.sessionId,
      expectedRevision: found.revision,
      matchId: found.matches[0]!.id,
      replacement: "검토한 중첩 구조",
    });
    return doc;
  });
  expect(result.text).toContain("중첩 표 보존 텍스트");
  const xml = content(await zip(page), "docx");
  expect(xml.match(/<w:tbl>/g)).toHaveLength(2);
  expect(xml).toContain("중첩 표 보존 텍스트");
  expect(xml).toContain("검토한 중첩 구조");
});
