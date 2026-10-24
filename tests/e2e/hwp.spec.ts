import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { PNG } from "pngjs";
import { validateHwpDocument } from "../../packages/core/src/hwp";

async function ready(page: Page) {
  await expect
    .poll(() => page.evaluate(() => window.documentStudioTest.state()?.ready))
    .toBe(true);
}
async function open(page: Page, name = "rich.hwp") {
  await page.goto("/harness.html");
  await page.waitForFunction(() => Boolean(window.documentStudioTest));
  await page.evaluate(
    (name) => window.documentStudioTest.load("hwp", name),
    name,
  );
  await ready(page);
}
const read = (page: Page) =>
  page.evaluate(async () => {
    const a = window.documentStudioTest.agent,
      s = a.getState();
    return a.readDocument({
      documentId: s.documentId,
      expectedSessionId: s.sessionId,
    });
  });

test("HWP uses common SDK chrome, self-hosted fonts and structure projection", async ({
  page,
}) => {
  await open(page);
  await expect(page.getByTitle("HWP 문서 편집 영역")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "문단·표·그림", exact: true }),
  ).toBeVisible();
  const result = await page.evaluate(async () => {
    const api = window.documentStudioTest,
      s = api.agent.getState();
    return {
      state: s,
      structure: await api.agent.inspect({
        documentId: s.documentId,
        expectedSessionId: s.sessionId,
      }),
    };
  });
  expect(result.state.format).toBe("hwp");
  expect(result.structure.format).toBe("hwp");
  expect(result.structure.inspectedFormat).toBe("hwpx");
  expect(result.structure.tables.length).toBeGreaterThan(0);
  await expect
    .poll(() =>
      page.evaluate(() => window.documentStudioTest.state()?.fonts?.ready),
    )
    .toBe(true);
  expect((await read(page)).text).toContain("한국어");
  // The rich fixture intentionally has a blank first page in both original HWPX
  // and generated HWP. Verify actual ink using the one-page text-only fixture.
  await page.evaluate(() =>
    window.documentStudioTest.load("hwp", "sample.hwp"),
  );
  await expect
    .poll(() =>
      page.evaluate(() => {
        const s = window.documentStudioTest.state();
        return s?.ready && s.documentId === "test:sample.hwp";
      }),
    )
    .toBe(true);
  const canvas = page
    .frameLocator("iframe")
    .locator("canvas.document-page-canvas")
    .first();
  await expect
    .poll(async () => {
      const png = PNG.sync.read(await canvas.screenshot());
      let ink = 0;
      for (let y = 8; y < png.height - 8; y++)
        for (let x = 8; x < png.width - 8; x++) {
          const i = (y * png.width + x) * 4;
          if (
            png.data[i + 3]! > 200 &&
            png.data[i]! + png.data[i + 1]! + png.data[i + 2]! < 300
          )
            ink++;
        }
      return ink;
    })
    .toBeGreaterThan(200);
  await page.screenshot({
    path: ".build/hwp-integration/sdk-hwp-common-ui.png",
  });
});

test("HWP agent replacement saves actual HWP and survives reopen", async ({
  page,
}) => {
  await open(page, "sample.hwp");
  const before = (await read(page)).text;
  const query = before.split(/\s+/).find((word) => word.length > 2)!;
  const replacement = "SDK한글원본저장검증";
  await page.evaluate(
    async ({ query, replacement }) => {
      const a = window.documentStudioTest.agent,
        s = a.getState();
      const found = await a.search({ documentId: s.documentId, query });
      const now = a.getState();
      await a.replace({
        documentId: now.documentId,
        expectedSessionId: now.sessionId,
        expectedRevision: now.revision,
        matchId: found.matches[0]!.id,
        replacement,
      });
      await window.documentStudioTest.save();
    },
    { query, replacement },
  );
  const result = await page.evaluate(() => ({
    bytes: window.documentStudioTest.saved,
    event: window.documentStudioTest.savedEvent,
    state: window.documentStudioTest.state(),
  }));
  expect(result.event?.format).toBe("hwp");
  expect(result.state?.dirty).toBe(false);
  expect(() => validateHwpDocument(new Uint8Array(result.bytes))).not.toThrow();
  await page.evaluate(
    (bytes) => window.documentStudioTest.loadBytes(bytes, "hwp"),
    result.bytes,
  );
  await ready(page);
  expect((await read(page)).text).toContain(replacement);
});

test("HWP Korean composition, formatting, undo and redo keep the binary format", async ({
  page,
  context,
}) => {
  await open(page, "blank.hwp");
  await page.evaluate(() =>
    window.documentStudioTest.execute({ id: "selectAll" }),
  );
  const input = page
    .frameLocator("iframe")
    .getByLabel("문서 편집 입력", { exact: true });
  await input.focus();
  const cdp = await context.newCDPSession(page);
  try {
    await cdp.send("Input.imeSetComposition", {
      text: "ㅎ",
      selectionStart: 1,
      selectionEnd: 1,
    });
    await cdp.send("Input.imeSetComposition", {
      text: "한글",
      selectionStart: 2,
      selectionEnd: 2,
    });
    await cdp.send("Input.insertText", { text: "한글" });
    await page.keyboard.insertText(" SDK 조합 검증");
  } finally {
    await cdp.detach();
  }
  await expect
    .poll(async () => (await read(page)).text)
    .toContain("한글 SDK 조합 검증");
  await page.evaluate(async () => {
    const api = window.documentStudioTest;
    await api.execute({ id: "selectAll" });
    await api.execute({ id: "fontSize", value: 16 });
    await api.execute({ id: "lineSpacing", value: 1.5 });
    await api.execute({ id: "bold" });
    await api.execute({ id: "undo" });
    await api.execute({ id: "redo" });
  });
  const bytes = await page.evaluate(() => window.documentStudioTest.export());
  expect(() => validateHwpDocument(new Uint8Array(bytes))).not.toThrow();
  await page.evaluate(async (bytes) => {
    await window.documentStudioTest.save();
    window.documentStudioTest.loadBytes(bytes, "hwp");
  }, bytes);
  await ready(page);
  expect((await read(page)).text).toContain("한글 SDK 조합 검증");
});

test("HWP preserves recent input in a recoverable draft", async ({ page }) => {
  await open(page, "blank.hwp");
  await page.evaluate(async () => {
    await window.documentStudioTest.execute({
      id: "insertText",
      value: "HWP 최근 입력 초안",
    });
    await window.documentStudioTest.flushDraft();
    await window.documentStudioTest.closeAfterDraft();
  });
  await page.evaluate(() => window.documentStudioTest.load("hwp", "blank.hwp"));
  await page.getByRole("button", { name: "초안 복구", exact: true }).click();
  await ready(page);
  expect((await read(page)).text).toContain("HWP 최근 입력 초안");
});

test("HWP failed save remains dirty and can be retried", async ({ page }) => {
  await open(page, "blank.hwp");
  await page.evaluate(async () => {
    await window.documentStudioTest.execute({
      id: "insertText",
      value: "실패 후 재시도",
    });
    window.documentStudioTest.mode = "failure";
    await window.documentStudioTest.save().catch(() => {});
  });
  expect(
    await page.evaluate(() => window.documentStudioTest.state()?.dirty),
  ).toBe(true);
  await page.evaluate(async () => {
    window.documentStudioTest.mode = "success";
    await window.documentStudioTest.save();
  });
  expect(
    await page.evaluate(() => window.documentStudioTest.state()?.dirty),
  ).toBe(false);
  const saved = await page.evaluate(() => window.documentStudioTest.saved);
  expect(() => validateHwpDocument(new Uint8Array(saved))).not.toThrow();
});

test("HWP repeatedly opens after switching through another format", async ({
  page,
}) => {
  await open(page);
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() =>
      window.documentStudioTest.load("hwpx", "blank.hwpx"),
    );
    await ready(page);
    await page.evaluate(() =>
      window.documentStudioTest.load("hwp", "rich.hwp"),
    );
    await ready(page);
    expect((await read(page)).text).toContain("한국어");
  }
});

test("renamed ZIP cannot enter the HWP WASM editor", async ({ page }) => {
  await page.goto("/harness.html");
  await page.waitForFunction(() => Boolean(window.documentStudioTest));
  await page.evaluate(
    (bytes) => window.documentStudioTest.loadBytes(bytes, "hwp"),
    [...(await readFile("fixtures/rich.hwpx"))],
  );
  await expect(page.getByRole("alert")).toContainText("HWP");
  expect(
    await page.evaluate(() => window.documentStudioTest.state()?.ready),
  ).toBe(false);
});
