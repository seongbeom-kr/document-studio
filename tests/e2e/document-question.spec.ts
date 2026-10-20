import { expect, test } from "@playwright/test";
for (const format of ["docx", "hwpx"] as const) {
  test(`${format}: paragraph box and question share a versioned logical target`, async ({
    page,
  }, testInfo) => {
    await page.goto("/harness.html?questions=test");
    await page.waitForFunction(() => !!window.documentStudioTest);
    await page.evaluate(
      (format) => window.documentStudioTest.load(format, `blank.${format}`),
      format,
    );
    await expect
      .poll(() => page.evaluate(() => window.documentStudioTest.state()?.ready))
      .toBe(true);
    await page.evaluate(async () => {
      const host = window.documentStudioTest;
      await host.execute({
        id: "insertText",
        value: "선택한 단락 질문 검증 20261018",
      });
    });
    const before = await page.evaluate(() =>
      window.documentStudioTest.agent.getState(),
    );
    await page
      .getByRole("button", { name: "선택 영역 질문", exact: true })
      .click();
    const panel = page.getByLabel("선택 영역 질문", { exact: true });
    await expect(panel).toContainText("선택한 단락 질문 검증 20261018");
    if (format === "docx")
      await expect(page.locator(".ds-question-anchor")).toBeVisible();
    else
      await expect(
        page.frameLocator("iframe").locator(".document-studio-question-box"),
      ).toBeVisible();
    await page.evaluate(() =>
      window.documentStudioTest.execute({ id: "zoom", value: 0.75 }),
    );
    await expect(panel.getByRole("alert")).toHaveCount(0);
    await testInfo.attach("paragraph-box", {
      body: await page.screenshot({
        path: `.build/sdk-fixes-0.2.31/${testInfo.project.name}-${format}-paragraph-question.png`,
      }),
      contentType: "image/png",
    });
    await panel
      .getByLabel("선택 영역 질문 내용")
      .fill("이 단락을 쉽게 설명해 줘");
    await panel
      .getByRole("button", { name: "선택 영역 질문 보내기", exact: true })
      .click();
    await expect(panel).toHaveCount(0);
    const result = await page.evaluate(() => ({
      sent: window.documentStudioTest.questionsSent,
      state: window.documentStudioTest.agent.getState(),
    }));
    expect(result.sent).toHaveLength(1);
    expect(result.sent[0]?.target).toMatchObject({
      documentId: before.documentId,
      sessionId: before.sessionId,
      revision: before.revision,
      text: "선택한 단락 질문 검증 20261018",
    });
    expect(result.state.revision).toBe(before.revision);
    await page
      .getByRole("button", { name: "선택 영역 질문", exact: true })
      .click();
    await panel.getByLabel("선택 영역 질문 내용").fill("이전 단락 질문");
    await page.evaluate(() =>
      window.documentStudioTest.execute({
        id: "insertText",
        value: "문서 변경",
      }),
    );
    await expect(
      panel.getByRole("button", { name: "선택 영역 질문 보내기", exact: true }),
    ).toBeDisabled();
    await expect(panel).toContainText("영역을 다시 지정");
    expect(
      await page.evaluate(() => window.documentStudioTest.questionsSent.length),
    ).toBe(1);
  });
}

for (const format of ["docx", "hwpx"] as const) {
  test(`${format}: partial selection anchors the composer and preserves its exact text through zoom`, async ({
    page,
  }, info) => {
    await page.goto("/harness.html?questions=test");
    await page.waitForFunction(() => !!window.documentStudioTest);
    await page.evaluate(async (format) => {
      const host = window.documentStudioTest;
      await host.load(format, `blank.${format}`);
    }, format);
    await expect
      .poll(() => page.evaluate(() => window.documentStudioTest.state()?.ready))
      .toBe(true);
    const before = await page.evaluate(async () => {
      const host = window.documentStudioTest,
        agent = host.agent;
      await host.execute({
        id: "insertText",
        value: "앞부분 보존 / 질문할 부분 001234 / 뒷부분 보존",
      });
      const state = agent.getState(),
        found = await agent.search({
          documentId: state.documentId,
          query: "질문할 부분 001234",
        });
      await agent.select({
        documentId: state.documentId,
        expectedSessionId: state.sessionId,
        expectedRevision: found.revision,
        matchId: found.matches[0]!.id,
      });
      return agent.getState();
    });
    await page
      .getByRole("button", { name: "선택 영역 질문", exact: true })
      .click();
    const panel = page.getByLabel("선택 영역 질문", { exact: true });
    await expect(panel).toHaveAttribute("data-attached", "true");
    await panel.getByText(/선택 내용 확인/).click();
    await expect(panel.locator("blockquote")).toHaveText("질문할 부분 001234");
    await panel.getByLabel("선택 영역 질문 내용").fill("이 부분을 설명해 줘");
    await page.evaluate(() =>
      window.documentStudioTest.execute({ id: "zoom", value: 0.75 }),
    );
    await expect(panel).toHaveAttribute("data-attached", "true");
    await page.setViewportSize({ width: 820, height: 780 });
    if (format === "hwpx") {
      // Native zoom may preserve a scroll offset that moves the range offscreen.
      // Returning to the visible range must reattach without recapturing identity.
      await page
        .frameLocator("iframe")
        .locator("#scroll-container")
        .evaluate((element) => {
          element.scrollTop = 0;
        });
    }
    await expect(panel).toHaveAttribute("data-attached", "true");
    await expect
      .poll(async () => {
        const box = await panel.boundingBox();
        return (
          !!box &&
          box.x >= 0 &&
          box.x + box.width <= 821 &&
          box.y >= 0 &&
          box.y + box.height <= 781
        );
      })
      .toBe(true);
    await info.attach("partial-question", {
      body: await page.screenshot({
        path: `.build/sdk-fixes-0.2.31/${info.project.name}-${format}-partial-question.png`,
      }),
      contentType: "image/png",
    });
    await panel
      .getByRole("button", { name: "선택 영역 질문 보내기", exact: true })
      .click();
    const result = await page.evaluate(() => ({
      sent: window.documentStudioTest.questionsSent,
      state: window.documentStudioTest.state(),
    }));
    expect(result.sent[0]?.target).toMatchObject({
      text: "질문할 부분 001234",
      revision: before.revision,
      selectionKey: before.selectionKey,
    });
    expect(JSON.parse(result.sent[0]!.target.anchor)).toMatchObject({
      format,
      start: 9,
      end: 22,
    });
    expect(result.state?.revision).toBe(before.revision);
    await page
      .getByRole("button", { name: "선택 영역 질문", exact: true })
      .click();
    await panel.getByLabel("선택 영역 질문 내용").press("Escape");
    await expect(panel).toHaveCount(0);
  });
  test(`${format}: table reads outside a table return selection guidance without mutations`, async ({
    page,
  }) => {
    await page.goto("/harness.html");
    await page.waitForFunction(() => !!window.documentStudioTest);
    await page.evaluate(
      (format) => window.documentStudioTest.load(format, `blank.${format}`),
      format,
    );
    await expect
      .poll(() => page.evaluate(() => window.documentStudioTest.state()?.ready))
      .toBe(true);
    const result = await page.evaluate(async () => {
      const agent = window.documentStudioTest.agent,
        before = agent.getState();
      try {
        await agent.readTable({ documentId: before.documentId });
        return { error: null };
      } catch (cause) {
        const error = cause as Error & {
          code: string;
          effect: string;
          requiredAction: string;
        };
        return {
          error: {
            code: error.code,
            effect: error.effect,
            requiredAction: error.requiredAction,
          },
          before: before.revision,
          after: agent.getState().revision,
        };
      }
    });
    expect(result.error).toMatchObject({
      code: "table-cell-required",
      effect: "none",
      requiredAction: "select-table-cell",
    });
    expect(result.after).toBe(result.before);
  });
}
