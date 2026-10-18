import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { unzipSync } from "fflate";

async function open(page: Page, format: "docx" | "hwpx", host = "plain") {
  await page.goto(
    `/browser-harness.html?format=${format}&host=${host}&persistAutomation=1`,
  );
  await page.waitForFunction(() => !!window.browserStudioTest);
  await page.evaluate(async () => {
    const api = window.browserStudioTest;
    await api.mount("A");
    await api.controller().whenReady();
    await api
      .controller()
      .execute({ id: "insertText", value: "안내 {{이름}}" });
    await api.controller().save();
  });
}
async function generate(page: Page, operationId = "lifecycle-batch") {
  return page.evaluate(async (operationId) => {
    const editor = window.browserStudioTest.controller();
    const source = await editor.registerCurrentMailMergeTemplate!();
    const preview = editor.previewMailMerge!({
      templateId: source.templateId,
      data: "이름\n홍길동\n김하나",
      delimiter: ",",
      mapping: { 이름: "이름" },
      fileNamePattern: `사본-{{#}}.${source.format}`,
      allowEmpty: false,
    });
    const result = await editor.generateMailMerge!({
      previewId: preview.previewId,
      operationId,
    });
    await editor.flushAutomationDraft();
    return result;
  }, operationId);
}
for (const format of ["docx", "hwpx"] as const) {
  for (const host of ["plain", "vue"])
    test(`${host}/${format}: source save, exports and download requests cannot silently discard generated copies`, async ({
      page,
    }) => {
      await open(page, format, host);
      const receipt = await generate(page);
      const result = await page.evaluate(async (receipt) => {
        const api = window.browserStudioTest,
          e = api.controller(),
          identity = e.getState().sessionId;
        const denied: string[] = [];
        await e.save({ onlyIfDirty: true });
        for (const operation of [() => e.destroy(), () => api.open("B")]) {
          try {
            await operation();
            denied.push("unexpected");
          } catch (error) {
            denied.push(String(error));
          }
        }
        e.exportMailMerge!(receipt.operationId);
        e.exportMailMergeArchive!(receipt.operationId);
        e.noteMailMergeDownload!(receipt.operationId);
        const requested = e.getState().generatedOutputPending;
        let invalidReceipt = false;
        try {
          e.acknowledgeMailMergeDelivery!({
            operationId: receipt.operationId,
            files: [
              {
                id: receipt.files[0]!.id,
                digest: "wrong",
                destination: "storage",
                version: "server-v1",
              },
            ],
          });
        } catch {
          invalidReceipt = true;
        }
        const delivery = (file: (typeof receipt.files)[number]) => ({
          id: file.id,
          digest: file.digest,
          destination: "storage" as const,
          version: "server-v1",
        });
        e.acknowledgeMailMergeDelivery!({
          operationId: receipt.operationId,
          files: [delivery(receipt.files[0]!)],
        });
        const partial = e.getState().generatedOutputCount;
        e.acknowledgeMailMergeDelivery!({
          operationId: receipt.operationId,
          files: [delivery(receipt.files[1]!)],
        });
        const same = e.getState().sessionId === identity,
          clean = !e.getState().dirty;
        await api.open("B");
        await e.whenReady();
        return {
          denied,
          requested,
          invalidReceipt,
          partial,
          same,
          clean,
          next: e.getState().documentId,
        };
      }, receipt);
      expect(result.denied).toHaveLength(2);
      expect(result.denied.every((text) => text.includes("보관"))).toBe(true);
      expect(result).toMatchObject({
        requested: true,
        invalidReceipt: true,
        partial: 1,
        same: true,
        clean: true,
        next: "B",
      });
    });
  test(`${format}: agent unregisters templates, invalidates previews and rejects removal during generation`, async ({
    page,
  }) => {
    await open(page, format);
    const result = await page.evaluate(async () => {
      const api = window.browserStudioTest,
        e = api.controller(),
        a = api.agent;
      const state = e.getState(),
        first = await a.registerCurrentMailMergeTemplate({
          documentId: state.documentId,
        });
      await a.registerCurrentMailMergeTemplate({
        documentId: state.documentId,
      });
      let full = false,
        stale = false,
        invalidated = false,
        running = false;
      try {
        await a.registerCurrentMailMergeTemplate({
          documentId: state.documentId,
        });
      } catch {
        full = true;
      }
      const request = {
        documentId: state.documentId,
        expectedSessionId: state.sessionId,
        templateId: first.templateId,
      };
      try {
        a.removeMailMergeTemplate({ ...request, expectedSessionId: "other" });
      } catch {
        stale = true;
      }
      const merge = {
        templateId: first.templateId,
        data: "이름\n홍길동",
        delimiter: "," as const,
        mapping: { 이름: "이름" },
        fileNamePattern: `사본-{{#}}.${first.format}`,
        allowEmpty: false,
      };
      const p = e.previewMailMerge!(merge);
      const removed = a.removeMailMergeTemplate(request),
        repeated = a.removeMailMergeTemplate(request);
      try {
        await e.generateMailMerge!({
          previewId: p.previewId,
          operationId: "removed",
        });
      } catch {
        invalidated = true;
      }
      const third = await a.registerCurrentMailMergeTemplate({
        documentId: state.documentId,
      });
      const next = e.previewMailMerge!({
        ...merge,
        templateId: third.templateId,
      });
      const task = e.generateMailMerge!({
        previewId: next.previewId,
        operationId: "active",
      });
      try {
        a.removeMailMergeTemplate({ ...request, templateId: third.templateId });
      } catch {
        running = true;
      }
      e.cancelMailMerge!("active");
      await task.catch(() => undefined);
      return {
        full,
        stale,
        invalidated,
        running,
        removed,
        repeated,
        count: a.listMailMergeTemplates({ documentId: state.documentId })
          .length,
      };
    });
    expect(result).toEqual({
      full: true,
      stale: true,
      invalidated: true,
      running: true,
      removed: { removed: true },
      repeated: { removed: false },
      count: 2,
    });
  });
  test(`${format}: generated output UI requires confirmation after ZIP download or explicit discard`, async ({
    page,
  }) => {
    await open(page, format);
    const receipt = await generate(page);
    await page
      .getByRole("button", { name: "문단·표·그림", exact: true })
      .click();
    await page
      .getByRole("tab", { name: "문서 일괄 생성", exact: true })
      .click();
    const download = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "생성 파일 ZIP 내려받기", exact: true })
      .click();
    const entries = unzipSync(await readFile(await (await download).path()));
    expect(Object.keys(entries).sort()).toEqual(
      receipt.files.map((file) => file.fileName).sort(),
    );
    expect(
      await page.evaluate(
        () =>
          window.browserStudioTest.controller().getState()
            .generatedOutputPending,
      ),
    ).toBe(true);
    await page
      .getByRole("button", { name: "생성 결과 버리기", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "생성 사본을 버릴까요?" });
    await page.setViewportSize({ width: 390, height: 900 });
    const bounds = await dialog.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
    await page.keyboard.press("Shift+Tab");
    await expect(
      dialog.getByRole("button", {
        name: "확인한 생성 결과 버리기",
        exact: true,
      }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      dialog.getByRole("button", { name: "계속 보관", exact: true }),
    ).toBeFocused();
    await expect(dialog).toContainText(receipt.files[0]!.fileName);
    await dialog
      .getByRole("button", { name: "계속 보관", exact: true })
      .click();
    await page
      .getByRole("button", { name: "생성 결과 버리기", exact: true })
      .click();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expect(
      page.getByRole("button", { name: "생성 파일 ZIP 내려받기", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          window.browserStudioTest.controller().getState()
            .generatedOutputPending,
      ),
    ).toBe(true);
    await page
      .getByRole("button", { name: "다운로드한 파일 보관 확인", exact: true })
      .click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.browserStudioTest.controller().getState()
              .generatedOutputPending,
        ),
      )
      .toBe(false);
    const next = await generate(page, "second-batch");
    expect(next.operationId).not.toBe(receipt.operationId);
    expect(
      await page.evaluate(
        () =>
          window.browserStudioTest.controller().getState()
            .generatedOutputPending,
      ),
    ).toBe(true);
    await page
      .getByRole("button", { name: "생성 결과 버리기", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: "확인한 생성 결과 버리기", exact: true })
      .click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.browserStudioTest.controller().getState()
              .generatedOutputPending,
        ),
      )
      .toBe(false);
    await expect(
      page.getByRole("region", { name: "생성 사본 보관" }),
    ).toHaveCount(0);
    await page.evaluate(() => window.browserStudioTest.controller().destroy());
    await expect(page.locator(".ds-browser-mount")).toHaveCount(0);
  });
}
