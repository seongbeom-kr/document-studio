import { expect, test, type Page } from "@playwright/test";
import { unzipSync, strFromU8 } from "fflate";
type Format = "docx" | "hwpx";
async function start(page: Page, format: Format) {
  await page.goto("/harness.html");
  await page.waitForFunction(() => !!window.documentStudioTest);
  await page.evaluate(
    (format) => window.documentStudioTest.load(format),
    format,
  );
  await expect(
    page.getByRole("button", { name: "굵게", exact: true }),
  ).toBeEnabled();
}
async function edit(page: Page, format: Format, text: string) {
  const input =
    format === "docx"
      ? page.getByRole("textbox", { name: "Document content", exact: true })
      : page
          .frameLocator("iframe")
          .getByLabel("문서 편집 입력", { exact: true });
  await input.focus();
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText(text);
  await expect
    .poll(() => page.evaluate(() => window.documentStudioTest.state()?.dirty))
    .toBe(true);
}
async function content(page: Page, format: Format) {
  const bytes = await page.evaluate(() => window.documentStudioTest.export());
  return strFromU8(
    unzipSync(new Uint8Array(bytes))[
      format === "docx" ? "word/document.xml" : "Contents/section0.xml"
    ]!,
  );
}
for (const format of ["docx", "hwpx"] as const)
  test.describe(`${format} review regressions`, () => {
    test("guards readonly commands and saves while keeping document export available", async ({
      page,
    }) => {
      await start(page, format);
      await page.evaluate(() => {
        window.documentStudioTest.readOnly = true;
        window.documentStudioTest.rerender();
      });
      await expect(
        page.getByRole("button", { name: "굵게", exact: true }),
      ).toBeDisabled();
      await expect(
        page.getByRole("button", { name: "저장", exact: true }),
      ).toBeDisabled();
      expect(
        await page.evaluate(
          () => window.documentStudioTest.state()?.commands.bold?.enabled,
        ),
      ).toBe(false);
      const result = await page.evaluate(async () => {
        try {
          await window.documentStudioTest.execute({
            id: "insertText",
            value: "blocked",
          });
          return "accepted";
        } catch (e) {
          return String(e);
        }
      });
      expect(result).toContain("읽기 전용");
      expect(await content(page, format)).not.toContain("blocked");
    });
    test("commits a successful save even if the engine acknowledgement fails; the next edit uses the committed version", async ({
      page,
    }) => {
      await start(page, format);
      await edit(page, format, "저장 후처리 경계 시험");
      await page.evaluate(async () => {
        window.documentStudioTest.failEngineAcknowledgement = true;
        await window.documentStudioTest.save();
      });
      await expect
        .poll(() =>
          page.evaluate(() => window.documentStudioTest.state()?.dirty),
        )
        .toBe(false);
      expect(
        await page.evaluate(
          () => window.documentStudioTest.savedEvent?.version,
        ),
      ).toBe("v2");
      await expect(
        page.getByRole("alert").filter({ hasText: "엔진" }),
      ).toBeVisible();
      await edit(page, format, "두 번째 저장 시험");
      await page.evaluate(async () => {
        window.documentStudioTest.failEngineAcknowledgement = false;
        await window.documentStudioTest.save();
      });
      expect(
        await page.evaluate(() => window.documentStudioTest.expectedVersions),
      ).toEqual(["v1", "v2"]);
      await expect
        .poll(() =>
          page.evaluate(() => window.documentStudioTest.state()?.dirty),
        )
        .toBe(false);
    });
    test("does not mark an invalid storage response as saved", async ({
      page,
    }) => {
      await start(page, format);
      await edit(page, format, "저장 응답 검증 시험");
      const result = await page.evaluate(async () => {
        window.documentStudioTest.mode = "invalid-version";
        try {
          await window.documentStudioTest.save();
          return "accepted";
        } catch (e) {
          return String(e);
        }
      });
      expect(result).not.toBe("accepted");
      expect(
        await page.evaluate(() => window.documentStudioTest.state()?.dirty),
      ).toBe(true);
      expect(
        await page.evaluate(() => window.documentStudioTest.state()?.version),
      ).toBe("v1");
      expect(
        await page.evaluate(() => window.documentStudioTest.savedEvent),
      ).toBeNull();
    });
    test("switches a clean document with props alone", async ({ page }) => {
      await start(page, format);
      await page.evaluate(
        (format) => window.documentStudioTest.load(format, `blank.${format}`),
        format,
      );
      await expect
        .poll(() =>
          page.evaluate(() => window.documentStudioTest.state()?.documentId),
        )
        .toBe(`test:blank.${format}`);
      await expect(
        page.getByRole("button", { name: "굵게", exact: true }),
      ).toBeEnabled();
      await expect(page.getByRole("alert")).toHaveCount(0);
    });
    test("keeps a dirty document on an unapproved props switch and blocks saving to the incoming target", async ({
      page,
    }) => {
      await start(page, format);
      await edit(page, format, "전환 승인 전 초안 유지");
      await page.evaluate(
        (format) => window.documentStudioTest.load(format, `blank.${format}`),
        format,
      );
      await expect(page.getByRole("alert")).toBeVisible();
      expect(await content(page, format)).toContain("전환 승인 전 초안 유지");
      const result = await page.evaluate(async () => {
        try {
          await window.documentStudioTest.save();
          return "accepted";
        } catch (e) {
          return String(e);
        }
      });
      expect(result).not.toBe("accepted");
      expect(await page.evaluate(() => window.documentStudioTest.saves)).toBe(
        0,
      );
    });
    test("permits a dirty props switch after preserving the latest draft", async ({
      page,
    }) => {
      await start(page, format);
      await edit(page, format, "저장한 전환 초안");
      await page.evaluate(async (format) => {
        await window.documentStudioTest.flushDraft();
        await window.documentStudioTest.load(format, `blank.${format}`);
      }, format);
      await expect
        .poll(() =>
          page.evaluate(() => window.documentStudioTest.state()?.documentId),
        )
        .toBe(`test:blank.${format}`);
      expect(
        await page.evaluate(() => window.documentStudioTest.draftWrites),
      ).toBeGreaterThan(0);
      await expect(page.getByRole("alert")).toHaveCount(0);
    });
    test("keeps edits when the host recreates engine definitions during render", async ({
      page,
    }) => {
      await start(page, format);
      await edit(page, format, "호스트 재렌더 입력 유지");
      await page.evaluate(() => window.documentStudioTest.rerender());
      expect(await content(page, format)).toContain("호스트 재렌더 입력 유지");
      expect(
        await page.evaluate(() => window.documentStudioTest.state()?.dirty),
      ).toBe(true);
    });
  });
