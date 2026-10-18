import { expect, test, type Page } from "@playwright/test";

const browserErrors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
});
test.afterEach(({ page }) => {
  expect(browserErrors.get(page)).toEqual([]);
});

async function open(
  page: Page,
  format: string,
  host = "plain",
  persistent = false,
) {
  await page.goto(
    `/browser-harness.html?format=${format}&host=${host}&closeUI=1${persistent ? "&persistAutomation=1" : ""}`,
  );
  await page.waitForFunction(() => Boolean(window.browserStudioTest));
  await page.evaluate(async () => {
    await window.browserStudioTest.mount();
    await window.browserStudioTest.controller().whenReady();
  });
}

async function memoryInput(page: Page, failPersistence = false) {
  await page.evaluate(async (failPersistence) => {
    const api = window.browserStudioTest,
      editor = api.controller();
    await editor.execute({ id: "insertText", value: "안내 {{이름}}" });
    await editor.save();
    const template = await editor.registerCurrentMailMergeTemplate!();
    api.failAutomation = failPersistence;
    editor.previewMailMerge!({
      templateId: template.templateId,
      data: "이름\n보존 입력001234",
      delimiter: ",",
      mapping: { 이름: "이름" },
      fileNamePattern: `사본-{{#}}.${template.format}`,
      allowEmpty: false,
    });
  }, failPersistence);
}

async function discard(page: Page) {
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  await page
    .getByRole("button", { name: "변경 버리고 닫기", exact: true })
    .click();
}

for (const format of ["docx", "hwpx"] as const) {
  for (const host of ["plain", "vue"]) {
    test(`${host}/${format}: explicit body discard destroys without recreating a recovery draft`, async ({
      page,
    }) => {
      await open(page, format, host);
      await page.evaluate(async () => {
        const editor = window.browserStudioTest.controller();
        await editor.execute({ id: "insertText", value: "반드시 폐기할 본문" });
        await editor.flushDraft();
      });
      await discard(page);
      await expect(page.locator(".ds-browser-mount")).toHaveCount(0);
      const result = await page.evaluate(() => {
        const api = window.browserStudioTest;
        return {
          closed: api.closed,
          drafts: api.drafts.size,
          events: api.draftEvents,
          state: api.closeState,
          request: api.closeRequest,
          saves: api.saves,
        };
      });
      expect(result.closed).toBe(true);
      expect(result.drafts).toBe(0);
      expect(result.events.map((event) => event.kind)).toEqual([
        "put",
        "delete",
      ]);
      expect(result.state?.dirty).toBe(true); // Discard is not a pretend save.
      expect(result.request).toMatchObject({
        disposition: "discard",
        documentId: "A",
        draftNamespace: "browser-test",
      });
      expect(result.saves).toBe(0);
      await page.evaluate(async () => {
        await window.browserStudioTest.mount();
        await window.browserStudioTest.controller().whenReady();
      });
      expect(
        await page.evaluate(
          async () =>
            (await window.browserStudioTest.controller().readDocument()).text,
        ),
      ).not.toContain("반드시 폐기할 본문");
    });

    test(`${host}/${format}: explicit memory-input discard closes while ordinary destroy still protects it`, async ({
      page,
    }) => {
      await open(page, format, host);
      await memoryInput(page);
      const rejected = await page.evaluate(() =>
        window.browserStudioTest
          .controller()
          .destroy()
          .then(
            () => false,
            () => true,
          ),
      );
      expect(rejected).toBe(true);
      await expect(page.locator(".ds-browser-mount")).toHaveCount(1);
      await discard(page);
      await expect(page.locator(".ds-browser-mount")).toHaveCount(0);
      expect(
        await page.evaluate(() => window.browserStudioTest.closeState),
      ).toMatchObject({
        dirty: false,
        automationDraftPending: true,
        generatedOutputPending: false,
      });
      expect(await page.evaluate(() => window.browserStudioTest.closed)).toBe(
        true,
      );
    });
  }

  test(`${format}: ordinary clean UI close uses the preserve path`, async ({
    page,
  }) => {
    await open(page, format);
    await page.getByRole("button", { name: "닫기", exact: true }).click();
    await expect(page.locator(".ds-browser-mount")).toHaveCount(0);
    expect(
      await page.evaluate(() => window.browserStudioTest.closeRequest),
    ).toBeUndefined();
  });

  test(`${format}: forged and expired close approvals do not disable ordinary lifecycle protection`, async ({
    page,
  }) => {
    await open(page, format);
    const forged = await page.evaluate(async () => {
      const api = window.browserStudioTest,
        editor = api.controller(),
        state = editor.getState();
      return editor
        .destroy({
          disposition: "discard",
          documentId: state.documentId,
          sessionId: state.sessionId,
          revision: state.revision,
          draftNamespace: "browser-test",
        })
        .then(
          () => false,
          () => true,
        );
    });
    expect(forged).toBe(true);
    await memoryInput(page);
    await page.evaluate(() => {
      window.browserStudioTest.captureClose = true;
    });
    await discard(page);
    await expect
      .poll(() => page.evaluate(() => window.browserStudioTest.closeCalls))
      .toBe(1);
    await expect
      .poll(() =>
        page.evaluate(
          () => window.browserStudioTest.controller().getState().busy,
        ),
      )
      .toBe(false);
    const stale = await page.evaluate(() =>
      window.browserStudioTest
        .controller()
        .destroy(window.browserStudioTest.closeRequest)
        .then(
          () => false,
          () => true,
        ),
    );
    expect(stale).toBe(true);
    await page.evaluate(() => {
      window.browserStudioTest.captureClose = false;
    });
    await page
      .getByRole("button", { name: "변경 버리고 닫기", exact: true })
      .click();
    await expect(page.locator(".ds-browser-mount")).toHaveCount(0);
    const previous = await page.evaluate(
      () => window.browserStudioTest.closeRequest,
    );
    await page.evaluate(async () => {
      await window.browserStudioTest.mount();
      await window.browserStudioTest.controller().whenReady();
    });
    const otherLifetime = await page.evaluate(
      (request) =>
        window.browserStudioTest
          .controller()
          .destroy(request)
          .then(
            () => false,
            () => true,
          ),
      previous,
    );
    expect(otherLifetime).toBe(true);
    await page.evaluate(() => window.browserStudioTest.controller().destroy());
    await expect(page.locator(".ds-browser-mount")).toHaveCount(0);
  });

  test(`${format}: persistent-input failure blocks close and recovers without silently dropping inputs`, async ({
    page,
  }) => {
    await open(page, format, "plain", true);
    await memoryInput(page, true);
    await discard(page);
    await expect(
      page.getByText(/Test automation storage failure/).first(),
    ).toBeVisible();
    expect(await page.evaluate(() => window.browserStudioTest.closeCalls)).toBe(
      0,
    );
    await page.evaluate(() => {
      window.browserStudioTest.failAutomation = false;
    });
    await page
      .getByRole("button", { name: "변경 버리고 닫기", exact: true })
      .click();
    await expect(page.locator(".ds-browser-mount")).toHaveCount(0);
    expect(
      await page.evaluate(
        () => window.browserStudioTest.closeState?.automationDraft.pending,
      ),
    ).toBe(false);
  });

  test(`${format}: a pending autosave finishes before approved draft deletion`, async ({
    page,
  }) => {
    await open(page, format);
    await page.evaluate(async () => {
      const api = window.browserStudioTest;
      api.holdDraft = true;
      await api
        .controller()
        .execute({ id: "insertText", value: "늦은 초안도 폐기" });
    });
    await expect
      .poll(() => page.evaluate(() => window.browserStudioTest.draftStarted))
      .toBe(true);
    await discard(page);
    expect(await page.evaluate(() => window.browserStudioTest.closeCalls)).toBe(
      0,
    );
    await page.evaluate(() => {
      const api = window.browserStudioTest;
      api.holdDraft = false;
      api.releaseDraft!();
    });
    await expect(page.locator(".ds-browser-mount")).toHaveCount(0);
    expect(
      await page.evaluate(() =>
        window.browserStudioTest.draftEvents.map((event) => event.kind),
      ),
    ).toEqual(["put", "delete"]);
    expect(
      await page.evaluate(() => window.browserStudioTest.drafts.size),
    ).toBe(0);
  });

  test(`${format}: source switching and new commands are blocked during discard preparation`, async ({
    page,
  }) => {
    await open(page, format);
    await page.evaluate(async () => {
      const api = window.browserStudioTest;
      await api.controller().execute({ id: "insertText", value: "A 변경" });
      api.holdDelete = true;
    });
    await discard(page);
    await expect
      .poll(() => page.evaluate(() => window.browserStudioTest.deleteStarted))
      .toBe(true);
    await expect(
      page.getByRole("button", { name: "계속 편집", exact: true }),
    ).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("dialog", { name: "편집을 마칠까요?", exact: true }),
    ).toBeVisible();
    const blocked = await page.evaluate(async () => {
      const api = window.browserStudioTest;
      return {
        update: await api.open("B").then(
          () => false,
          () => true,
        ),
        edit: await api
          .controller()
          .execute({ id: "insertText", value: "늦은 변경" })
          .then(
            () => false,
            () => true,
          ),
        id: api.controller().getState().documentId,
      };
    });
    expect(blocked).toEqual({ update: true, edit: true, id: "A" });
    await page.evaluate(() => {
      const api = window.browserStudioTest;
      api.holdDelete = false;
      api.releaseDelete!();
    });
    await expect(page.locator(".ds-browser-mount")).toHaveCount(0);
  });

  test(`${format}: host close rejection is surfaced and a later explicit discard can succeed`, async ({
    page,
  }) => {
    await open(page, format);
    await memoryInput(page);
    await page.evaluate(() => {
      window.browserStudioTest.failClose = true;
    });
    await discard(page);
    await expect(
      page.getByText("Test host close failure", { exact: true }),
    ).toBeVisible();
    await expect(page.locator(".ds-browser-mount")).toHaveCount(1);
    await page.evaluate(() => {
      window.browserStudioTest.failClose = false;
    });
    await page
      .getByRole("button", { name: "변경 버리고 닫기", exact: true })
      .click();
    await expect(page.locator(".ds-browser-mount")).toHaveCount(0);
  });

  test(`${format}: new automation input after discard approval requires a new decision`, async ({
    page,
  }) => {
    await open(page, format);
    await memoryInput(page);
    await page.getByRole("button", { name: "닫기", exact: true }).click();
    await page.evaluate(() => {
      const discard = Array.from(document.querySelectorAll("button")).find(
        (button) => button.textContent?.trim() === "변경 버리고 닫기",
      )!;
      discard.click();
      const editor = window.browserStudioTest.controller(),
        template = editor.listMailMergeTemplates!()[0]!;
      editor.previewMailMerge!({
        templateId: template.templateId,
        data: "이름\n승인 뒤 새 입력",
        delimiter: ",",
        mapping: { 이름: "이름" },
        fileNamePattern: `사본-{{#}}.${template.format}`,
        allowEmpty: false,
      });
    });
    await expect(
      page.getByText("폐기 대상 문서 또는 보관 설정이 변경됐습니다.", {
        exact: true,
      }),
    ).toBeVisible();
    expect(await page.evaluate(() => window.browserStudioTest.closeCalls)).toBe(
      0,
    );
    await page.getByRole("button", { name: "계속 편집", exact: true }).click();
    await page.getByRole("button", { name: "빠른 작업", exact: true }).click();
    await page
      .getByRole("tab", { name: "문서 일괄 생성", exact: true })
      .click();
    await expect(
      page.getByLabel("메일머지 입력 데이터", { exact: true }),
    ).toHaveValue("이름\n승인 뒤 새 입력");
    await discard(page);
    await expect(page.locator(".ds-browser-mount")).toHaveCount(0);
  });

  test(`${format}: an external input lock cannot be bypassed by UI discard`, async ({
    page,
  }) => {
    await open(page, format);
    await memoryInput(page);
    await page.evaluate(async () => {
      const api = window.browserStudioTest;
      api.releaseClose = await api.controller().acquireInputLock();
    });
    await page.getByRole("button", { name: "닫기", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "변경 버리고 닫기", exact: true }),
    ).toBeDisabled();
    expect(await page.evaluate(() => window.browserStudioTest.closeCalls)).toBe(
      0,
    );
    await page.evaluate(async () => {
      await window.browserStudioTest.releaseClose!();
    });
    await page
      .getByRole("button", { name: "변경 버리고 닫기", exact: true })
      .click();
    await expect(page.locator(".ds-browser-mount")).toHaveCount(0);
  });

  test(`${format}: generated copies require their separate discard decision`, async ({
    page,
  }) => {
    await open(page, format);
    await memoryInput(page);
    await page.evaluate(async () => {
      const editor = window.browserStudioTest.controller();
      const template = editor.listMailMergeTemplates!()[0]!;
      const preview = editor.previewMailMerge!({
        templateId: template.templateId,
        data: "이름\n남길 사본",
        delimiter: ",",
        mapping: { 이름: "이름" },
        fileNamePattern: `사본-{{#}}.${template.format}`,
        allowEmpty: false,
      });
      await editor.generateMailMerge!({
        previewId: preview.previewId,
        operationId: "close-generated",
      });
    });
    await page.getByRole("button", { name: "닫기", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "변경 버리고 닫기", exact: true }),
    ).toBeDisabled();
    expect(
      await page.evaluate(() =>
        window.browserStudioTest
          .controller()
          .destroy()
          .then(
            () => false,
            () => true,
          ),
      ),
    ).toBe(true);
    expect(
      await page.evaluate(
        () =>
          window.browserStudioTest.controller().getState()
            .generatedOutputPending,
      ),
    ).toBe(true);
    expect(await page.evaluate(() => window.browserStudioTest.closeCalls)).toBe(
      0,
    );
  });
}
