import { test, expect, type Page } from "@playwright/test";
import { draftKey } from "../../packages/core/src/index";

async function load(page: Page, format: "docx" | "hwpx") {
  await page.goto("/harness.html");
  await page.waitForFunction(() => !!window.documentStudioTest);
  await page.evaluate(async (format) => {
    window.documentStudioTest.persistAutomation = true;
    await window.documentStudioTest.load(format, `blank.${format}`);
  }, format);
  await expect
    .poll(() => page.evaluate(() => window.documentStudioTest.state()?.ready))
    .toBe(true);
  await page.getByRole("button", { name: "문단·표·그림", exact: true }).click();
  await page.getByRole("tab", { name: "문서 일괄 생성", exact: true }).click();
}
for (const format of ["docx", "hwpx"] as const) {
  test(`${format} mail merge restores owner-scoped data and mapping after reload and preserves malformed settings until explicit reset`, async ({
    page,
  }) => {
    await load(page, format);
    await page.evaluate(() =>
      window.documentStudioTest.execute({
        id: "insertText",
        value: "안내 {{이름}}",
      }),
    );
    await page
      .getByRole("button", { name: "현재 편집본을 서식으로 등록", exact: true })
      .click();
    await expect(page.getByLabel("메일머지 등록한 서식")).not.toHaveValue("");
    await page
      .getByLabel("메일머지 입력 데이터", { exact: true })
      .fill("이름\n고유입력001234");
    await page
      .getByLabel("필드 이름 데이터 열", { exact: true })
      .selectOption("이름");
    await page
      .getByLabel("메일머지 출력 파일 이름", { exact: true })
      .fill(`내서식-{{#}}.${format}`);
    await page.evaluate(() => window.documentStudioTest.flushAutomationDraft());
    const bytes = await page.evaluate(() => window.documentStudioTest.export());
    await load(page, format);
    await expect(
      page.getByLabel("메일머지 입력 데이터", { exact: true }),
    ).toHaveValue("이름\n고유입력001234");
    await expect(
      page.getByLabel("메일머지 출력 파일 이름", { exact: true }),
    ).toHaveValue(`내서식-{{#}}.${format}`);
    await expect(page.getByLabel("메일머지 등록한 서식")).toHaveValue("");
    await page.evaluate(
      ({ bytes, format }) =>
        window.documentStudioTest.registerMailMerge(bytes, format),
      { bytes, format },
    );
    await expect(
      page.getByLabel("필드 이름 데이터 열", { exact: true }),
    ).toHaveValue("이름");
    const key = draftKey("sdk-tests", `test:blank.${format}`);
    await page.evaluate(async (key) => {
      const store = window.documentStudioTest.automationStore;
      const draft = (await store.get(key))!;
      draft.drafts["서식 메일머지"]!.argument = "{broken-field-settings";
      await store.put(key, draft);
    }, key);
    await load(page, format);
    await expect(
      page.getByRole("alert").filter({ hasText: /필드 설정|JSON/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "현재 편집본을 서식으로 등록",
        exact: true,
      }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "서식 파일 선택", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByLabel("메일머지 입력 데이터", { exact: true }),
    ).toHaveValue("이름\n고유입력001234");
    const preserved = await page.evaluate(
      async (key) =>
        (await window.documentStudioTest.automationStore.get(key))!.drafts[
          "서식 메일머지"
        ]!.argument,
      key,
    );
    expect(preserved).toBe("{broken-field-settings");
    await page
      .getByRole("button", { name: "필드 설정 초기화", exact: true })
      .click();
    await expect(
      page.getByLabel("메일머지 입력 데이터", { exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByLabel("메일머지 입력 데이터", { exact: true }),
    ).toHaveValue("이름\n고유입력001234");
  });
}
