import { expect, test } from "@playwright/test";

declare global {
  interface Window {
    studioNotifyPaginationForTest?(): void;
  }
}

test("HWPX: deferred pagination after a confirmed save does not create another recovery draft", async ({
  page,
}) => {
  // Deliver the observed upstream layout notification after commit, through the
  // real native event bus. Document editing, serialization and storage are unchanged.
  await page.route("**/document-studio-extension.js", async (route) => {
    const response = await route.fetch();
    const source = await response.text();
    await route.fulfill({
      response,
      body:
        source +
        '\nwindow.studioNotifyPaginationForTest = () => boundServices.eventBus.emit("document-changed", "deferred-pagination-flush:idle-auto");',
    });
  });
  await page.goto("/browser-harness.html?format=hwpx");
  await page.waitForFunction(() => Boolean(window.browserStudioTest));
  await page.evaluate(async () => {
    await window.browserStudioTest.mount("A");
    await window.browserStudioTest.controller().whenReady();
    await window.browserStudioTest.controller().execute({
      id: "insertText",
      value: "FIRST RANGE SECOND RANGE\nOTHER PARAGRAPH",
    });
    const agent = window.browserStudioTest.agent;
    const found = await agent.search({ documentId: "A", query: "FIRST RANGE" });
    await agent.select({
      documentId: "A",
      expectedSessionId: found.sessionId,
      expectedRevision: found.revision,
      matchId: found.matches[0]!.id,
    });
    const selected = agent.getState();
    await agent.execute({
      documentId: "A",
      expectedSessionId: selected.sessionId,
      expectedRevision: selected.revision,
      expectedSelectionKey: selected.selectionKey!,
      command: { id: "insertText", value: "UPDATED" },
    });
    await window.browserStudioTest.controller().save();
  });
  const saved = await page.evaluate(() =>
    window.browserStudioTest.controller().getState(),
  );
  expect(saved.dirty).toBe(false);
  const frame = page
    .frames()
    .find((frame) => frame.url().includes("/editor-assets/rhwp/"))!;
  await frame.evaluate(() => window.studioNotifyPaginationForTest!());
  await page.evaluate(() =>
    window.browserStudioTest.controller().exportDocument(),
  );
  const afterLayout = await page.evaluate(() =>
    window.browserStudioTest.controller().getState(),
  );
  expect(afterLayout.revision).toBe(saved.revision);
  expect(afterLayout.dirty).toBe(false);
  await page.evaluate(async () => {
    const editor = window.browserStudioTest.controller();
    await editor.execute({ id: "insertText", value: " 실제 새 편집" });
  });
  const changed = await page.evaluate(() =>
    window.browserStudioTest.controller().getState(),
  );
  expect(changed.revision).not.toBe(saved.revision);
  expect(changed.dirty).toBe(true);
  await page.evaluate(async () => {
    const api = window.browserStudioTest;
    await api.controller().save();
    await api.controller().destroy();
    if (api.drafts.size)
      throw new Error("Saved document left an unnecessary recovery draft.");
    await api.mount("A");
    await api.controller().whenReady();
  });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const text = await page.evaluate(
    async () =>
      (await window.browserStudioTest.controller().readDocument()).text,
  );
  expect(text).toContain("UPDATED");
  expect(text).toContain("실제 새 편집");
});
