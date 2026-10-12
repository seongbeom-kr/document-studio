import { expect, test, type Page } from "@playwright/test";
import { unzipSync, strFromU8 } from "fflate";
type Format = "docx" | "hwpx";
const ready = (page: Page) =>
  expect
    .poll(() => page.evaluate(() => window.documentStudioTest.state()?.ready))
    .toBe(true);
async function start(page: Page, format: Format) {
  await page.goto("/harness.html");
  await page.waitForFunction(() => !!window.documentStudioTest);
  await page.evaluate(
    (format) => window.documentStudioTest.load(format),
    format,
  );
  await ready(page);
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
function xml(bytes: number[], format: Format) {
  return strFromU8(
    unzipSync(new Uint8Array(bytes))[
      format === "docx" ? "word/document.xml" : "Contents/section0.xml"
    ]!,
  );
}
for (const format of ["docx", "hwpx"] as const)
  test.describe(`${format} adversarial recovery`, () => {
    test("checks the target's existing draft before opening a staged source", async ({
      page,
    }) => {
      await start(page, format);
      await page.evaluate(
        async (format) =>
          window.documentStudioTest.seedDraft(
            format,
            `blank.${format}`,
            "대상 문서에 먼저 보관한 초안",
          ),
        format,
      );
      const before = await page.evaluate(
        (format) => window.documentStudioTest.storedDraft(`blank.${format}`),
        format,
      );
      await edit(page, format, "전환 전 현재 문서의 최신 입력");
      await page.evaluate(
        (format) => window.documentStudioTest.load(format, `blank.${format}`),
        format,
      );
      await page
        .getByRole("button", { name: "새 원본 열기", exact: true })
        .click();
      await expect(page.getByRole("dialog")).toContainText(
        "저장하지 않은 초안",
      );
      expect(
        await page.evaluate(
          (format) => window.documentStudioTest.storedDraft(`blank.${format}`),
          format,
        ),
      ).toEqual(before);
      await page
        .getByRole("button", { name: "초안 복구", exact: true })
        .click();
      await ready(page);
      expect(
        xml(
          await page.evaluate(() => window.documentStudioTest.export()),
          format,
        ),
      ).toContain("대상 문서에 먼저 보관한 초안");
      expect(
        xml(
          (await page.evaluate(
            (format) =>
              window.documentStudioTest.storedDraft(`sample.${format}`),
            format,
          ))!,
          format,
        ),
      ).toContain("전환 전 현재 문서의 최신 입력");
    });
    test("stops draft writes when the host disables recovery storage", async ({
      page,
    }) => {
      await start(page, format);
      await edit(page, format, "초안을 비활성화한 문서");
      await page.evaluate(() =>
        window.documentStudioTest.setDraftPolicy("off"),
      );
      const before = await page.evaluate(
        () => window.documentStudioTest.draftStarts,
      );
      const result = await page.evaluate(async () => {
        try {
          await window.documentStudioTest.flushDraft();
          return "allowed";
        } catch (e) {
          return String(e);
        }
      });
      expect(result).toContain("비활성화");
      await page.waitForTimeout(3200);
      expect(
        await page.evaluate(() => window.documentStudioTest.draftStarts),
      ).toBe(before);
      expect(
        xml(
          await page.evaluate(() => window.documentStudioTest.export()),
          format,
        ),
      ).toContain("초안을 비활성화한 문서");
    });
    test("lets the user discard a corrupt draft and open the valid original", async ({
      page,
    }) => {
      await page.goto("/harness.html");
      await page.waitForFunction(() => !!window.documentStudioTest);
      await page.evaluate(async (format) => {
        await window.documentStudioTest.seedDraft(
          format,
          `sample.${format}`,
          "",
          true,
        );
        await window.documentStudioTest.load(format);
      }, format);
      await expect(page.getByRole("dialog")).toContainText("복구 초안이 손상");
      await expect(
        page.getByRole("button", { name: "초안 복구", exact: true }),
      ).toBeDisabled();
      await page
        .getByRole("button", {
          name: "손상된 초안 버리고 원본 열기",
          exact: true,
        })
        .click();
      await ready(page);
      expect(
        await page.evaluate(
          (format) => window.documentStudioTest.storedDraft(`sample.${format}`),
          format,
        ),
      ).toBeNull();
      expect(
        xml(
          await page.evaluate(() => window.documentStudioTest.export()),
          format,
        ),
      ).toContain("한국어 문장");
    });
    test("finishes loading when the draft store changes during an initial lookup with the same document object", async ({
      page,
    }) => {
      await page.goto("/harness.html");
      await page.waitForFunction(() => !!window.documentStudioTest);
      await page.evaluate(async (format) => {
        window.documentStudioTest.draftGetDelay = 1500;
        await window.documentStudioTest.load(format);
      }, format);
      await expect
        .poll(() => page.evaluate(() => window.documentStudioTest.draftGets))
        .toBe(1);
      await page.evaluate(() =>
        window.documentStudioTest.setDraftPolicy("secondary"),
      );
      await ready(page);
      await page.waitForTimeout(1600);
      expect(
        await page.evaluate(() => window.documentStudioTest.state()?.ready),
      ).toBe(true);
      expect(
        await page.evaluate(
          () => window.documentStudioTest.state()?.documentId,
        ),
      ).toBe(`test:sample.${format}`);
    });
    test("allows a save retry after a temporary serialization revision conflict", async ({
      page,
    }) => {
      await start(page, format);
      await edit(page, format, "一時的な内出力エラーから復旧한 내용");
      const result = await page.evaluate(async () => {
        window.documentStudioTest.failExports = 1;
        try {
          await window.documentStudioTest.save();
          return "allowed";
        } catch (e) {
          return String(e);
        }
      });
      expect(result).toContain("revision");
      expect(await page.evaluate(() => window.documentStudioTest.saves)).toBe(
        0,
      );
      await expect(
        page.getByRole("button", { name: "저장", exact: true }),
      ).toBeEnabled();
      await page.evaluate(() => window.documentStudioTest.save());
      expect(await page.evaluate(() => window.documentStudioTest.saves)).toBe(
        1,
      );
      expect(
        await page.evaluate(() => window.documentStudioTest.state()?.dirty),
      ).toBe(false);
    });
  });
