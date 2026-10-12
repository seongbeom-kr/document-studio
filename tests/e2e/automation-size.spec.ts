import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { draftKey } from "../../packages/core/src/index";
const limit = 1_000_000;
type Format = "docx" | "hwpx";
const draft = (input: string) => ({
  input,
  argument: "",
  transform: "trim",
  delimiter: "auto",
});
test("real IndexedDB adapter captures the validated value before caller mutation", async ({
  page,
}) => {
  await page.goto("/harness.html");
  await page.waitForFunction(() => window.documentStudioTest);
  const result = await page.evaluate(async () => {
    const store = window.documentStudioTest.automationStore;
    const value = {
      version: 1 as const,
      utility: "마크다운 보고서",
      drafts: {
        "마크다운 보고서": {
          input: "original",
          argument: "",
          transform: "trim" as const,
          delimiter: "auto",
        },
      },
    };
    const writing = store.put("direct-writer-isolation", value);
    value.drafts["마크다운 보고서"].input = "x".repeat(1_000_001);
    await writing;
    return (await store.get("direct-writer-isolation"))!.drafts[
      "마크다운 보고서"
    ]!.input;
  });
  expect(result).toBe("original");
});
async function open(page: Page, format: Format) {
  await page.goto("/harness.html");
  await page.waitForFunction(() => window.documentStudioTest);
  await page.evaluate(async (format) => {
    window.documentStudioTest.persistAutomation = true;
    await window.documentStudioTest.load(format, `blank.${format}`);
  }, format);
  await expect(
    page.getByRole("button", { name: "굵게", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "문단·표·그림", exact: true }).click();
  await page.getByRole("tab", { name: "업무 자동화", exact: true }).click();
}
async function stored(page: Page, format: Format) {
  return page.evaluate(
    async (key) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("document-studio-automation", 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        return await new Promise<any>((resolve, reject) => {
          const request = db
            .transaction("drafts")
            .objectStore("drafts")
            .get(key);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      } finally {
        db.close();
      }
    },
    draftKey("sdk-tests", `test:blank.${format}`),
  );
}
for (const format of ["docx", "hwpx"] as const) {
  test(`${format}: real IndexedDB preserves the exact limit, rejects overflow and downloads the whole pending input`, async ({
    page,
  }) => {
    test.setTimeout(90000);
    await open(page, format);
    await page.getByLabel("금액 목록", { exact: true }).fill("7654");
    await page
      .getByLabel("자동화 기능", { exact: true })
      .selectOption("마크다운 보고서");
    const text = "가".repeat(limit),
      oversized = text + "X";
    const input = page.getByLabel("보고서 마크다운", { exact: true });
    await input.fill(text);
    await page.evaluate(() => window.documentStudioTest.flushDraft());
    expect(
      (await stored(page, format)).drafts["마크다운 보고서"].input.length,
    ).toBe(limit);
    await page.getByRole("button", { name: "닫기", exact: true }).click();
    await expect(page.getByText("편집기 닫힘", { exact: true })).toBeVisible();
    await open(page, format);
    expect(
      await input.evaluate(
        (element, text) => (element as HTMLTextAreaElement).value === text,
        text,
      ),
    ).toBe(true);
    await input.fill(oversized);
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("[data-automation-length]")).toContainText(
      "1,000,001",
    );
    await expect(page.getByRole("alert")).toContainText("1,000,001");
    const failure = await page.evaluate(async () => {
      try {
        await window.documentStudioTest.flushDraft();
        return "accepted";
      } catch (e) {
        return String(e);
      }
    });
    expect(failure).toContain("1,000,001");
    expect(
      await input.evaluate(
        (element, text) => (element as HTMLTextAreaElement).value === text,
        oversized,
      ),
    ).toBe(true);
    expect(
      (await stored(page, format)).drafts["마크다운 보고서"].input.length,
    ).toBe(limit);
    expect((await stored(page, format)).drafts["금액 한글화"].input).toBe(
      "7654",
    );
    const downloadPromise = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "모든 자동화 입력 내려받기", exact: true })
      .click();
    const download = await downloadPromise;
    const json = JSON.parse(await readFile((await download.path())!, "utf8"));
    expect(json.drafts["마크다운 보고서"].input === oversized).toBe(true);
    expect(json.drafts["금액 한글화"].input).toBe("7654");
    await page.screenshot({
      path: `.build/fixes-0.2.10/${format}-overflow.png`,
    });
    await input.fill("수정한 정상 입력");
    await page.evaluate(() => window.documentStudioTest.flushDraft());
    await page.getByRole("button", { name: "닫기", exact: true }).click();
    await open(page, format);
    await expect(input).toHaveValue("수정한 정상 입력");
  });
  test(`${format}: a legacy oversized record retains other tools and can be downloaded and repaired`, async ({
    page,
  }) => {
    test.setTimeout(90000);
    await page.goto("/harness.html");
    await page.waitForFunction(() => window.documentStudioTest);
    const legacy = {
      version: 1,
      utility: "마크다운 보고서",
      drafts: {
        "마크다운 보고서": draft("x".repeat(limit + 1)),
        "금액 한글화": draft("2468"),
      },
    };
    // Seed a record produced by 0.2.9, before the current adapter write validator existed.
    await page.evaluate(
      async ({ key, legacy }) => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open("document-studio-automation", 1);
          request.onupgradeneeded = () =>
            request.result.createObjectStore("drafts");
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        try {
          await new Promise<void>((resolve, reject) => {
            const transaction = db.transaction("drafts", "readwrite");
            transaction.objectStore("drafts").put(legacy, key);
            transaction.oncomplete = () => resolve();
            transaction.onabort = () => reject(transaction.error);
          });
        } finally {
          db.close();
        }
      },
      { key: draftKey("sdk-tests", `test:blank.${format}`), legacy },
    );
    await open(page, format);
    await expect(
      page.getByRole("button", { name: "원본 보관자료 내려받기", exact: true }),
    ).toBeVisible();
    await page.evaluate(() => {
      window.documentStudioTest.readOnly = true;
      window.documentStudioTest.rerender();
    });
    await expect(
      page.getByRole("button", { name: "보관자료를 편집해 복구", exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "원본 보관자료 내려받기", exact: true }),
    ).toBeEnabled();
    const downloadPromise = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "원본 보관자료 내려받기", exact: true })
      .click();
    const json = JSON.parse(
      await readFile((await (await downloadPromise).path())!, "utf8"),
    );
    expect(
      json.drafts["마크다운 보고서"].input ===
        legacy.drafts["마크다운 보고서"].input,
    ).toBe(true);
    expect(json.drafts["금액 한글화"].input).toBe("2468");
    await page
      .getByRole("button", { name: "보관자료를 편집해 복구", exact: true })
      .click();
    const input = page.getByLabel("보고서 마크다운", { exact: true });
    await expect(input).toBeEnabled();
    const blocked = await page.evaluate(async () => {
      try {
        await window.documentStudioTest.execute({
          id: "insertText",
          value: "readonly mutation",
        });
        return "accepted";
      } catch (cause) {
        return String(cause);
      }
    });
    expect(blocked).toContain("읽기 전용");
    expect(
      await input.evaluate(
        (element) => (element as HTMLTextAreaElement).value.length,
      ),
    ).toBe(limit + 1);
    await page
      .getByLabel("자동화 기능", { exact: true })
      .selectOption("금액 한글화");
    await expect(page.getByLabel("금액 목록", { exact: true })).toHaveValue(
      "2468",
    );
    expect(
      (await stored(page, format)).drafts["마크다운 보고서"].input.length,
    ).toBe(limit + 1);
    await page
      .getByLabel("자동화 기능", { exact: true })
      .selectOption("마크다운 보고서");
    await input.fill("원본을 다운로드한 뒤 수정");
    await page.evaluate(() => window.documentStudioTest.flushDraft());
    await page.getByRole("button", { name: "닫기", exact: true }).click();
    await open(page, format);
    await expect(input).toHaveValue("원본을 다운로드한 뒤 수정");
    expect((await stored(page, format)).drafts["금액 한글화"].input).toBe(
      "2468",
    );
  });
}
