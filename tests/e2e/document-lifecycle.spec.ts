import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";

type Format = "docx" | "hwpx";
const errors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  const messages: string[] = [];
  errors.set(page, messages);
  page.on("pageerror", (error) => messages.push(error.message));
});
test.afterEach(({ page }) => expect(errors.get(page)).toEqual([]));

async function ready(page: Page) {
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
  await expect(
    page.getByRole("status").filter({ hasText: "저장하지 않은 변경사항" }),
  ).toBeVisible();
}
async function download(page: Page, button = "다운로드") {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: button, exact: true }).click();
  const file = await pending;
  return unzipSync(new Uint8Array(await readFile((await file.path())!)));
}
function body(zip: Record<string, Uint8Array>, format: Format) {
  return strFromU8(
    zip[format === "docx" ? "word/document.xml" : "Contents/section0.xml"]!,
  );
}
function expectFormat(zip: Record<string, Uint8Array>, format: Format) {
  if (format === "docx") {
    expect(body(zip, format)).toContain('w:val="28"');
    expect(body(zip, format)).toContain('w:line="360"');
  } else {
    const header = strFromU8(zip["Contents/header.xml"]!);
    expect(header).toContain('height="1400"');
    expect(header).toContain('value="150"');
  }
}
async function workspace(page: Page, format: Format) {
  await page.goto("/");
  await page
    .getByRole("button", {
      name: `${format.toUpperCase()} 예제 →`,
      exact: true,
    })
    .click();
  await ready(page);
}
async function sdk(page: Page, format: Format, disabled = false) {
  await page.goto("/harness.html");
  await page.waitForFunction(() => Boolean(window.documentStudioTest));
  await page.evaluate(
    async ({ format, disabled }) => {
      window.documentStudioTest.draftsDisabled = disabled;
      await window.documentStudioTest.load(format);
    },
    { format, disabled },
  );
  await ready(page);
}
async function reopenDraft(page: Page, format: Format) {
  await expect(page.getByText("편집기 닫힘", { exact: true })).toBeVisible();
  await page.evaluate(
    (format) => window.documentStudioTest.load(format),
    format,
  );
  await page.getByRole("button", { name: "초안 복구", exact: true }).click();
  await ready(page);
  const bytes = await page.evaluate(() => window.documentStudioTest.export());
  return body(unzipSync(new Uint8Array(bytes)), format);
}

for (const format of ["docx", "hwpx"] as const) {
  const second = format === "docx" ? "hwpx" : "docx";
  test.describe(`${format} document lifecycle`, () => {
    test("resets the editing baseline after explicitly opening a same-version source replacement", async ({
      page,
    }) => {
      await sdk(page, format);
      await edit(page, format, "새 원본에서 사라질 이전 편집");
      await page.evaluate(() => window.documentStudioTest.replaceSameVersion());
      await page
        .getByRole("button", { name: "새 원본 열기", exact: true })
        .click();
      await ready(page);
      await expect
        .poll(() =>
          page.evaluate(() => window.documentStudioTest.state()?.dirty),
        )
        .toBe(false);
      await edit(page, format, "새 원본을 연 뒤 다시 편집");
      const bytes = await page.evaluate(() =>
        window.documentStudioTest.export(),
      );
      expect(body(unzipSync(new Uint8Array(bytes)), format)).toContain(
        "새 원본을 연 뒤 다시 편집",
      );
      expect(
        await page.evaluate(() => window.documentStudioTest.state()?.dirty),
      ).toBe(true);
    });
    test("keeps input when switching before the three-second autosave", async ({
      page,
    }, info) => {
      await workspace(page, format);
      await page
        .getByLabel("문서 파일")
        .setInputFiles(`fixtures/sample.${second}`);
      await expect(
        page.getByRole("heading", { name: `sample.${second}`, exact: true }),
      ).toBeVisible();
      await ready(page);
      const tabs = page
        .getByRole("navigation", { name: "열린 문서" })
        .getByRole("button");
      await tabs.nth(0).click();
      await ready(page);
      const start = Date.now();
      await edit(page, format, "전환 직전에 입력한 보존 필수 문장");
      await tabs.nth(1).click();
      await page
        .getByRole("button", { name: "문서 전환", exact: true })
        .click();
      const elapsed = Date.now() - start;
      await expect(
        page.getByRole("heading", { name: `sample.${second}`, exact: true }),
      ).toBeVisible();
      await ready(page);
      await tabs.nth(0).click();
      await page
        .getByRole("button", { name: "초안 복구", exact: true })
        .click();
      await ready(page);
      expect(body(await download(page), format)).toContain(
        "전환 직전에 입력한 보존 필수 문장",
      );
      expect(elapsed).toBeLessThan(3000);
      await info.attach("switch-timing", {
        body: JSON.stringify({ elapsed }),
        contentType: "application/json",
      });
    });

    test("requires confirmation for edits made while File.arrayBuffer is pending", async ({
      page,
    }) => {
      await page.addInitScript(() => {
        const original = File.prototype.arrayBuffer;
        File.prototype.arrayBuffer = async function () {
          await new Promise((resolve) => setTimeout(resolve, 1500));
          return original.call(this);
        };
      });
      await workspace(page, format);
      await page
        .getByLabel("문서 파일")
        .setInputFiles(`fixtures/sample.${second}`);
      await edit(page, format, "읽기 대기 중에 작성한 새 변경사항");
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect(
        page.getByRole("heading", { name: `예제 문서.${format}`, exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: `sample.${second}`, exact: true }),
      ).toHaveCount(0);
      await page
        .getByRole("button", { name: "계속 편집", exact: true })
        .click();
      expect(body(await download(page), format)).toContain(
        "읽기 대기 중에 작성한 새 변경사항",
      );
    });

    test("retains saved text and formatting on reopen, and a later draft uses that saved baseline", async ({
      page,
    }) => {
      await workspace(page, format);
      await edit(page, format, "저장 완료한 최신 편집본");
      await page.keyboard.press("Control+a");
      const font = page.getByRole("spinbutton", {
        name: "글자 크기",
        exact: true,
      });
      await font.fill("14");
      await font.press("Enter");
      await expect(font).toHaveValue("14");
      await page.getByLabel("행간", { exact: true }).selectOption("1.5");
      await expect(page.getByLabel("행간", { exact: true })).toHaveValue("1.5");
      const saved = await download(page, "저장하고 다운로드");
      expect(body(saved, format)).toContain("저장 완료한 최신 편집본");
      expectFormat(saved, format);
      await expect(
        page.getByRole("status").filter({ hasText: "문서 변경사항 저장됨" }),
      ).toBeVisible();
      await expect(page.getByRole("alert")).toHaveCount(0);
      await page
        .getByLabel("문서 파일")
        .setInputFiles(`fixtures/sample.${second}`);
      await expect(
        page.getByRole("heading", { name: `sample.${second}`, exact: true }),
      ).toBeVisible();
      await ready(page);
      const tabs = page
        .getByRole("navigation", { name: "열린 문서" })
        .getByRole("button");
      await tabs.nth(0).click();
      await ready(page);
      await expect(page.getByRole("dialog")).toHaveCount(0);
      const reopened = await download(page);
      expect(body(reopened, format)).toContain("저장 완료한 최신 편집본");
      expectFormat(reopened, format);
      await edit(page, format, "저장 후 이어서 작성한 초안");
      await tabs.nth(1).click();
      await page
        .getByRole("button", { name: "문서 전환", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: `sample.${second}`, exact: true }),
      ).toBeVisible();
      await ready(page);
      await tabs.nth(0).click();
      await expect(page.getByRole("dialog")).not.toContainText(
        "원본 버전이 달라졌습니다",
      );
      await page
        .getByRole("button", { name: "초안 복구", exact: true })
        .click();
      await ready(page);
      await expect(
        page.getByRole("button", { name: "저장하고 다운로드", exact: true }),
      ).toBeEnabled();
      expect(body(await download(page), format)).toContain(
        "저장 후 이어서 작성한 초안",
      );
    });

    test("keeps the current document if the transition draft transaction fails, then allows retry", async ({
      page,
    }) => {
      await page.addInitScript(() => {
        const original = IDBObjectStore.prototype.put;
        let fail = true;
        IDBObjectStore.prototype.put = function (...args) {
          if (this.name === "drafts" && fail) {
            fail = false;
            throw new DOMException(
              "Injected quota failure",
              "QuotaExceededError",
            );
          }
          return original.apply(this, args);
        };
      });
      await workspace(page, format);
      await page
        .getByLabel("문서 파일")
        .setInputFiles(`fixtures/sample.${second}`);
      await expect(
        page.getByRole("heading", { name: `sample.${second}`, exact: true }),
      ).toBeVisible();
      await ready(page);
      const tabs = page
        .getByRole("navigation", { name: "열린 문서" })
        .getByRole("button");
      await tabs.nth(0).click();
      await ready(page);
      await edit(page, format, "저장 실패에도 현재 문서 유지");
      await tabs.nth(1).click();
      await page
        .getByRole("button", { name: "문서 전환", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: `예제 문서.${format}`, exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect(page.getByRole("alert").first()).toContainText(
        "현재 문서는 유지",
      );
      await expect(
        page.getByRole("button", { name: "문서 전환", exact: true }),
      ).toBeEnabled();
      await page
        .getByRole("button", { name: "문서 전환", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: `sample.${second}`, exact: true }),
      ).toBeVisible();
      await ready(page);
      await tabs.nth(0).click();
      await page
        .getByRole("button", { name: "초안 복구", exact: true })
        .click();
      await ready(page);
      expect(body(await download(page), format)).toContain(
        "저장 실패에도 현재 문서 유지",
      );
    });

    test("an embedded host can flush and unmount immediately without waiting for autosave", async ({
      page,
    }) => {
      await sdk(page, format);
      const start = Date.now();
      await edit(page, format, "앱 탭을 닫기 전 명시적으로 보관한 초안");
      await page.evaluate(() => window.documentStudioTest.closeAfterDraft());
      expect(Date.now() - start).toBeLessThan(3000);
      expect(await reopenDraft(page, format)).toContain(
        "앱 탭을 닫기 전 명시적으로 보관한 초안",
      );
    });

    test("does not authorize unmount if explicit draft persistence fails", async ({
      page,
    }) => {
      await sdk(page, format);
      await edit(page, format, "SDK 초안 저장 실패 시 유지할 내용");
      const message = await page.evaluate(async () => {
        window.documentStudioTest.failDraftStorage = true;
        try {
          await window.documentStudioTest.closeAfterDraft();
        } catch (cause) {
          return String(cause);
        }
        return null;
      });
      expect(message).toContain("현재 문서는 유지");
      await expect(page.getByText("편집기 닫힘", { exact: true })).toHaveCount(
        0,
      );
      const bytes = await page.evaluate(() =>
        window.documentStudioTest.export(),
      );
      expect(body(unzipSync(new Uint8Array(bytes)), format)).toContain(
        "SDK 초안 저장 실패 시 유지할 내용",
      );
      await page.evaluate(async () => {
        window.documentStudioTest.failDraftStorage = false;
        await window.documentStudioTest.closeAfterDraft();
      });
      expect(await reopenDraft(page, format)).toContain(
        "SDK 초안 저장 실패 시 유지할 내용",
      );
    });

    test("exports newer input after an already running autosave finishes", async ({
      page,
    }) => {
      await sdk(page, format);
      await page.evaluate(() => {
        window.documentStudioTest.draftDelay = 1500;
      });
      await edit(page, format, "이전 자동 저장 내용");
      await expect
        .poll(() => page.evaluate(() => window.documentStudioTest.draftStarts))
        .toBe(1);
      await edit(page, format, "자동 저장 도중 추가한 최신 내용");
      await page.evaluate(() => window.documentStudioTest.closeAfterDraft());
      expect(
        await page.evaluate(() => window.documentStudioTest.draftWrites),
      ).toBe(2);
      expect(await reopenDraft(page, format)).toContain(
        "자동 저장 도중 추가한 최신 내용",
      );
    });

    test("rejects a dirty transition when draft storage is disabled", async ({
      page,
    }) => {
      await sdk(page, format, true);
      await edit(page, format, "초안 저장소 없는 호스트의 편집 내용");
      const message = await page.evaluate(async () => {
        try {
          await window.documentStudioTest.closeAfterDraft();
        } catch (cause) {
          return String(cause);
        }
        return null;
      });
      expect(message).toContain("비활성화");
      await expect(page.getByText("편집기 닫힘", { exact: true })).toHaveCount(
        0,
      );
      const zip = await download(page);
      expect(body(zip, format)).toContain(
        "초안 저장소 없는 호스트의 편집 내용",
      );
    });

    test("does not interrupt an active host save to switch documents", async ({
      page,
    }) => {
      await sdk(page, format);
      await edit(page, format, "서버 저장 완료를 기다려야 하는 내용");
      await page.evaluate(() => {
        window.documentStudioTest.mode = "delayed";
        void window.documentStudioTest.save();
      });
      await expect
        .poll(() => page.evaluate(() => window.documentStudioTest.saves))
        .toBe(1);
      const message = await page.evaluate(async () => {
        try {
          await window.documentStudioTest.closeAfterDraft();
        } catch (cause) {
          return String(cause);
        }
        return null;
      });
      expect(message).toContain("저장을 완료한 뒤");
      await expect(page.getByText("편집기 닫힘", { exact: true })).toHaveCount(
        0,
      );
      await expect
        .poll(() =>
          page.evaluate(() => window.documentStudioTest.state()?.dirty),
        )
        .toBe(false);
      await page.evaluate(() => window.documentStudioTest.closeAfterDraft());
      await expect(
        page.getByText("편집기 닫힘", { exact: true }),
      ).toBeVisible();
    });

    test("commits the save version and reports sync warnings without blocking the next edit", async ({
      page,
    }) => {
      await sdk(page, format);
      await edit(page, format, "동기화 경고가 있어도 서버에 저장한 문서");
      await page.evaluate(async () => {
        window.documentStudioTest.mode = "warning";
        await window.documentStudioTest.save();
      });
      await expect(page.getByRole("alert")).toContainText(
        "파일은 저장됐지만 샌드박스 반영",
      );
      const state = await page.evaluate(() =>
        window.documentStudioTest.state(),
      );
      expect(state).toMatchObject({
        version: "v2",
        dirty: false,
        warnings: [{ code: "sandbox-sync-pending" }],
      });
      await expect(
        page.getByRole("button", { name: "저장", exact: true }),
      ).toBeEnabled();
      const event = await page.evaluate(
        () => window.documentStudioTest.savedEvent,
      );
      expect(event).toMatchObject({
        documentId: `test:sample.${format}`,
        version: "v2",
        format,
      });
      expect(body(unzipSync(new Uint8Array(event!.bytes)), format)).toContain(
        "동기화 경고가 있어도 서버에 저장한 문서",
      );
      expect(await page.evaluate(() => window.documentStudioTest.saves)).toBe(
        1,
      );
      await edit(page, format, "동기화 경고 이후의 새 편집 내용");
      await page.evaluate(async () => {
        window.documentStudioTest.mode = "success";
        await window.documentStudioTest.save();
      });
      expect(
        await page.evaluate(() => window.documentStudioTest.expectedVersions),
      ).toEqual(["v1", "v2"]);
      await expect(page.getByRole("alert")).toHaveCount(0);
      expect(
        await page.evaluate(() => window.documentStudioTest.state()),
      ).toMatchObject({ version: "v3", dirty: false, warnings: [] });
    });
  });
}
