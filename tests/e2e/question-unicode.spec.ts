import { expect, test } from "@playwright/test";

for (const format of ["docx", "hwpx"] as const) {
  test(`${format}: questions preserve Unicode and the second identical range`, async ({
    page,
  }) => {
    await page.goto("/harness.html?questions=test");
    await page.waitForFunction(() => !!window.documentStudioTest);
    await page.evaluate(
      (format) => window.documentStudioTest.load(format, `blank.${format}`),
      format,
    );
    await expect
      .poll(() => page.evaluate(() => window.documentStudioTest.state()?.ready))
      .toBe(true);
    const selected = await page.evaluate(async () => {
      const host = window.documentStudioTest,
        agent = host.agent;
      const query = "질문 🤖 e\u0301 001234";
      await host.execute({
        id: "insertText",
        value: `첫 번째 ${query} / 두 번째 ${query} / 보존`,
      });
      const state = agent.getState();
      const found = await agent.search({ documentId: state.documentId, query });
      if (found.matches.length !== 2)
        throw new Error("Expected two identical matches");
      await agent.select({
        documentId: state.documentId,
        expectedSessionId: state.sessionId,
        expectedRevision: found.revision,
        matchId: found.matches[1]!.id,
      });
      return { query, state: agent.getState() };
    });
    await page
      .getByRole("button", { name: "선택 영역 질문", exact: true })
      .click();
    await page
      .getByLabel("선택 영역 질문 내용")
      .fill("두 번째 선택만 설명해 줘");
    await page
      .getByRole("button", { name: "선택 영역 질문 보내기", exact: true })
      .click();
    await expect
      .poll(() =>
        page.evaluate(() => window.documentStudioTest.questionsSent.length),
      )
      .toBe(1);
    const result = await page.evaluate(() => ({
      request: window.documentStudioTest.questionsSent[0],
      state: window.documentStudioTest.state(),
    }));
    expect(result.request?.target.text).toBe(selected.query);
    expect(result.request?.target.selectionKey).toBe(
      selected.state.selectionKey,
    );
    expect(result.state?.revision).toBe(selected.state.revision);
    await expect(
      page.getByRole("button", { name: "선택 영역 질문", exact: true }),
    ).toBeFocused();
  });
}
