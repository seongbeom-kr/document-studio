import { expect, test, type Page } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
type Format = "docx" | "hwpx";
async function load(
  page: Page,
  format: Format,
  persist = false,
  name = `blank.${format}`,
) {
  await page.goto("/harness.html");
  await page.waitForFunction(() => window.documentStudioTest);
  await page.evaluate(
    async ({ format, persist, name }) => {
      window.documentStudioTest.persistAutomation = persist;
      await window.documentStudioTest.load(format, name);
    },
    { format, persist, name },
  );
  await expect(
    page.getByRole("button", { name: "굵게", exact: true }),
  ).toBeEnabled();
}
async function automation(page: Page) {
  await page.getByRole("button", { name: "문단·표·그림", exact: true }).click();
  await page.getByRole("tab", { name: "업무 자동화", exact: true }).click();
  await expect(page.getByLabel("자동화 기능", { exact: true })).toBeVisible();
}
for (const format of ["docx", "hwpx"] as const) {
  test(`${format}: save and draft transitions preserve an earlier command failure across automation flush`, async ({
    page,
  }) => {
    await load(page, format, true);
    for (const operation of ["save", "flushDraft"] as const) {
      const result = await page.evaluate(async (operation) => {
        const api = window.documentStudioTest;
        api.pauseNextCommand = true;
        api.failPausedCommand = true;
        const command = api.execute({ id: "bold" });
        void command.catch(() => undefined);
        const transition = api[operation]();
        api.releasePausedCommand?.();
        const [commandResult, transitionResult] = await Promise.allSettled([
          command,
          transition,
        ]);
        api.failPausedCommand = false;
        return {
          command: commandResult.status,
          transition: transitionResult.status,
          error:
            transitionResult.status === "rejected"
              ? String(transitionResult.reason)
              : "",
          saves: api.saves,
        };
      }, operation);
      expect(result).toMatchObject({
        command: "rejected",
        transition: "rejected",
        saves: 0,
      });
      expect(result.error).toContain("이전 명령 실패");
      await expect(
        page.getByRole("button", { name: "굵게", exact: true }),
      ).toBeEnabled();
    }
  });
  test(`${format}: memory-only automation inputs warn on close and example reset can be undone`, async ({
    page,
  }) => {
    await load(page, format);
    await automation(page);
    await page
      .getByLabel("자동화 기능", { exact: true })
      .selectOption("마크다운 보고서");
    const input = page.getByLabel("보고서 마크다운", { exact: true });
    await input.fill("# 지키려는 입력\n원본 값");
    await page
      .getByRole("button", { name: "예제로 초기화", exact: true })
      .click();
    await expect(input).not.toHaveValue("# 지키려는 입력\n원본 값");
    await page
      .getByRole("button", { name: "초기화 전 입력 복구", exact: true })
      .click();
    await expect(input).toHaveValue("# 지키려는 입력\n원본 값");
    expect(
      await page.evaluate(() => window.documentStudioTest.state()?.dirty),
    ).toBe(false);
    await page.getByRole("button", { name: "닫기", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText(
      "자동화 입력도 사라집니다",
    );
    await expect(
      page.getByRole("button", { name: "자동화 입력 내려받기", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "계속 편집", exact: true }).click();
    await expect(input).toHaveValue("# 지키려는 입력\n원본 값");
  });
  test(`${format}: close confirmation rejects every new public mutation and permits editing after cancel`, async ({
    page,
  }) => {
    await load(page, format);
    await page.evaluate(async () => {
      await window.documentStudioTest.execute({ id: "selectAll" });
      await window.documentStudioTest.execute({
        id: "insertText",
        value: "잠금 이전",
      });
    });
    await expect
      .poll(() => page.evaluate(() => window.documentStudioTest.state()?.dirty))
      .toBe(true);
    await page.getByRole("button", { name: "닫기", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    const result = await page.evaluate(async () => {
      const api = window.documentStudioTest,
        s = api.state()!;
      const target = {
        documentId: s.documentId,
        expectedSessionId: s.sessionId,
        expectedRevision: s.revision,
      };
      const errors = [];
      for (const task of [
        () => api.execute({ id: "insertText", value: "금지입력" }),
        () =>
          api.agent.replace({
            ...target,
            query: "잠금",
            replacement: "금지치환",
            all: true,
          }),
        () =>
          api.agent.applyPreset({
            ...target,
            expectedSelectionKey: s.selectionKey!,
            preset: {
              id: "modal",
              name: "modal",
              description: "test",
              commands: [{ id: "bold" }],
            },
          }),
      ]) {
        try {
          await task();
          errors.push("accepted");
        } catch (e) {
          errors.push(String(e));
        }
      }
      return {
        errors,
        before: s.revision,
        after: api.state()!.revision,
        commands: api.agent.listCommands(),
      };
    });
    expect(result.errors).toHaveLength(3);
    result.errors.forEach((error) => expect(error).toContain("확인창"));
    expect(result.after).toBe(result.before);
    expect(result.commands.every((command) => !command.enabled)).toBe(true);
    await page.getByRole("button", { name: "계속 편집", exact: true }).click();
    await page.evaluate(() =>
      window.documentStudioTest.execute({
        id: "insertText",
        value: "취소 후 입력",
      }),
    );
    const bytes = await page.evaluate(() => window.documentStudioTest.export());
    const xml = strFromU8(
      unzipSync(new Uint8Array(bytes))[
        format === "docx" ? "word/document.xml" : "Contents/section0.xml"
      ]!,
    );
    expect(xml).toContain("취소 후 입력");
    expect(xml).not.toContain("금지입력");
  });
  test(`${format}: tools have roving keyboard tabs, labelled panels and reversible large workspace`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await load(page, format);
    await automation(page);
    const tabs = page.getByRole("tablist", { name: "편집 도구 종류" });
    await expect(tabs.locator('[tabindex="0"]')).toHaveCount(1);
    const active = page.getByRole("tab", { selected: true });
    await active.focus();
    await page.keyboard.press("Home");
    await expect(
      page.getByRole("tab", { name: "글자", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(
      page.getByRole("tab", { name: "문단", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("End");
    const last = page.getByRole("tab", { selected: true });
    await expect(last).toBeFocused();
    expect(await last.getAttribute("aria-controls")).toBe(
      await page.getByRole("tabpanel").getAttribute("id"),
    );
    await page.getByRole("tab", { name: "업무 자동화", exact: true }).click();
    await page
      .getByLabel("자동화 기능", { exact: true })
      .selectOption("마크다운 보고서");
    const input = page.getByLabel("보고서 마크다운", { exact: true });
    await input.fill("# 넓은 작업 공간\n보존할 입력");
    if (
      (await page
        .locator(".ds-editing-tools")
        .getAttribute("data-expanded")) !== "true"
    )
      await page
        .getByRole("button", { name: "도구 크게 보기", exact: true })
        .click();
    const tools = page.locator('.ds-editing-tools[data-expanded="true"]');
    await expect(tools).toBeVisible();
    expect((await tools.boundingBox())!.height).toBeGreaterThan(400);
    if (format === "hwpx")
      await expect(
        page
          .frameLocator("iframe")
          .getByLabel("문서 편집 입력", { exact: true }),
      ).toHaveAttribute("readonly", "");
    await input.focus();
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: "도구 크게 보기", exact: true }),
    ).toBeVisible();
    await expect(input).toHaveValue("# 넓은 작업 공간\n보존할 입력");
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: "문단·표·그림", exact: true }),
    ).toBeFocused();
    await expect(page.getByRole("tablist")).toHaveCount(0);
  });
  test(`${format}: separate local drafts restore after close and reload, isolated from another owner`, async ({
    page,
  }) => {
    await load(page, format, true);
    await automation(page);
    await page
      .getByLabel("자동화 기능", { exact: true })
      .selectOption("마크다운 보고서");
    await page
      .getByLabel("보고서 마크다운", { exact: true })
      .fill("# 닫아도 복구할 입력\n고유 자료");
    await page
      .getByLabel("자동화 기능", { exact: true })
      .selectOption("표 데이터 정리");
    await page.getByLabel("정리할 표 데이터", { exact: true }).fill("12\t34");
    await page.evaluate(() => window.documentStudioTest.flushDraft());
    expect(
      await page.evaluate(
        () => window.documentStudioTest.state()?.automationDraftPending,
      ),
    ).toBe(false);
    await page.getByRole("button", { name: "닫기", exact: true }).click();
    await expect(page.getByText("편집기 닫힘", { exact: true })).toBeVisible();
    await load(page, format, true);
    await automation(page);
    await expect(page.getByLabel("자동화 기능", { exact: true })).toHaveValue(
      "표 데이터 정리",
    );
    await expect(
      page.getByLabel("정리할 표 데이터", { exact: true }),
    ).toHaveValue("12\t34");
    await page
      .getByLabel("자동화 기능", { exact: true })
      .selectOption("마크다운 보고서");
    await expect(
      page.getByLabel("보고서 마크다운", { exact: true }),
    ).toHaveValue("# 닫아도 복구할 입력\n고유 자료");
    await page.evaluate(() => window.documentStudioTest.flushDraft());
    await page.getByRole("button", { name: "닫기", exact: true }).click();
    await page.evaluate(async (format) => {
      window.documentStudioTest.automationNamespace =
        "different-owner/workspace";
      await window.documentStudioTest.load(format, `blank.${format}`);
    }, format);
    await expect(
      page.getByRole("button", { name: "굵게", exact: true }),
    ).toBeEnabled();
    await automation(page);
    await expect(page.getByLabel("자동화 기능", { exact: true })).toHaveValue(
      "금액 한글화",
    );
  });
}
