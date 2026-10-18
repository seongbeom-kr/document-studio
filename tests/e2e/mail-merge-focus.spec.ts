import { expect, test, type Page } from "@playwright/test";

declare global {
  interface Window {
    mailFocusGate: { started: boolean; release(): void };
  }
}

async function prepare(page: Page, format: "docx" | "hwpx", storage = true) {
  await page.goto(`/harness.html${storage ? "?generatedStorage=test" : ""}`);
  await page.waitForFunction(() => Boolean(window.documentStudioTest));
  await page.evaluate(async (format) => {
    const host = window.documentStudioTest;
    host.persistAutomation = true;
    await host.load(format, `blank.${format}`);
  }, format);
  await expect
    .poll(() => page.evaluate(() => window.documentStudioTest.state()?.ready))
    .toBe(true);
  await page.evaluate(async () => {
    const host = window.documentStudioTest;
    await host.execute({ id: "insertText", value: "수료 {{이름}} 고정 문구" });
    await host.save();
    const input = document.createElement("input");
    input.setAttribute("aria-label", "호스트의 다른 입력");
    input.style.cssText =
      "position:fixed;right:4px;top:4px;z-index:9999;width:160px";
    document.body.append(input);
    const other = document.createElement("p");
    other.textContent = "호스트의 다른 영역";
    other.style.cssText =
      "position:fixed;right:4px;top:35px;z-index:9999;background:white";
    document.body.append(other);
  });
  await page.getByRole("button", { name: "빠른 작업", exact: true }).click();
  await page.getByRole("tab", { name: "서식·메일머지", exact: true }).click();
  await page
    .getByRole("button", { name: "현재 편집본을 서식으로 등록", exact: true })
    .click();
  await expect(page.getByLabel("메일머지 등록한 서식")).not.toHaveValue("");
  await page
    .getByLabel("메일머지 입력 데이터", { exact: true })
    .fill("이름\n김하나");
  await page
    .getByRole("button", { name: "같은 이름의 열 연결", exact: true })
    .click();
  await page
    .getByRole("button", { name: "메일머지 미리보기", exact: true })
    .click();
  const generate = page.getByRole("button", {
    name: "확인한 1개 문서 생성",
    exact: true,
  });
  await expect(generate).toBeEnabled();
  return generate;
}

async function pauseGeneration(page: Page, fail = false) {
  await page.evaluate((fail) => {
    const original = crypto.subtle.digest.bind(crypto.subtle);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    window.mailFocusGate = { started: false, release };
    crypto.subtle.digest = async (algorithm, data) => {
      crypto.subtle.digest = original;
      window.mailFocusGate.started = true;
      await pending;
      if (fail) throw new Error("검증용 생성 실패");
      return original(algorithm, data);
    };
  }, fail);
}

async function finishGeneration(page: Page) {
  await page.evaluate(() => window.mailFocusGate.release());
  await expect(
    page.getByRole("region", { name: "생성 사본 보관", exact: true }),
  ).toBeVisible();
  // Let the completion frame run before checking that another target kept focus.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

for (const format of ["docx", "hwpx"] as const) {
  for (const storage of [true, false]) {
    test(`${format}: keyboard completion ${storage ? "with storage" : "with ZIP only"} leads to the next action`, async ({
      page,
    }, testInfo) => {
      const generate = await prepare(page, format, storage);
      const before = await page.evaluate(() =>
        window.documentStudioTest.state(),
      );
      await generate.focus();
      await page.keyboard.press("Enter");
      const output = page.getByRole("region", {
        name: "생성 사본 보관",
        exact: true,
      });
      await expect(output).toBeFocused();
      await expect(output).toContainText("1개 생성 완료");
      if (format === "docx" && storage && testInfo.project.name === "chrome")
        await page.screenshot({
          path: ".build/fixes-0.2.26/generation-result-focused.png",
        });
      await page.keyboard.press("Tab");
      const next = page.getByRole("button", {
        name: storage ? "검증 작업 공간에 사본 저장" : "생성 파일 ZIP 내려받기",
        exact: true,
      });
      await expect(next).toBeFocused();
      if (storage) {
        await page.keyboard.press("Enter");
        await expect(output).toContainText("보관 1개 · 남음 0개");
      }
      const after = await page.evaluate(() =>
        window.documentStudioTest.state(),
      );
      expect(after?.revision).toBe(before?.revision);
      expect(after?.dirty).toBe(false);
      await testInfo.attach("generation-complete", {
        body: await page.screenshot(),
        contentType: "image/png",
      });
    });
  }

  test(`${format}: keyboard completion remains visible in a narrow host`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    const generate = await prepare(page, format);
    await generate.focus();
    await page.keyboard.press("Enter");
    const output = page.getByRole("region", {
      name: "생성 사본 보관",
      exact: true,
    });
    await expect(output).toBeFocused();
    await page.keyboard.press("Tab");
    const save = page.getByRole("button", {
      name: "검증 작업 공간에 사본 저장",
      exact: true,
    });
    await expect(save).toBeFocused();
    await expect(save).toBeInViewport();
  });

  for (const move of ["focus", "pointer", "tab"] as const) {
    test(`${format}: a ${move} move during generation is not overridden on completion`, async ({
      page,
    }) => {
      const generate = await prepare(page, format);
      await pauseGeneration(page);
      await generate.focus();
      await page.keyboard.press("Enter");
      await expect
        .poll(() => page.evaluate(() => window.mailFocusGate.started))
        .toBe(true);
      if (move === "focus") await page.getByLabel("호스트의 다른 입력").focus();
      if (move === "pointer")
        await page.getByText("호스트의 다른 영역", { exact: true }).click();
      if (move === "tab") await page.keyboard.press("Tab");
      await finishGeneration(page);
      await expect(
        page.getByRole("region", { name: "생성 사본 보관", exact: true }),
      ).not.toBeFocused();
      if (move === "focus")
        await expect(page.getByLabel("호스트의 다른 입력")).toBeFocused();
    });
  }

  test(`${format}: background agent generation preserves the host focus`, async ({
    page,
  }) => {
    await prepare(page, format);
    await page.getByLabel("호스트의 다른 입력").focus();
    await page.evaluate(async () => {
      const agent = window.documentStudioTest.agent;
      const state = agent.getState();
      const target = {
        documentId: state.documentId,
        expectedSessionId: state.sessionId,
      };
      const template = agent.listMailMergeTemplates(target)[0]!;
      const preview = agent.previewMailMerge({
        ...target,
        mergeRequest: {
          templateId: template.templateId,
          data: "이름\n에이전트",
          delimiter: ",",
          mapping: { 이름: "이름" },
          fileNamePattern: `생성-{{#}}.${template.format}`,
          allowEmpty: false,
        },
      });
      await agent.generateMailMerge({
        ...target,
        expectedRevision: state.revision,
        previewId: preview.previewId,
        operationId: "focus-background",
      });
    });
    await expect(
      page.getByRole("region", { name: "생성 사본 보관", exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("호스트의 다른 입력")).toBeFocused();
  });

  test(`${format}: a failed generation does not focus a success result`, async ({
    page,
  }) => {
    const generate = await prepare(page, format);
    await pauseGeneration(page, true);
    await generate.focus();
    await page.keyboard.press("Enter");
    await expect
      .poll(() => page.evaluate(() => window.mailFocusGate.started))
      .toBe(true);
    await page.evaluate(() => window.mailFocusGate.release());
    await expect(
      page.getByText(/이번 생성 결과는 모두 폐기했습니다/),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "생성 사본 보관", exact: true }),
    ).toHaveCount(0);
    await expect(generate).toBeEnabled();
  });

  test(`${format}: leaving the panel cancels its pending completion focus`, async ({
    page,
  }) => {
    const generate = await prepare(page, format);
    await pauseGeneration(page);
    await generate.focus();
    await page.keyboard.press("Enter");
    await expect
      .poll(() => page.evaluate(() => window.mailFocusGate.started))
      .toBe(true);
    const otherTab = page.getByRole("tab", { name: "글자", exact: true });
    await otherTab.click();
    await page.evaluate(() => window.mailFocusGate.release());
    await expect
      .poll(() =>
        page.evaluate(
          () => window.documentStudioTest.state()?.generatedOutputPending,
        ),
      )
      .toBe(true);
    await expect(otherTab).toBeFocused();
    await page.getByRole("tab", { name: "서식·메일머지", exact: true }).click();
    await expect(
      page.getByRole("region", { name: "생성 사본 보관", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("tab", { name: "서식·메일머지", exact: true }),
    ).toBeFocused();
  });

  test(`${format}: cancelling generation does not move focus to a result`, async ({
    page,
  }) => {
    const generate = await prepare(page, format);
    await pauseGeneration(page);
    await generate.focus();
    await page.keyboard.press("Enter");
    await expect
      .poll(() => page.evaluate(() => window.mailFocusGate.started))
      .toBe(true);
    await page.getByRole("button", { name: "생성 취소", exact: true }).click();
    await page.evaluate(() => window.mailFocusGate.release());
    await expect(
      page.getByText(/이번 생성 결과는 모두 폐기했습니다/),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "생성 사본 보관", exact: true }),
    ).toHaveCount(0);
  });
}
