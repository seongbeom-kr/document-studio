import { expect, test } from "@playwright/test";

for (const format of ["docx", "hwpx"] as const) {
  test(`${format}: preserved-target searches survive other reads and bounded eviction asks for a new search`, async ({
    page,
  }) => {
    await page.goto("/harness.html");
    await page.waitForFunction(() => !!window.documentStudioTest);
    await page.evaluate(
      (format) =>
        window.documentStudioTest.createTemplate(format, {
          fileName: `search.${format}`,
          blocks: [
            { kind: "paragraph", text: "target ".repeat(500) + "keeper" },
          ],
        }),
      format,
    );
    await expect
      .poll(() => page.evaluate(() => window.documentStudioTest.state()?.ready))
      .toBe(true);
    const result = await page.evaluate(async () => {
      const a = window.documentStudioTest.agent,
        state = a.getState();
      const target = {
        documentId: state.documentId,
        expectedSessionId: state.sessionId,
        expectedRevision: state.revision,
      };
      const first = await a.search({
        ...target,
        query: "target",
        maxResults: 500,
      });
      await a.search({ ...target, query: "keeper" });
      await a.select({ ...target, matchId: first.matches[0]!.id });
      const retained = a.getState().revision === state.revision;
      await a.search({ ...target, query: "target", maxResults: 500 });
      let expired: unknown;
      try {
        await a.select({ ...target, matchId: first.matches[0]!.id });
      } catch (cause) {
        const e = cause as Error & {
          code?: string;
          requiredAction?: string;
          effect?: string;
        };
        expired = {
          name: e.name,
          code: e.code,
          requiredAction: e.requiredAction,
          effect: e.effect,
        };
      }
      const fresh = await a.search({ ...target, query: "keeper" });
      await a.select({ ...target, matchId: fresh.matches[0]!.id });
      await window.documentStudioTest.execute({
        id: "insertText",
        value: "changed",
      });
      let staleRevision = false;
      try {
        await a.select({ ...target, matchId: fresh.matches[0]!.id });
      } catch {
        staleRevision = true;
      }
      return { retained, expired, staleRevision };
    });
    expect(result.retained).toBe(true);
    expect(result.expired).toMatchObject({
      name: "SearchResultExpiredError",
      code: "search-result-expired",
      requiredAction: "search-again",
      effect: "none",
    });
    expect(result.staleRevision).toBe(true);
  });
}
