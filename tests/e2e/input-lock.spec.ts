import { test, expect, type Page } from "@playwright/test";
import { unzipSync, strFromU8 } from "fflate";

type Format = "docx" | "hwpx";
async function load(page: Page, format: Format) {
  await page.goto("/harness.html");
  await page.waitForFunction(() => window.documentStudioTest);
  await page.evaluate(
    (format) => window.documentStudioTest.load(format),
    format,
  );
  await expect(
    page.getByRole("button", { name: "굵게", exact: true }),
  ).toBeEnabled();
}
function input(page: Page, format: Format) {
  return format === "docx"
    ? page.getByRole("textbox", { name: "Document content", exact: true })
    : page.frameLocator("iframe").getByLabel("문서 편집 입력", { exact: true });
}
async function text(page: Page, format: Format, saved = false) {
  const bytes = await page.evaluate(
    (saved) =>
      saved
        ? window.documentStudioTest.saved
        : window.documentStudioTest.export(),
    saved,
  );
  const key = format === "docx" ? "word/document.xml" : "Contents/section0.xml";
  return Array.from(
    strFromU8(unzipSync(new Uint8Array(bytes))[key]!).matchAll(
      /<(?:w|hp):t(?:\s[^>]*)?>([^<]*)<\/(?:w|hp):t>/g,
    ),
    (m) => m[1],
  ).join("");
}
async function attemptInput(page: Page, format: Format) {
  await page.keyboard.type("BLOCKED7");
  await page.keyboard.insertText("차단된한글입력");
  // Exercise composition/paste handlers even if a browser or IME retains the old textarea target.
  await input(page, format).evaluate((element) => {
    element.dispatchEvent(
      new CompositionEvent("compositionend", {
        bubbles: true,
        data: "차단된조합",
      }),
    );
    if (element instanceof HTMLTextAreaElement)
      element.value = "차단된붙여넣기";
    element.dispatchEvent(
      new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        inputType: "insertFromPaste",
        data: "차단된붙여넣기",
      }),
    );
    element.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: "차단된붙여넣기",
      }),
    );
  });
}

for (const format of ["docx", "hwpx"] as const) {
  test(`${format}: focused native input respects readonly and resumes after permission restoration`, async ({
    page,
  }) => {
    await load(page, format);
    await input(page, format).focus();
    const before = await text(page, format);
    await page.evaluate(() => {
      window.documentStudioTest.readOnly = true;
      window.documentStudioTest.rerender();
    });
    await expect(
      page.getByRole("button", { name: "굵게", exact: true }),
    ).toBeDisabled();
    await attemptInput(page, format);
    expect(await text(page, format)).toBe(before);
    expect(
      await page.evaluate(() => window.documentStudioTest.state()?.dirty),
    ).toBe(false);
    await page.evaluate(() => {
      window.documentStudioTest.readOnly = false;
      window.documentStudioTest.rerender();
    });
    await expect(
      page.getByRole("button", { name: "굵게", exact: true }),
    ).toBeEnabled();
    await input(page, format).focus();
    await page.keyboard.insertText("복구후입력");
    await expect.poll(() => text(page, format)).toContain("복구후입력");
  });
  test(`${format}: nested transition locks survive save, reject SDK mutations and resume on final release`, async ({
    page,
  }) => {
    await load(page, format);
    await input(page, format).focus();
    await page.keyboard.insertText("저장할내용");
    await page.evaluate(async () => {
      await window.documentStudioTest.acquireInputLock();
      await window.documentStudioTest.acquireInputLock();
      await window.documentStudioTest.save();
    });
    const before = await text(page, format);
    expect(await text(page, format, true)).toBe(before);
    await attemptInput(page, format);
    expect(await text(page, format)).toBe(before);
    for (const operation of ["execute", "replace", "preset"] as const) {
      const error = await page.evaluate(async (operation) => {
        const api = window.documentStudioTest;
        try {
          if (operation === "execute")
            await api.execute({ id: "insertText", value: "SDK금지" });
          if (operation === "replace")
            await api.agent.replace({
              query: "저장",
              replacement: "금지",
              all: true,
              documentId: api.state()!.documentId,
              expectedSessionId: api.state()!.sessionId,
              expectedRevision: api.state()!.revision,
            });
          if (operation === "preset")
            await api.agent.applyPreset({
              preset: {
                id: "locked",
                name: "잠금",
                description: "입력 잠금 검증",
                commands: [{ id: "bold" }],
              },
              documentId: api.state()!.documentId,
              expectedSessionId: api.state()!.sessionId,
              expectedRevision: api.state()!.revision,
              expectedSelectionKey: api.state()!.selectionKey!,
            });
          return null;
        } catch (error) {
          return String(error);
        }
      }, operation);
      expect(error).toContain("읽기 전용");
    }
    await page.evaluate(() => window.documentStudioTest.releaseInputLock());
    await expect(
      page.getByRole("button", { name: "굵게", exact: true }),
    ).toBeDisabled();
    await page.evaluate(() => window.documentStudioTest.releaseInputLock());
    await expect(
      page.getByRole("button", { name: "굵게", exact: true }),
    ).toBeEnabled();
    await page.evaluate(() =>
      window.documentStudioTest.execute({
        id: "insertText",
        value: "잠금해제후입력",
      }),
    );
    expect(await text(page, format)).toContain("잠금해제후입력");
  });
  test(`${format}: saving freezes already focused native input and restores it after failure`, async ({
    page,
  }) => {
    await load(page, format);
    await input(page, format).focus();
    await page.keyboard.insertText("저장직전");
    const before = await text(page, format);
    await page.evaluate(() => {
      window.documentStudioTest.pauseNextSave = true;
      void window.documentStudioTest.save();
    });
    await expect
      .poll(() => page.evaluate(() => window.documentStudioTest.saves))
      .toBe(1);
    await attemptInput(page, format);
    expect(await text(page, format)).toBe(before);
    await page.evaluate(() => window.documentStudioTest.releasePausedSave?.());
    await expect
      .poll(() => page.evaluate(() => window.documentStudioTest.state()?.busy))
      .toBe(false);
    expect(await text(page, format, true)).toBe(before);
    await page.evaluate(async () => {
      window.documentStudioTest.mode = "failure";
      await window.documentStudioTest.save().catch(() => {});
    });
    await expect(
      page.getByRole("button", { name: "굵게", exact: true }),
    ).toBeEnabled();
    await input(page, format).focus();
    await page.keyboard.insertText("실패후입력");
    expect(await text(page, format)).toContain("실패후입력");
  });
  test(`${format}: final save drains an earlier SDK text command while new user input stays blocked`, async ({
    page,
  }) => {
    await load(page, format);
    await page.evaluate(() => {
      window.documentStudioTest.pauseNextCommand = true;
      void window.documentStudioTest.execute({
        id: "insertText",
        value: "이전명령보존",
      });
    });
    await expect
      .poll(() =>
        page.evaluate(() => window.documentStudioTest.state()?.pendingCommands),
      )
      .toBe(1);
    await page.evaluate(async () => {
      await window.documentStudioTest.acquireInputLock();
      void window.documentStudioTest.save();
    });
    await page.evaluate(() =>
      window.documentStudioTest.releasePausedCommand?.(),
    );
    await expect
      .poll(() => page.evaluate(() => window.documentStudioTest.state()?.busy))
      .toBe(false);
    expect(await text(page, format, true)).toContain("이전명령보존");
    await attemptInput(page, format);
    expect(await text(page, format)).toBe(await text(page, format, true));
    await page.evaluate(() => window.documentStudioTest.releaseInputLock());
  });
  test(`${format}: transition locks belong to their original editing session`, async ({
    page,
  }) => {
    await load(page, format);
    const original = await page.evaluate(
      () => window.documentStudioTest.state()!.sessionId,
    );
    await page.evaluate(async () => {
      await window.documentStudioTest.acquireInputLock();
      await window.documentStudioTest.createTemplate("docx", {
        fileName: "next.docx",
        blocks: [{ kind: "paragraph", text: "새 문서" }],
      });
    });
    await expect(
      page.getByRole("button", { name: "굵게", exact: true }),
    ).toBeEnabled();
    expect(
      await page.evaluate(() => window.documentStudioTest.state()!.sessionId),
    ).not.toBe(original);
    await page.evaluate(() => window.documentStudioTest.acquireInputLock());
    // Release the new lock, then the stale old one. Neither may lock the new session again.
    await page.evaluate(async () => {
      await window.documentStudioTest.releaseInputLock();
      await window.documentStudioTest.releaseInputLock();
    });
    await page.evaluate(() =>
      window.documentStudioTest.execute({
        id: "insertText",
        value: "새세션입력",
      }),
    );
    expect(await text(page, "docx")).toContain("새세션입력");
  });
}

test("hwpx: an active IME composition is committed once before transition and can resume afterward", async ({
  page,
  context,
}) => {
  await load(page, "hwpx");
  await input(page, "hwpx").focus();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Input.imeSetComposition", {
    text: "조합보존",
    selectionStart: 4,
    selectionEnd: 4,
  });
  await page.evaluate(async () => {
    await window.documentStudioTest.acquireInputLock();
    await window.documentStudioTest.save();
  });
  expect(await text(page, "hwpx", true)).toContain("조합보존");
  await cdp.send("Input.insertText", { text: "늦은IME금지" });
  expect(await text(page, "hwpx")).toBe(await text(page, "hwpx", true));
  await page.evaluate(() => window.documentStudioTest.releaseInputLock());
  await input(page, "hwpx").focus();
  await page.keyboard.insertText("재편집가능");
  const result = await text(page, "hwpx");
  expect(result).toContain("재편집가능");
  expect(result.match(/조합보존/g)).toHaveLength(1);
  expect(result).not.toContain("늦은IME금지");
});
