import { expect, test, type Page } from "@playwright/test";

async function batch(page: Page, format: "docx" | "hwpx") {
  await page.goto("/harness.html?generatedStorage=test");
  await page.waitForFunction(() => !!window.documentStudioTest);
  await page.evaluate(
    (format) => window.documentStudioTest.load(format, `blank.${format}`),
    format,
  );
  await expect
    .poll(() => page.evaluate(() => window.documentStudioTest.state()?.ready))
    .toBe(true);
  return page.evaluate(async () => {
    const host = window.documentStudioTest,
      agent = host.agent;
    await host.execute({ id: "insertText", value: "안내 {{이름}} 고정 본문" });
    const target = {
      documentId: agent.getState().documentId,
      expectedSessionId: agent.getState().sessionId,
    };
    const template = await agent.registerCurrentMailMergeTemplate(target);
    const preview = agent.previewMailMerge({
      ...target,
      mergeRequest: {
        templateId: template.templateId,
        data: "이름\n김하나\n이둘",
        delimiter: ",",
        mapping: { 이름: "이름" },
        fileNamePattern: `사본-{{#}}.${template.format}`,
        allowEmpty: false,
      },
    });
    const receipt = await agent.generateMailMerge({
      ...target,
      expectedRevision: agent.getState().revision,
      previewId: preview.previewId,
      operationId: "storage-batch",
    });
    return { target, receipt };
  });
}
for (const format of ["docx", "hwpx"] as const) {
  for (const width of [1366, 390])
    test(`${format}/${width}: page preview is read-only and UI stores copies through the shared path`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/harness.html?generatedStorage=test");
      await page.waitForFunction(() => !!window.documentStudioTest);
      await page.evaluate(
        (format) => window.documentStudioTest.load(format, `blank.${format}`),
        format,
      );
      await expect
        .poll(() =>
          page.evaluate(() => window.documentStudioTest.state()?.ready),
        )
        .toBe(true);
      const before = await page.evaluate(async () => {
        await window.documentStudioTest.execute({
          id: "insertText",
          value: "안내 {{이름}} 고정 본문",
        });
        return window.documentStudioTest.agent.getState();
      });
      await page
        .getByRole("button", { name: "빠른 작업", exact: true })
        .click();
      await page
        .getByRole("tab", { name: "서식·메일머지", exact: true })
        .click();
      await page
        .getByRole("button", {
          name: "현재 편집본을 서식으로 등록",
          exact: true,
        })
        .click();
      await page
        .getByLabel("메일머지 입력 데이터", { exact: true })
        .fill("이름\n긴 이름의 줄바꿈과 표 배치를 확인하는 검증 사용자");
      await page
        .getByRole("button", { name: "같은 이름의 열 연결", exact: true })
        .click();
      await page
        .getByRole("button", { name: "메일머지 미리보기", exact: true })
        .click();
      await page
        .getByRole("button", { name: "대표 사본 페이지 미리보기", exact: true })
        .click();
      const dialog = page.getByRole("dialog", {
        name: "대표 사본 페이지 미리보기",
        exact: true,
      });
      await expect(dialog).toBeVisible();
      await expect(
        dialog.locator('.ds-editor-body[aria-busy="false"]'),
      ).toBeVisible({ timeout: 35000 });
      await expect(dialog.locator(".ds-engine-loading")).toHaveCount(0);
      const box = await dialog.boundingBox();
      expect(box!.width).toBeLessThanOrEqual(width);
      await testInfo.attach("page-preview", {
        body: await page.screenshot(),
        contentType: "image/png",
      });
      await page
        .getByRole("button", { name: "페이지 미리보기 닫기", exact: true })
        .click();
      const after = await page.evaluate(() =>
        window.documentStudioTest.agent.getState(),
      );
      expect(after.revision).toBe(before.revision);
      expect(after.sessionId).toBe(before.sessionId);
      expect(after.generatedOutputPending).toBe(false);
      await page
        .getByRole("button", { name: "확인한 1개 문서 생성", exact: true })
        .click();
      await page
        .getByRole("button", {
          name: "검증 작업 공간에 사본 저장",
          exact: true,
        })
        .click();
      await expect
        .poll(() =>
          page.evaluate(
            () => window.documentStudioTest.state()?.generatedOutputPending,
          ),
        )
        .toBe(false);
      await expect(
        page.getByLabel("저장된 사본", { exact: true }),
      ).toContainText("copies/");
      expect(
        await page.evaluate(
          () => window.documentStudioTest.copyStore.calls.length,
        ),
      ).toBe(1);
    });
  test(`${format}: partial storage retries only pending copies through the public agent API`, async ({
    page,
  }) => {
    const { target, receipt } = await batch(page, format);
    await page.evaluate(() => {
      window.documentStudioTest.copyStore.failAt = 2;
    });
    const first = await page.evaluate(
      (target) =>
        window.documentStudioTest.agent.saveMailMergeResults({
          ...target,
          batchOperationId: "storage-batch",
        }),
      target,
    );
    expect(first).toMatchObject({ complete: false, remaining: 1 });
    expect(first.stored).toHaveLength(1);
    expect(
      await page.evaluate(
        () => window.documentStudioTest.state()?.generatedOutputCount,
      ),
    ).toBe(1);
    const second = await page.evaluate(
      (target) =>
        window.documentStudioTest.agent.saveMailMergeResults({
          ...target,
          batchOperationId: "storage-batch",
        }),
      target,
    );
    expect(second).toMatchObject({ complete: true, remaining: 0 });
    expect(second.stored).toHaveLength(2);
    expect(
      await page.evaluate(() => window.documentStudioTest.copyStore.calls),
    ).toEqual([
      receipt.files[0]!.id,
      receipt.files[1]!.id,
      receipt.files[1]!.id,
    ]);
    const saved = await page.evaluate(
      (id) => window.documentStudioTest.copyStore.writes[id]!,
      receipt.files[0]!.id,
    );
    // Reopen in a fresh consumer; original editor input drafts have their own close guard.
    await page.goto("/harness.html?generatedStorage=test");
    await page.waitForFunction(() => !!window.documentStudioTest);
    await page.evaluate(
      ({ saved, format }) => window.documentStudioTest.loadBytes(saved, format),
      { saved, format },
    );
    await expect
      .poll(() => page.evaluate(() => window.documentStudioTest.state()?.ready))
      .toBe(true);
    const text = await page.evaluate(async () => {
      const agent = window.documentStudioTest.agent;
      return (
        await agent.readDocument({ documentId: agent.getState().documentId })
      ).text;
    });
    expect(text).toContain("안내 김하나 고정 본문");
  });
  test(`${format}: invalid receipts, lost responses and expired waits retain recoverable copies`, async ({
    page,
  }) => {
    const { target } = await batch(page, format);
    for (const fault of ["corrupt", "loseResponse", "hanging"] as const) {
      await page.evaluate((fault) => {
        const store = window.documentStudioTest.copyStore;
        store.corrupt = store.loseResponse = store.hanging = false;
        store[fault] = true;
      }, fault);
      const result = await page.evaluate(
        (target) =>
          window.documentStudioTest.agent.saveMailMergeResults({
            ...target,
            batchOperationId: "storage-batch",
          }),
        target,
      );
      expect(result).toMatchObject({ complete: false, remaining: 2 });
      expect(
        await page.evaluate(
          () => window.documentStudioTest.state()?.generatedOutputPending,
        ),
      ).toBe(true);
    }
    await page.evaluate(() => {
      window.documentStudioTest.copyStore.hanging = false;
    });
    const result = await page.evaluate(
      (target) =>
        window.documentStudioTest.agent.saveMailMergeResults({
          ...target,
          batchOperationId: "storage-batch",
        }),
      target,
    );
    expect(result).toMatchObject({ complete: true, remaining: 0 });
    expect(
      Object.keys(
        await page.evaluate(() => window.documentStudioTest.copyStore.writes),
      ),
    ).toHaveLength(2);
  });
}
