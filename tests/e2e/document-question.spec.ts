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
      .getByRole("button", { name: "이 단락 질문", exact: true })
      .click();
    const panel = page.getByLabel("선택 단락 질문", { exact: true });
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
      body: await page.screenshot(),
      contentType: "image/png",
    });
    await panel
      .getByLabel("선택 단락 질문 내용")
      .fill("이 단락을 쉽게 설명해 줘");
    await panel
      .getByRole("button", { name: "선택 단락 질문 보내기", exact: true })
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
      .getByRole("button", { name: "이 단락 질문", exact: true })
      .click();
    await panel.getByLabel("선택 단락 질문 내용").fill("이전 단락 질문");
    await page.evaluate(() =>
      window.documentStudioTest.execute({
        id: "insertText",
        value: "문서 변경",
      }),
    );
    await expect(
      panel.getByRole("button", { name: "선택 단락 질문 보내기", exact: true }),
    ).toBeDisabled();
    await expect(panel).toContainText("단락을 다시 지정");
    expect(
      await page.evaluate(() => window.documentStudioTest.questionsSent.length),
    ).toBe(1);
  });
}
