import { expect, test, type Page } from "@playwright/test";

async function open(
  page: Page,
  format: string,
  host = "plain",
  noDraft = false,
) {
  await page.goto(`/browser-harness.html?format=${format}&host=${host}`);
  await page.waitForFunction(() => !!window.browserStudioTest);
  await page.evaluate(
    (noDraft) => window.browserStudioTest.mount("A", noDraft),
    noDraft,
  );
  await page.evaluate(() => window.browserStudioTest.controller().whenReady());
}

for (const format of ["docx", "hwpx"]) {
  test(`${format}: multiple browser roots keep sessions and mutations isolated`, async ({
    page,
  }) => {
    await open(page, format);
    expect(
      await page.evaluate(() => window.browserStudioTest.verifySibling()),
    ).toEqual({ separate: true, stable: true });
    await expect(page.locator(".ds-browser-mount")).toHaveCount(1);
  });
  test(`${format}: invalid documents reject readiness with a structured failure and remain closeable`, async ({
    page,
  }) => {
    await page.goto(`/browser-harness.html?format=${format}`);
    await page.waitForFunction(() => !!window.browserStudioTest);
    const result = await page.evaluate(
      async (format) => {
        const api = window.browserStudioTest;
        api.files.set("bad", {
          id: "bad",
          fileName: `bad.${format}`,
          format,
          bytes: new Uint8Array([1, 2, 3]),
        });
        await api.mount("bad");
        const error = await api
          .controller()
          .whenReady()
          .then(
            () => null,
            (error: Error & { code: string; retryable: boolean }) => ({
              code: error.code,
              retryable: error.retryable,
            }),
          );
        await api.controller().destroy();
        return error;
      },
      format as "docx" | "hwpx",
    );
    expect(result).toEqual({
      code: "engine-initialization-failed",
      retryable: false,
    });
    await expect(page.locator(".ds-browser-mount")).toHaveCount(0);
  });
  test(`${format}: a short input immediately followed by onlyIfDirty save is persisted`, async ({
    page,
  }) => {
    await open(page, format);
    const result = await page.evaluate(async () => {
      const api = window.browserStudioTest;
      await api.controller().execute({ id: "insertText", value: "짧은 입력" });
      const edited = api.controller().getState();
      await api.controller().save({ onlyIfDirty: true });
      const saved = api.controller().getState();
      await api.controller().destroy();
      await api.mount("A");
      await api.controller().whenReady();
      return {
        edited,
        saved,
        calls: api.saves,
        reopened: (await api.controller().readDocument()).text,
      };
    });
    expect(result.edited.dirty).toBe(true);
    expect(result.edited.revision).not.toBe("0");
    expect(result.saved.dirty).toBe(false);
    expect(result.calls).toBe(1);
    expect(result.reopened).toContain("짧은 입력");
  });
  for (const host of ["plain", "vue"]) {
    test(`${host}/${format}: common controller edits, guards, commits and reopens through a new mount`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await open(page, format, host);
      const initial = await page.evaluate(async () => {
        const api = window.browserStudioTest;
        await api.controller().execute({
          id: "insertText",
          value: "FIRST RANGE SECOND RANGE\nOTHER PARAGRAPH",
        });
        const state = api.controller().getState();
        api.rerender();
        await api.refreshIdentity();
        await api.controller().update({ appearance: "embedded" });
        return {
          before: state.sessionId,
          after: api.controller().getState().sessionId,
        };
      });
      expect(initial.after).toBe(initial.before);
      const outcome = await page.evaluate(async () => {
        const api = window.browserStudioTest;
        const agent = api.agent;
        const found = await agent.search({
          documentId: "A",
          query: "FIRST RANGE",
        });
        await agent.select({
          documentId: "A",
          expectedSessionId: found.sessionId,
          expectedRevision: found.revision,
          matchId: found.matches[0]!.id,
        });
        const state = agent.getState();
        const target = {
          documentId: "A",
          expectedSessionId: state.sessionId,
          expectedRevision: state.revision,
          expectedSelectionKey: state.selectionKey!,
        };
        await agent.execute({
          ...target,
          command: { id: "insertText", value: "UPDATED" },
        });
        const stale = await agent
          .execute({
            ...target,
            command: { id: "insertText", value: "FORBIDDEN" },
          })
          .then(
            () => false,
            () => true,
          );
        const savedState = agent.getState();
        const request = {
          documentId: "A",
          expectedSessionId: savedState.sessionId,
          expectedRevision: savedState.revision,
          operationId: "browser-commit",
        };
        const receipt = await agent.commit(request);
        await agent.commit(request);
        const bytes = api.files.get("A")!.bytes;
        const hash = await crypto.subtle.digest(
          "SHA-256",
          new Uint8Array(bytes),
        );
        const digest =
          "sha256:" +
          [...new Uint8Array(hash)]
            .map((n) => n.toString(16).padStart(2, "0"))
            .join("");
        await api.controller().destroy();
        await api.mount("A");
        await api.controller().whenReady();
        return {
          stale,
          receipt,
          digest,
          saves: api.saves,
          session: api.controller().getState().sessionId,
          text: (await api.controller().readDocument()).text,
        };
      });
      expect(outcome.stale).toBe(true);
      expect(outcome.receipt.digest).toBe(outcome.digest);
      expect(outcome.saves).toBe(1);
      expect(outcome.session).not.toBe(initial.before);
      expect(outcome.text).toContain("UPDATED SECOND RANGE");
      expect(outcome.text).toContain("OTHER PARAGRAPH");
      expect(outcome.text).not.toContain("FORBIDDEN");
      await expect(page.locator("#host-owned")).toHaveText("호스트 소유 요소");
      expect(errors).toEqual([]);
    });

    test(`${host}/${format}: failed draft writes keep the current editor, then switch and recover its last edit`, async ({
      page,
    }) => {
      await open(page, format, host);
      const failed = await page.evaluate(async () => {
        const api = window.browserStudioTest;
        await api
          .controller()
          .execute({ id: "insertText", value: "보존할 최근 입력" });
        api.failDraft = true;
        const update = await api.open("B").then(
          () => "unexpected",
          (error: Error) => error.message,
        );
        const destroy = await api
          .controller()
          .destroy()
          .then(
            () => "unexpected",
            (error: Error) => error.message,
          );
        return {
          update,
          destroy,
          state: api.controller().getState(),
          text: (await api.controller().readDocument()).text,
        };
      });
      expect(failed.update).toContain("Test draft storage failure");
      expect(failed.destroy).toContain("Test draft storage failure");
      expect(failed.state.documentId).toBe("A");
      expect(failed.state.dirty).toBe(true);
      expect(failed.text).toContain("보존할 최근 입력");
      await page.evaluate(async () => {
        const api = window.browserStudioTest;
        api.failDraft = false;
        await api.open("B");
        await api.controller().whenReady();
        await api.open("A");
      });
      await page
        .getByRole("button", { name: "초안 복구", exact: true })
        .click();
      const restored = await page.evaluate(async () => {
        const editor = window.browserStudioTest.controller();
        await editor.whenReady();
        return (await editor.readDocument()).text;
      });
      expect(restored).toContain("보존할 최근 입력");
    });
  }

  test(`${format}: disabled drafts cannot silently discard edits; saved sessions destroy idempotently`, async ({
    page,
  }) => {
    await open(page, format, "plain", true);
    const result = await page.evaluate(async () => {
      const api = window.browserStudioTest;
      const editor = api.controller();
      await editor.execute({ id: "insertText", value: "저장 후 종료" });
      const editedState = editor.getState();
      if (!editedState.dirty)
        throw new Error(
          "Immediate edit state: " +
            JSON.stringify(editedState) +
            " text=" +
            (await editor.readDocument()).text,
        );
      const rejected = await editor.destroy().then(
        () => false,
        () => true,
      );
      await editor.save();
      const a = editor.destroy(),
        b = editor.destroy();
      const shared = a === b;
      await Promise.all([a, b]);
      const closed = await editor
        .execute({ id: "insertText", value: "종료 후 금지" })
        .then(
          () => false,
          () => true,
        );
      await editor.destroy();
      return { rejected, shared, closed, saves: api.saves };
    });
    expect(result).toEqual({
      rejected: true,
      shared: true,
      closed: true,
      saves: 1,
    });
    await expect(page.locator(".ds-browser-mount")).toHaveCount(0);
    await expect(page.locator("#host-owned")).toBeVisible();
  });

  test(`${format}: duplicate mounts, owner changes and readonly mutations are rejected`, async ({
    page,
  }) => {
    await open(page, format);
    const result = await page.evaluate(async () => {
      const api = window.browserStudioTest;
      const before = api.controller().getState().sessionId;
      const duplicate = await api.duplicateMount().then(
        () => false,
        () => true,
      );
      const owner = await api
        .controller()
        .update({ draftNamespace: "other" } as never)
        .then(
          () => false,
          () => true,
        );
      await api.controller().update({ readOnly: true });
      const write = await api
        .controller()
        .execute({ id: "insertText", value: "금지" })
        .then(
          () => false,
          () => true,
        );
      return {
        duplicate,
        owner,
        write,
        before,
        after: api.controller().getState().sessionId,
      };
    });
    expect(result.duplicate && result.owner && result.write).toBe(true);
    expect(result.after).toBe(result.before);
    await expect(page.locator(".ds-browser-mount")).toHaveCount(1);
    if (format === "hwpx")
      await expect(
        page.frameLocator("iframe").locator("html"),
      ).toHaveJSProperty("inert", true);
    await page.evaluate(() =>
      window.browserStudioTest.controller().update({ readOnly: false }),
    );
    if (format === "hwpx")
      await expect(
        page.frameLocator("iframe").locator("html"),
      ).toHaveJSProperty("inert", false);
    await page.evaluate(async () => {
      const api = window.browserStudioTest;
      const source = api.files.get("A")!;
      await api
        .controller()
        .update({
          document: { ...source, fileName: `renamed.${source.format}` },
        });
      await api.controller().whenReady();
    });
    await expect(
      page.getByRole("region", { name: `renamed.${format} 편집기` }),
    ).toBeVisible();
  });

  test(`${format}: held transition rejects competing commands and never reports the old same-id engine as ready`, async ({
    page,
  }) => {
    await open(page, format);
    await page.evaluate(async () => {
      const api = window.browserStudioTest;
      await api
        .controller()
        .execute({ id: "insertText", value: "전환 전 입력" });
      if (!api.controller().getState().dirty)
        throw new Error(
          "Immediate transition edit state: " +
            JSON.stringify(api.controller().getState()) +
            " text=" +
            (await api.controller().readDocument()).text,
        );
      api.holdDraft = true;
      api.draftStarted = false;
      void api.open("B");
    });
    await expect
      .poll(() => page.evaluate(() => window.browserStudioTest.draftStarted))
      .toBe(true);
    const blocked = await page.evaluate(async () => {
      const api = window.browserStudioTest;
      const results = await Promise.allSettled([
        api.controller().execute({ id: "insertText", value: "경합 입력" }),
        api.controller().update({ readOnly: true }),
        api.controller().destroy(),
      ]);
      api.holdDraft = false;
      api.releaseDraft?.();
      return results.map((result) => result.status);
    });
    expect(blocked).toEqual(["rejected", "rejected", "rejected"]);
    await expect
      .poll(() =>
        page.evaluate(
          () => window.browserStudioTest.controller().getState().documentId,
        ),
      )
      .toBe("B");
    await page.evaluate(() =>
      window.browserStudioTest.controller().whenReady(),
    );
    const identity = await page.evaluate(async () => {
      const api = window.browserStudioTest;
      const before = api.controller().getState().sessionId;
      await api.replaceSameId();
      const immediate = api.controller().getState();
      const ready = await api.controller().whenReady();
      return { before, immediate, ready };
    });
    expect(identity.immediate.sessionId).not.toBe(identity.before);
    expect(identity.ready.version).toBe("replacement");
    expect(identity.ready.sessionId).not.toBe(identity.before);
  });
}

test("initialization wait can time out or abort, and destroying a never-ready engine releases all frames", async ({
  page,
}) => {
  await page.route("**/editor-assets/rhwp/index.html?*", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Unresponsive engine</title>",
    }),
  );
  await page.goto("/browser-harness.html?format=hwpx");
  await page.waitForFunction(() => !!window.browserStudioTest);
  const result = await page.evaluate(async () => {
    const api = window.browserStudioTest;
    await api.mount();
    const editor = api.controller();
    const timeout = await editor.whenReady({ timeoutMs: 30 }).then(
      () => false,
      () => true,
    );
    const abort = new AbortController();
    const waiting = editor.whenReady({ signal: abort.signal }).then(
      () => false,
      (error: Error) => error.name,
    );
    abort.abort();
    const aborted = await waiting;
    const pending = editor.whenReady().then(
      () => false,
      () => true,
    );
    await editor.destroy();
    return { timeout, aborted, pending: await pending };
  });
  expect(result).toEqual({
    timeout: true,
    aborted: "AbortError",
    pending: true,
  });
  await expect(page.locator("iframe")).toHaveCount(0);
  await expect(page.locator(".ds-browser-mount")).toHaveCount(0);
});
