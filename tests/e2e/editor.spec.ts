import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { strFromU8, unzipSync, zipSync } from "fflate";
const pageErrors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
});
test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page), "Unhandled browser errors").toEqual([]);
});

async function load(page: Page, format: "docx" | "hwpx") {
  await page.goto("/harness.html");
  await page.waitForFunction(() => Boolean(window.documentStudioTest));
  await page.evaluate(
    (format) => window.documentStudioTest.load(format),
    format,
  );
  await expect
    .poll(() => page.evaluate(() => window.documentStudioTest.state()?.ready))
    .toBe(true);
  await expect(page.getByRole("alert")).toHaveCount(0);
}
async function textFrom(page: Page, format: "docx" | "hwpx") {
  const bytes = await page.evaluate(() => window.documentStudioTest.export());
  const zip = unzipSync(new Uint8Array(bytes));
  return strFromU8(
    zip[format === "docx" ? "word/document.xml" : "Contents/section0.xml"]!,
  );
}
for (const format of ["docx", "hwpx"] as const) {
  test.describe(format, () => {
    test("protects input when a host update arrives before a dirty-state polling cycle", async ({
      page,
    }) => {
      await load(page, format);
      await page.evaluate(() =>
        window.documentStudioTest.execute({ id: "selectAll" }),
      );
      await page.keyboard.insertText("상태 조회 전에도 보존할 입력");
      await page.evaluate(() => window.documentStudioTest.updateVersion("v9"));
      await expect(page.getByRole("alert")).toContainText("현재 편집본은 유지");
      expect(await textFrom(page, format)).toContain(
        "상태 조회 전에도 보존할 입력",
      );
    });
    test("stages external source replacement even if the loaded snapshot is clean", async ({
      page,
    }) => {
      await load(page, format);
      expect(
        await page.evaluate(() => window.documentStudioTest.state()?.dirty),
      ).toBe(false);
      await page.evaluate(() => window.documentStudioTest.updateVersion("v9"));
      await expect(
        page.getByRole("button", { name: "새 원본 열기", exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(() => window.documentStudioTest.state()?.version),
      ).toBe("v1");
    });
    test("retains unsaved protection after clicking the current file tab", async ({
      page,
    }) => {
      await page.goto("/");
      await page
        .getByRole("button", {
          name: `${format.toUpperCase()} 예제 →`,
          exact: true,
        })
        .click();
      await expect(
        page.getByRole("button", { name: "굵게", exact: true }),
      ).toBeEnabled();
      if (format === "docx")
        await page
          .getByRole("textbox", { name: "Document content", exact: true })
          .focus();
      else
        await page
          .frameLocator("iframe")
          .getByLabel("문서 편집 입력", { exact: true })
          .focus();
      await page.keyboard.press("Control+a");
      await page.keyboard.insertText("현재 탭을 눌러도 초안 유지");
      await expect(
        page.getByRole("status").filter({ hasText: "저장하지 않은 변경사항" }),
      ).toBeVisible();
      await page
        .getByRole("navigation", { name: "열린 문서" })
        .getByRole("button")
        .click();
      const next = format === "docx" ? "hwpx" : "docx";
      await page
        .getByLabel("문서 파일")
        .setInputFiles(`fixtures/sample.${next}`);
      await expect(page.getByRole("dialog")).toBeVisible();
    });
    test("applies a document-targeted agent request and returns an updated receipt", async ({
      page,
    }) => {
      await load(page, format);
      const result = await page.evaluate(async () => {
        await window.documentStudioTest.execute({ id: "selectAll" });
        const agent = window.documentStudioTest.agent;
        const before = agent.getState();
        const receipt = await agent.execute({
          documentId: before.documentId,
          expectedSessionId: window.documentStudioTest.state()!.sessionId,
          expectedRevision: before.revision,
          expectedSelectionKey: before.selectionKey!,
          command: { id: "lineSpacing", value: 1.8 },
        });
        return { before, receipt, commands: agent.listCommands() };
      });
      expect(result.receipt.documentId).toBe(result.before.documentId);
      expect(result.receipt.revision).not.toBe(result.before.revision);
      expect(result.receipt.dirty).toBe(true);
      expect(
        result.commands.find((command) => command.id === "lineSpacing"),
      ).toMatchObject({
        supported: true,
        enabled: true,
        input: { unit: "multiple" },
      });
      expect(
        await page.evaluate(
          () => window.documentStudioTest.state()?.lineSpacing,
        ),
      ).toBe(1.8);
    });
    test("commits a focused font input before Ctrl+S exports the document", async ({
      page,
    }) => {
      await load(page, format);
      await page.evaluate(() =>
        window.documentStudioTest.execute({ id: "selectAll" }),
      );
      const input = page.getByRole("spinbutton", {
        name: "글자 크기",
        exact: true,
      });
      await input.fill("14");
      await input.press("Control+s");
      await expect
        .poll(() => page.evaluate(() => window.documentStudioTest.saves))
        .toBe(1);
      await expect
        .poll(() =>
          page.evaluate(() => window.documentStudioTest.state()?.dirty),
        )
        .toBe(false);
      const saved = unzipSync(
        new Uint8Array(
          await page.evaluate(() => window.documentStudioTest.saved),
        ),
      );
      const xml = strFromU8(
        saved[format === "docx" ? "word/document.xml" : "Contents/header.xml"]!,
      );
      expect(xml).toContain(format === "docx" ? 'w:val="28"' : 'height="1400"');
      expect(
        strFromU8(
          saved[
            format === "docx" ? "word/document.xml" : "Contents/section0.xml"
          ]!,
        ),
      ).toContain("한국어 문장");
    });
    test("commits font size with Enter without replacing the selected document", async ({
      page,
    }) => {
      await load(page, format);
      const before = await textFrom(page, format);
      const text = (xml: string) =>
        Array.from(
          xml.matchAll(/<(?:w|hp):t(?:\s[^>]*)?>([^<]*)<\/(?:w|hp):t>/g),
          (match) => match[1],
        ).join("");
      await page.evaluate(() =>
        window.documentStudioTest.execute({ id: "selectAll" }),
      );
      const input = page.getByRole("spinbutton", {
        name: "글자 크기",
        exact: true,
      });
      await input.fill("14");
      await input.press("Enter");
      await expect
        .poll(() =>
          page.evaluate(() => window.documentStudioTest.state()?.fontSize),
        )
        .toBe(14);
      const after = await textFrom(page, format);
      expect(text(after)).toBe(text(before));
      if (format === "docx") expect(after).toContain('w:val="28"');
      else {
        const zip = unzipSync(
          new Uint8Array(
            await page.evaluate(() => window.documentStudioTest.export()),
          ),
        );
        expect(strFromU8(zip["Contents/header.xml"]!)).toContain(
          'height="1400"',
        );
      }
    });
    test("reports a draft storage failure while edits remain downloadable", async ({
      page,
    }) => {
      await load(page, format);
      await page.evaluate(async () => {
        window.documentStudioTest.failDraftStorage = true;
        await window.documentStudioTest.execute({ id: "selectAll" });
      });
      await page.keyboard.insertText("초안 저장 오류에도 편집 유지");
      await expect(page.getByRole("alert")).toContainText("초안 저장에 실패");
      expect(await textFrom(page, format)).toContain(
        "초안 저장 오류에도 편집 유지",
      );
      expect(
        await page.evaluate(() => window.documentStudioTest.state()?.dirty),
      ).toBe(true);
    });
    test("reports a ZIP container that is not a supported document", async ({
      page,
    }) => {
      await page.goto("/harness.html");
      await page.waitForFunction(() => Boolean(window.documentStudioTest));
      await page.evaluate(
        ({ bytes, format }) =>
          window.documentStudioTest.loadBytes(bytes, format),
        {
          bytes: Array.from(
            zipSync({ "not-a-document.txt": new Uint8Array([1, 2, 3]) }),
          ),
          format,
        },
      );
      await expect(page.getByRole("alert")).toBeVisible();
      await expect(
        page.getByRole("button", { name: "저장", exact: true }),
      ).toBeDisabled();
    });
    test("renders the shared toolbar and preserves source text on export", async ({
      page,
    }) => {
      await load(page, format);
      await expect(
        page.getByRole("toolbar", { name: "문서 서식" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "굵게", exact: true }),
      ).toBeEnabled();
      const xml = await textFrom(page, format);
      expect(xml).toContain("공개 편집 검증 문서");
      expect(xml).toContain("한국어 문장");
      expect(
        await page.evaluate(() => window.documentStudioTest.state()?.dirty),
      ).toBe(false);
    });
    test("types Korean, Latin, emoji and punctuation then saves and reopens", async ({
      page,
    }) => {
      await load(page, format);
      await page.evaluate(() =>
        window.documentStudioTest.execute({ id: "selectAll" }),
      );
      await page.keyboard.insertText("한글 입력 검증 ABC 123 😀 & < >");
      await expect
        .poll(() =>
          page.evaluate(() => window.documentStudioTest.state()?.dirty),
        )
        .toBe(true);
      const before = await textFrom(page, format);
      expect(before).toContain("한글 입력 검증 ABC 123");
      expect(before).toContain("😀");
      await page.evaluate(() => window.documentStudioTest.save());
      const saved = await page.evaluate(() => window.documentStudioTest.saved);
      expect(saved.length).toBeGreaterThan(100);
      const previousSession = await page.evaluate(
        () => window.documentStudioTest.state()!.sessionId,
      );
      await page.evaluate(
        ({ bytes, format }) =>
          window.documentStudioTest.loadBytes(bytes, format),
        { bytes: saved, format },
      );
      await expect
        .poll(() =>
          page.evaluate((previous) => {
            const state = window.documentStudioTest.state();
            return state?.ready && state.sessionId !== previous;
          }, previousSession),
        )
        .toBe(true);
      expect(await textFrom(page, format)).toContain("한글 입력 검증 ABC 123");
    });
    test("uses toolbar formatting, agent line spacing and font size", async ({
      page,
    }) => {
      await load(page, format);
      await page.evaluate(() =>
        window.documentStudioTest.execute({ id: "selectAll" }),
      );
      await page.getByRole("button", { name: "기울임", exact: true }).click();
      await page
        .getByRole("combobox", { name: "행간", exact: true })
        .selectOption("1.5");
      await page.evaluate(() =>
        window.documentStudioTest.execute({ id: "fontSize", value: 14 }),
      );
      await expect
        .poll(() =>
          page.evaluate(() => window.documentStudioTest.state()?.dirty),
        )
        .toBe(true);
      const xml = await textFrom(page, format);
      if (format === "docx") {
        expect(xml).toContain('w:line="360"');
        expect(xml).toContain('w:val="28"');
        expect(xml).toMatch(/<w:i(?: |\/>)/);
      } else {
        const bytes = await page.evaluate(() =>
          window.documentStudioTest.export(),
        );
        const zip = unzipSync(new Uint8Array(bytes));
        const header = strFromU8(zip["Contents/header.xml"]!);
        expect(header).toMatch(/value="150"/);
        expect(header).toMatch(/height="1400"/);
      }
      expect(
        await page.evaluate(
          () => window.documentStudioTest.state()?.lineSpacing,
        ),
      ).toBe(1.5);
    });
    test("undo and redo restore actual exported content", async ({ page }) => {
      await load(page, format);
      await page.evaluate(() =>
        window.documentStudioTest.execute({ id: "selectAll" }),
      );
      await page.keyboard.insertText("되돌리기와 다시 실행");
      expect(await textFrom(page, format)).toContain("되돌리기와 다시 실행");
      await page.evaluate(() =>
        window.documentStudioTest.execute({ id: "undo" }),
      );
      expect(await textFrom(page, format)).not.toContain(
        "되돌리기와 다시 실행",
      );
      await page.evaluate(() =>
        window.documentStudioTest.execute({ id: "redo" }),
      );
      expect(await textFrom(page, format)).toContain("되돌리기와 다시 실행");
    });
    test("retains drafts on host save failure and succeeds on retry", async ({
      page,
    }) => {
      await load(page, format);
      await page.evaluate(async () => {
        await window.documentStudioTest.execute({ id: "selectAll" });
        await window.documentStudioTest.execute({
          id: "lineSpacing",
          value: 2,
        });
        window.documentStudioTest.mode = "failure";
      });
      await page.getByRole("button", { name: "저장", exact: true }).click();
      await expect(page.getByRole("alert")).toContainText("테스트 저장 실패");
      expect(
        await page.evaluate(() => window.documentStudioTest.state()?.dirty),
      ).toBe(true);
      await page.evaluate(() => {
        window.documentStudioTest.mode = "success";
      });
      await page.getByRole("button", { name: "저장", exact: true }).click();
      await expect
        .poll(() =>
          page.evaluate(() => window.documentStudioTest.state()?.dirty),
        )
        .toBe(false);
      expect(
        await page.evaluate(() => window.documentStudioTest.expectedVersions),
      ).toEqual(["v1", "v1"]);
    });
    test("blocks overwrite after conflict while draft download stays available", async ({
      page,
    }) => {
      await load(page, format);
      await page.evaluate(async () => {
        await window.documentStudioTest.execute({ id: "selectAll" });
        await window.documentStudioTest.execute({
          id: "lineSpacing",
          value: 2,
        });
        window.documentStudioTest.mode = "conflict";
      });
      await page.getByRole("button", { name: "저장", exact: true }).click();
      await expect(page.getByRole("alert")).toContainText("원본 문서가 변경");
      await expect(
        page.getByRole("button", { name: "저장", exact: true }),
      ).toBeDisabled();
      const downloaded = page.waitForEvent("download");
      await page.getByRole("button", { name: "다운로드", exact: true }).click();
      expect((await downloaded).suggestedFilename()).toBe(`sample.${format}`);
      expect(
        await page.evaluate(() => window.documentStudioTest.state()?.dirty),
      ).toBe(true);
    });
    test("recovers an unsaved draft after reload", async ({ page }) => {
      await load(page, format);
      await page.evaluate(() =>
        window.documentStudioTest.execute({ id: "selectAll" }),
      );
      await page.keyboard.insertText("새로고침 복구 검증");
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              new Promise<boolean>((resolve, reject) => {
                const request = indexedDB.open("document-studio-drafts", 1);
                request.onsuccess = () => {
                  const db = request.result;
                  const tx = db.transaction("drafts");
                  const read = tx
                    .objectStore("drafts")
                    .get(
                      JSON.stringify([
                        "sdk-tests",
                        `test:sample.${window.documentStudioTest.state()?.format}`,
                      ]),
                    );
                  read.onsuccess = () => {
                    resolve(Boolean(read.result));
                    db.close();
                  };
                  read.onerror = () => reject(read.error);
                };
                request.onerror = () => reject(request.error);
              }),
          ),
        )
        .toBe(true);
      await page.reload();
      await page.waitForFunction(() => Boolean(window.documentStudioTest));
      await page.evaluate(
        (format) => window.documentStudioTest.load(format),
        format,
      );
      await expect(page.getByRole("dialog")).toContainText(
        "저장하지 않은 초안",
      );
      await page
        .getByRole("button", { name: "초안 복구", exact: true })
        .click();
      await expect
        .poll(() =>
          page.evaluate(() => window.documentStudioTest.state()?.ready),
        )
        .toBe(true);
      expect(await textFrom(page, format)).toContain("새로고침 복구 검증");
      expect(
        await page.evaluate(() => window.documentStudioTest.state()?.dirty),
      ).toBe(true);
      await page.evaluate(() => window.documentStudioTest.save());
      await page.waitForTimeout(1000);
      expect(
        await page.evaluate(() => window.documentStudioTest.state()?.dirty),
      ).toBe(false);
    });
    test("updates host version between consecutive saves", async ({ page }) => {
      await load(page, format);
      await page.evaluate(async () => {
        await window.documentStudioTest.execute({ id: "selectAll" });
        await window.documentStudioTest.execute({
          id: "lineSpacing",
          value: 2,
        });
        await window.documentStudioTest.save();
        await window.documentStudioTest.execute({
          id: "lineSpacing",
          value: 1.5,
        });
        await window.documentStudioTest.save();
      });
      expect(
        await page.evaluate(() => window.documentStudioTest.expectedVersions),
      ).toEqual(["v1", "v2"]);
      expect(
        await page.evaluate(() => window.documentStudioTest.state()?.dirty),
      ).toBe(false);
    });
    test("guards unsaved close and preserves editing when canceled", async ({
      page,
    }) => {
      await load(page, format);
      await page.evaluate(async () => {
        await window.documentStudioTest.execute({ id: "selectAll" });
        await window.documentStudioTest.execute({
          id: "lineSpacing",
          value: 2,
        });
      });
      await page.getByRole("button", { name: "닫기", exact: true }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page
        .getByRole("button", { name: "계속 편집", exact: true })
        .click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      expect(
        await page.evaluate(() => window.documentStudioTest.state()?.dirty),
      ).toBe(true);
    });
    test("does not fetch external document processing services", async ({
      page,
      baseURL,
    }) => {
      const external: string[] = [];
      page.on("request", (request) => {
        const url = request.url();
        if (
          /^https?:/.test(url) &&
          new URL(url).origin !== new URL(baseURL!).origin
        )
          external.push(url);
      });
      await load(page, format);
      await textFrom(page, format);
      expect(external).toEqual([]);
    });
    test("preserves rich document text, tables and embedded image bytes", async ({
      page,
    }) => {
      await page.goto("/harness.html");
      await page.waitForFunction(() => Boolean(window.documentStudioTest));
      await page.evaluate(
        (format) => window.documentStudioTest.load(format, `rich.${format}`),
        format,
      );
      await expect
        .poll(() =>
          page.evaluate(() => window.documentStudioTest.state()?.ready),
        )
        .toBe(true);
      await page.evaluate(async () => {
        await window.documentStudioTest.execute({ id: "selectAll" });
        await window.documentStudioTest.execute({
          id: "lineSpacing",
          value: 1.8,
        });
      });
      const source = unzipSync(
        new Uint8Array(await readFile(`fixtures/rich.${format}`)),
      );
      const exported = unzipSync(
        new Uint8Array(
          await page.evaluate(() => window.documentStudioTest.export()),
        ),
      );
      const main =
        format === "docx" ? "word/document.xml" : "Contents/section0.xml";
      const originalText = Array.from(
        strFromU8(source[main]!).matchAll(
          /<(?:w|hp):t(?:\s[^>]*)?>([^<]*)<\/(?:w|hp):t>/g,
        ),
        (match) => match[1],
      ).join("");
      const savedText = Array.from(
        strFromU8(exported[main]!).matchAll(
          /<(?:w|hp):t(?:\s[^>]*)?>([^<]*)<\/(?:w|hp):t>/g,
        ),
        (match) => match[1],
      ).join("");
      expect(savedText).toBe(originalText);
      expect(strFromU8(exported[main]!)).toContain(
        format === "docx" ? "<w:tbl" : "<hp:tbl",
      );
      const images = Object.keys(source).filter(
        (name) => !name.endsWith("/") && /^(word\/media|BinData)\//.test(name),
      );
      expect(images.length).toBeGreaterThan(0);
      for (const name of images)
        expect(exported[name], name).toEqual(source[name]);
      if (format === "docx") {
        expect(strFromU8(exported["word/header1.xml"]!)).toContain(
          "머리말 보존 검증",
        );
        expect(strFromU8(exported["word/footer1.xml"]!)).toContain(
          "꼬리말 보존 검증",
        );
      }
      expect(
        await page.evaluate(() => window.documentStudioTest.state()?.pageCount),
      ).toBeGreaterThan(1);
    });
    test("edits and exports a blank document", async ({ page }) => {
      await page.goto("/harness.html");
      await page.waitForFunction(() => Boolean(window.documentStudioTest));
      await page.evaluate(
        (format) => window.documentStudioTest.load(format, `blank.${format}`),
        format,
      );
      await expect
        .poll(() =>
          page.evaluate(() => window.documentStudioTest.state()?.ready),
        )
        .toBe(true);
      await page.evaluate(() =>
        window.documentStudioTest.execute({ id: "selectAll" }),
      );
      await page.keyboard.insertText("빈 문서에서 시작");
      expect(await textFrom(page, format)).toContain("빈 문서에서 시작");
    });
    test("guards an agent command with a stale revision", async ({ page }) => {
      await load(page, format);
      const revision = await page.evaluate(
        () => window.documentStudioTest.state()!.revision,
      );
      await page.evaluate(async () => {
        await window.documentStudioTest.execute({ id: "selectAll" });
        await window.documentStudioTest.execute({
          id: "lineSpacing",
          value: 2,
        });
      });
      const result = await page.evaluate(async (revision) => {
        try {
          await window.documentStudioTest.execute(
            { id: "lineSpacing", value: 1.5 },
            { expectedRevision: revision },
          );
          return "unexpected success";
        } catch (cause) {
          return String(cause);
        }
      }, revision);
      expect(result).toContain("revision");
      expect(
        await page.evaluate(
          () => window.documentStudioTest.state()?.lineSpacing,
        ),
      ).toBe(2);
    });
    test("prevents duplicate save and agent mutation while save is in flight", async ({
      page,
    }) => {
      await load(page, format);
      await page.evaluate(async () => {
        await window.documentStudioTest.execute({ id: "selectAll" });
        await window.documentStudioTest.execute({
          id: "lineSpacing",
          value: 2,
        });
        window.documentStudioTest.mode = "delayed";
      });
      const result = await page.evaluate(async () => {
        const first = window.documentStudioTest.save();
        const second = window.documentStudioTest.save();
        let message = "";
        try {
          await window.documentStudioTest.execute({ id: "bold" });
        } catch (cause) {
          message = String(cause);
        }
        await Promise.all([first, second]);
        return message;
      });
      expect(result).toContain("저장 중");
      expect(await page.evaluate(() => window.documentStudioTest.saves)).toBe(
        1,
      );
    });
    test("rejects invalid agent input without changing bytes", async ({
      page,
    }) => {
      await load(page, format);
      const before = await textFrom(page, format);
      const result = await page.evaluate(async () => {
        try {
          await window.documentStudioTest.execute({
            id: "lineSpacing",
            value: 0,
          });
          return "unexpected success";
        } catch (cause) {
          return String(cause);
        }
      });
      expect(result).toContain("허용 범위");
      expect(await textFrom(page, format)).toBe(before);
    });
    test("changes zoom without marking the document dirty", async ({
      page,
    }) => {
      await load(page, format);
      await page
        .getByRole("combobox", { name: "확대", exact: true })
        .selectOption("125");
      await expect
        .poll(() =>
          page.evaluate(() =>
            Math.round((window.documentStudioTest.state()?.zoom ?? 0) * 100),
          ),
        )
        .toBe(125);
      expect(
        await page.evaluate(() => window.documentStudioTest.state()?.dirty),
      ).toBe(false);
    });
    test("intercepts Ctrl+S through the shared host save flow", async ({
      page,
    }) => {
      await load(page, format);
      await page.evaluate(() =>
        window.documentStudioTest.execute({ id: "selectAll" }),
      );
      await page.keyboard.insertText("단축키 저장 검증");
      await page.keyboard.press("Control+s");
      await expect
        .poll(() => page.evaluate(() => window.documentStudioTest.saves))
        .toBe(1);
      await expect
        .poll(() =>
          page.evaluate(() => window.documentStudioTest.state()?.dirty),
        )
        .toBe(false);
    });
    test("commits browser IME composition without duplicate Korean text", async ({
      page,
      context,
    }) => {
      await load(page, format);
      await page.evaluate(() =>
        window.documentStudioTest.execute({ id: "selectAll" }),
      );
      const cdp = await context.newCDPSession(page);
      await cdp.send("Input.imeSetComposition", {
        text: "ㅎ",
        selectionStart: 1,
        selectionEnd: 1,
      });
      await cdp.send("Input.imeSetComposition", {
        text: "한",
        selectionStart: 1,
        selectionEnd: 1,
      });
      await cdp.send("Input.imeSetComposition", {
        text: "한글",
        selectionStart: 2,
        selectionEnd: 2,
      });
      await cdp.send("Input.insertText", { text: "한글" });
      await page.keyboard.insertText(" 조합 검증");
      let xml = "";
      await expect
        .poll(async () => {
          try {
            xml = await textFrom(page, format);
            return xml;
          } catch (cause) {
            // IME commits can still be in flight. Retry only the documented export
            // revision conflict; parsing and other failures must fail this test.
            if (String(cause).includes("내보내는 동안 revision")) return "";
            throw cause;
          }
        })
        .toContain("한글 조합 검증");
      expect(xml).toContain("한글 조합 검증");
      expect(xml.match(/한글 조합 검증/g)?.length).toBe(1);
      await cdp.detach();
    });
    test("retains line breaks and tabs after a keyboard edit", async ({
      page,
    }) => {
      await load(page, format);
      await page.evaluate(() =>
        window.documentStudioTest.execute({ id: "selectAll" }),
      );
      await page.keyboard.insertText("첫 번째 줄");
      await page.keyboard.press("Enter");
      await page.keyboard.insertText("두 번째 줄");
      await page.keyboard.press("Tab");
      await page.keyboard.insertText("탭 뒤 텍스트");
      // Finish pending native input and hold the public snapshot boundary while exporting.
      // Concurrent exports are tested separately and must reject a changed revision.
      await page.evaluate(() => window.documentStudioTest.acquireInputLock());
      let xml: string;
      try {
        xml = await textFrom(page, format);
      } finally {
        await page.evaluate(() => window.documentStudioTest.releaseInputLock());
      }
      expect(xml).toContain("첫 번째 줄");
      expect(xml).toContain("두 번째 줄");
      expect(xml).toContain("탭 뒤 텍스트");
      expect(xml).toMatch(format === "docx" ? /<w:tab/ : /<hp:tab/);
    });
    test("changes font family through the shared dropdown", async ({
      page,
    }) => {
      await load(page, format);
      await page.evaluate(() =>
        window.documentStudioTest.execute({ id: "selectAll" }),
      );
      await page
        .getByRole("combobox", { name: "글꼴", exact: true })
        .selectOption("Arial");
      const zip = unzipSync(
        new Uint8Array(
          await page.evaluate(() => window.documentStudioTest.export()),
        ),
      );
      expect(
        strFromU8(
          zip[format === "docx" ? "word/document.xml" : "Contents/header.xml"]!,
        ),
      ).toContain("Arial");
      expect(
        await page.evaluate(
          () => window.documentStudioTest.state()?.fontFamily,
        ),
      ).toBe("Arial");
    });
    test("preserves the active draft when the host supplies a newer source version", async ({
      page,
    }) => {
      await load(page, format);
      await page.evaluate(() =>
        window.documentStudioTest.execute({ id: "selectAll" }),
      );
      await page.keyboard.insertText("외부 변경에도 유지할 초안");
      await expect
        .poll(() =>
          page.evaluate(() => window.documentStudioTest.state()?.dirty),
        )
        .toBe(true);
      await page.evaluate(() => window.documentStudioTest.updateVersion("v9"));
      await expect(page.getByRole("alert")).toContainText("현재 편집본은 유지");
      expect(await textFrom(page, format)).toContain(
        "외부 변경에도 유지할 초안",
      );
      await expect(
        page.getByRole("button", { name: "저장", exact: true }),
      ).toBeDisabled();
      await page
        .getByRole("button", { name: "새 원본 열기", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "새 원본 열기", exact: true }),
      ).toHaveCount(0);
      await expect
        .poll(() =>
          page.evaluate(() => ({
            ready: window.documentStudioTest.state()?.ready,
            version: window.documentStudioTest.state()?.version,
          })),
        )
        .toEqual({ ready: true, version: "v9" });
      expect(await textFrom(page, format)).not.toContain(
        "외부 변경에도 유지할 초안",
      );
      expect(
        await page.evaluate(() => window.documentStudioTest.state()?.version),
      ).toBe("v9");
    });
    test("preserves later edits when the host acknowledges our own save version", async ({
      page,
    }) => {
      await load(page, format);
      await page.evaluate(async () => {
        await window.documentStudioTest.execute({ id: "selectAll" });
        await window.documentStudioTest.execute({
          id: "lineSpacing",
          value: 2,
        });
        await window.documentStudioTest.save();
        await window.documentStudioTest.execute({ id: "selectAll" });
      });
      await page.keyboard.insertText("저장 이후의 새 편집 유지");
      await expect
        .poll(() =>
          page.evaluate(() => window.documentStudioTest.state()?.dirty),
        )
        .toBe(true);
      await page.evaluate(() =>
        window.documentStudioTest.acknowledgeSavedSource(),
      );
      await page.waitForTimeout(500);
      expect(await textFrom(page, format)).toContain(
        "저장 이후의 새 편집 유지",
      );
      expect(
        await page.evaluate(() => window.documentStudioTest.state()?.dirty),
      ).toBe(true);
      await expect(
        page.getByRole("button", { name: "새 원본 열기", exact: true }),
      ).toHaveCount(0);
    });
    test("protects the draft if source bytes change without a version bump", async ({
      page,
    }) => {
      await load(page, format);
      await page.evaluate(() =>
        window.documentStudioTest.execute({ id: "selectAll" }),
      );
      await page.keyboard.insertText("버전이 없는 교체에도 초안 보호");
      await expect
        .poll(() =>
          page.evaluate(() => window.documentStudioTest.state()?.dirty),
        )
        .toBe(true);
      await page.evaluate(() => window.documentStudioTest.replaceSameVersion());
      await expect(page.getByRole("alert")).toContainText("현재 편집본은 유지");
      expect(await textFrom(page, format)).toContain(
        "버전이 없는 교체에도 초안 보호",
      );
    });
    test("keeps a confirmed save successful when the file-list callback fails", async ({
      page,
    }) => {
      await load(page, format);
      await page.evaluate(async () => {
        await window.documentStudioTest.execute({ id: "selectAll" });
        await window.documentStudioTest.execute({
          id: "lineSpacing",
          value: 2,
        });
        window.documentStudioTest.failSavedCallback = true;
        await window.documentStudioTest.save();
      });
      await expect(page.getByRole("alert")).toContainText(
        "문서는 저장됐지만 후속 처리",
      );
      expect(
        await page.evaluate(() => window.documentStudioTest.state()?.dirty),
      ).toBe(false);
      expect(await page.evaluate(() => window.documentStudioTest.saves)).toBe(
        1,
      );
    });
  });
}
test("rejects unsupported and corrupt local files", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("문서 파일").setInputFiles({
    name: "invalid.xlsx",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("test"),
  });
  await expect(page.getByRole("alert")).toContainText("HWPX와 DOCX");
  await page.getByLabel("문서 파일").setInputFiles({
    name: "invalid.docx",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("not a zip"),
  });
  await expect(page.getByRole("alert")).toContainText("올바른 ZIP");
});
test("keeps HWPX keyboard formatting consistent with the first observed new revision", async ({
  page,
}) => {
  await load(page, "hwpx");
  await page.evaluate(() =>
    window.documentStudioTest.execute({ id: "selectAll" }),
  );
  const previous = await page.evaluate(
    () => window.documentStudioTest.state()!.revision,
  );
  await page.keyboard.press("Control+b");
  await expect
    .poll(() =>
      page.evaluate(() => window.documentStudioTest.state()!.revision),
    )
    .not.toBe(previous);
  expect(
    await page.evaluate(
      () => window.documentStudioTest.state()!.commands.bold?.active,
    ),
  ).toBe(true);
  await page.evaluate(async () => {
    const agent = window.documentStudioTest.agent;
    const state = agent.getState();
    await agent.execute({
      documentId: state.documentId,
      expectedSessionId: window.documentStudioTest.state()!.sessionId,
      expectedRevision: state.revision,
      expectedSelectionKey: state.selectionKey!,
      command: { id: "bold" },
    });
  });
  expect(
    await page.evaluate(
      () => window.documentStudioTest.state()!.commands.bold?.active,
    ),
  ).toBe(false);
});
test("isolates commands, edits and shortcuts between two simultaneous engines", async ({
  page,
}) => {
  await page.goto("/multi-harness.html");
  await page.waitForFunction(
    () =>
      window.documentStudioMulti?.state(0)?.ready &&
      window.documentStudioMulti.state(1)?.ready,
  );
  const before = await page.evaluate(() =>
    window.documentStudioMulti.export(1),
  );
  await page.evaluate(() =>
    window.documentStudioMulti.execute(0, { id: "selectAll" }),
  );
  await page.keyboard.insertText("첫 편집기에만 입력");
  expect(
    await page.evaluate(() => window.documentStudioMulti.export(1)),
  ).toEqual(before);
  expect(
    await page.evaluate(() => window.documentStudioMulti.state(1)?.dirty),
  ).toBe(false);
  await page.keyboard.press("Control+s");
  await expect
    .poll(() => page.evaluate(() => window.documentStudioMulti.saves))
    .toEqual([1, 0]);
  await page.evaluate(async () => {
    await window.documentStudioMulti.execute(1, { id: "selectAll" });
    await window.documentStudioMulti.execute(1, {
      id: "lineSpacing",
      value: 2,
    });
  });
  expect(
    await page.evaluate(() => window.documentStudioMulti.state(0)?.dirty),
  ).toBe(false);
  expect(
    await page.evaluate(() => window.documentStudioMulti.state(1)?.dirty),
  ).toBe(true);
});
test("has no horizontal overflow on a narrow device", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.getByRole("button", { name: "DOCX 예제 →" }).click();
  await expect(
    page.getByRole("button", { name: "굵게", exact: true }),
  ).toBeEnabled();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
});
