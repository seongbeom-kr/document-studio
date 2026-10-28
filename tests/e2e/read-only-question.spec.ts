import { expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Document, Packer, Paragraph } from "docx";
import { unzipSync } from "fflate";
import init, { HwpDocument } from "../../third_party/rhwp-core/rhwp.js";

const text = "Purpose: 😀éReview this exact target. ⦁ ∙ • ☞ ※ □ ○ ① Ⅰ";
const other = "A different paragraph must never be quoted by this question.";
const partial = "Review this exact target";
const fixtures: Record<string, number[]> = {};
let hwpxRuns: {
  x: number;
  y: number;
  h: number;
  charX: number[];
  charStart: number;
}[];
const archive = (bytes: number[]) =>
  Object.fromEntries(
    Object.entries(unzipSync(new Uint8Array(bytes)))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, data]) => [
        name,
        createHash("sha256").update(data).digest("hex"),
      ]),
  );

test.beforeAll(async () => {
  fixtures.docx = Array.from(
    await Packer.toBuffer(
      new Document({
        sections: [
          {
            children: [
              new Paragraph(""),
              new Paragraph(text),
              new Paragraph(other),
            ],
          },
        ],
      }),
    ),
  );
  await init({
    module_or_path: await readFile("third_party/rhwp-core/rhwp_bg.wasm"),
  });
  const doc = new HwpDocument(await readFile("fixtures/blank.hwpx"));
  try {
    const previous = doc.getParagraphLength(0, 0);
    doc.insertText(0, 0, 0, text);
    doc.deleteText(0, 0, [...text].length, previous);
    doc.splitParagraph(0, 0, 0);
    doc.insertParagraph(0, 2);
    doc.insertText(0, 2, 0, other);
    hwpxRuns = JSON.parse(doc.getPageTextLayout(0)).runs.filter(
      (run: { paraIdx: number }) => run.paraIdx === 1,
    );
    fixtures.hwpx = Array.from(doc.exportHwpx());
  } finally {
    doc.free();
  }
});

// Geometry only: selection itself is always made by the real browser pointer.
async function point(page: Page, format: "docx" | "hwpx", offset: number) {
  if (format === "hwpx") {
    const canvas = await page
      .frameLocator("iframe")
      .locator("canvas.document-page-canvas")
      .first()
      .boundingBox();
    if (!canvas) throw new Error("Missing HWPX page");
    const nativeOffset = [...text.slice(0, offset)].length;
    const run = [...hwpxRuns]
      .reverse()
      .find((run) => run.charStart <= nativeOffset)!;
    return {
      x: canvas.x + run.x + run.charX[nativeOffset - run.charStart]!,
      y: canvas.y + run.y + run.h / 2,
    };
  }
  const line = page
    .locator(".docx-line[data-paragraph-id]:visible")
    .filter({ hasText: text })
    .first();
  let painted: { x: number; y: number } | null = null;
  await expect
    .poll(async () => {
      painted = await line.evaluate((element, offset) => {
        // Embedded-font layout can replace this line between locator resolution and evaluation.
        if (!element.isConnected) return null;
        const run = [
          ...element.querySelectorAll<HTMLElement>(
            ".layout-run-text[data-start][data-end]",
          ),
        ].find((candidate) => {
          const start = Number(candidate.dataset.start),
            end = Number(candidate.dataset.end);
          return (
            start <= offset &&
            offset < end &&
            candidate.getBoundingClientRect().height > 0
          );
        });
        if (!run) return null;
        const walker = document.createTreeWalker(run, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        let remaining = offset - Number(run.dataset.start);
        while (node && remaining > (node.textContent?.length ?? 0)) {
          remaining -= node.textContent?.length ?? 0;
          node = walker.nextNode();
        }
        if (!node) return null;
        const range = document.createRange();
        range.setStart(node, remaining);
        range.setEnd(node, Math.min(remaining + 1, node.textContent!.length));
        const bounds = range.getBoundingClientRect();
        if (!bounds.height) return null;
        return { x: bounds.left, y: bounds.top + bounds.height / 2 };
      }, offset);
      return painted !== null;
    })
    .toBe(true);
  return painted!;
}

async function choose(
  page: Page,
  format: "docx" | "hwpx",
  start: number,
  end?: number,
) {
  const from = await point(page, format, start);
  await page.mouse.move(from.x, from.y);
  if (end === undefined) await page.mouse.click(from.x, from.y);
  else {
    const to = await point(page, format, end);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 12 });
    await page.mouse.up();
  }
}

for (const format of ["docx", "hwpx"] as const) {
  test(`${format}: read-only pointer click and drag after an empty first paragraph preserve content and storage`, async ({
    page,
  }, info) => {
    await page.goto("/harness.html?questions=test&noStorage=true");
    await page.waitForFunction(() => !!window.documentStudioTest);
    await page.evaluate(
      ({ bytes, format }) => {
        const host = window.documentStudioTest;
        host.readOnly = true;
        host.draftsDisabled = true;
        host.loadBytes(bytes, format);
      },
      { bytes: fixtures[format]!, format },
    );
    await expect
      .poll(() => page.evaluate(() => window.documentStudioTest.state()?.ready))
      .toBe(true);
    await expect
      .poll(() =>
        page
          .locator(".ds-editor-body")
          .evaluate((body) => (body as HTMLElement).inert),
      )
      .toBe(false);
    const observe = () =>
      page.evaluate(async () => {
        const host = window.documentStudioTest;
        const snapshot = host.state()!;
        return {
          revision: snapshot.revision,
          dirty: snapshot.dirty,
          undo: snapshot.commands.undo,
          redo: snapshot.commands.redo,
          saves: host.saves,
          draftGets: host.draftGets,
          draftStarts: host.draftStarts,
          draftWrites: host.draftWrites,
          commands: host.commandsStarted.slice(),
          bytes: await host.export(),
        };
      });
    const before = await observe();
    expect(before.dirty).toBe(false);
    expect(before.undo).toBeDefined();
    expect(before.redo).toBeDefined();
    expect(before.saves).toBe(0);
    expect(before.draftGets).toBe(0);
    expect(before.draftWrites).toBe(0);
    await choose(page, format, text.indexOf(partial) + 2);
    await info.attach("pointer-state", {
      body: JSON.stringify(
        await page.evaluate(() => ({
          state: window.documentStudioTest.state(),
          bodyInert:
            document.querySelector<HTMLElement>(".ds-editor-body")?.inert,
          surfaceInert:
            document.querySelector<HTMLElement>(".ds-docx-surface")?.inert,
          focused: document.activeElement?.outerHTML.slice(0, 500),
        })),
      ),
      contentType: "application/json",
    });
    await page
      .getByRole("button", { name: "선택 영역 질문", exact: true })
      .click();
    const composer = page.getByLabel("선택 영역 질문", { exact: true });
    await expect(composer).toContainText(text);
    await composer
      .getByLabel("선택 영역 질문 내용")
      .fill("이 문단을 쉽게 설명해 줘. 문서는 바꾸지 마.");
    await info.attach("read-only-question-selection", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
    await composer
      .getByRole("button", { name: "선택 영역 질문 보내기", exact: true })
      .click();
    await expect(composer).toHaveCount(0);
    const sent = await page.evaluate(
      () => window.documentStudioTest.questionsSent,
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]!.target.text).toBe(text);
    expect(sent[0]!.target.revision).toBe(before.revision);
    const start = text.indexOf(partial);
    await choose(page, format, start, start + partial.length);
    await page
      .getByRole("button", { name: "선택 영역 질문", exact: true })
      .click();
    await expect(composer).toContainText(partial);
    await composer
      .getByLabel("선택 영역 질문 내용")
      .fill("Explain only this selected text.");
    await composer
      .getByRole("button", { name: "선택 영역 질문 보내기", exact: true })
      .click();
    expect(
      await page.evaluate(
        () => window.documentStudioTest.questionsSent[1]!.target.text,
      ),
    ).toBe(partial);

    // A selected read-only native surface must still reject all mutation lanes.
    await choose(page, format, text.indexOf(partial) + 2);
    await page.keyboard.type("FORBIDDEN7");
    await page.keyboard.insertText("금지입력");
    await page.keyboard.press("Control+b");
    await page.keyboard.press("Backspace");
    const input =
      format === "docx"
        ? page.getByRole("textbox", { name: "Document content", exact: true })
        : page
            .frameLocator("iframe")
            .getByLabel("문서 편집 입력", { exact: true });
    await input.evaluate((element) => {
      const data = new DataTransfer();
      data.setData("text/plain", "FORBIDDEN PASTE");
      element.dispatchEvent(
        new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: data,
        }),
      );
      element.dispatchEvent(
        new InputEvent("beforeinput", {
          bubbles: true,
          cancelable: true,
          inputType: "insertFromPaste",
          data: "FORBIDDEN PASTE",
        }),
      );
      element.dispatchEvent(
        new CompositionEvent("compositionend", {
          bubbles: true,
          data: "금지조합",
        }),
      );
    });
    await expect(
      page.getByRole("button", { name: "굵게", exact: true }),
    ).toBeDisabled();
    const mutationError = await page.evaluate(async () => {
      try {
        await window.documentStudioTest.execute({
          id: "insertText",
          value: "FORBIDDEN SDK",
        });
        return null;
      } catch (error) {
        return String(error);
      }
    });
    expect(mutationError).toContain("읽기 전용");
    const replaceError = await page.evaluate(async () => {
      const api = window.documentStudioTest;
      const state = api.state()!;
      try {
        await api.agent.replace({
          documentId: state.documentId,
          expectedSessionId: state.sessionId,
          expectedRevision: state.revision,
          query: "Purpose",
          replacement: "FORBIDDEN REPLACE",
          all: true,
        });
        return null;
      } catch (error) {
        return String(error);
      }
    });
    expect(replaceError).toContain("읽기 전용");

    // Transient locks still freeze pointer interaction even in a selectable preview.
    const cursorOffset = text.indexOf(partial) + 2;
    await expect
      .poll(() =>
        page.evaluate(() => {
          const key = JSON.parse(
            window.documentStudioTest.state()!.selectionKey!,
          );
          return key.cursor?.charOffset ?? key.range?.head.offset;
        }),
      )
      .toBe(
        format === "hwpx"
          ? [...text.slice(0, cursorOffset)].length
          : cursorOffset,
      );
    await page.evaluate(() => window.documentStudioTest.acquireInputLock());
    const nativeRoot =
      format === "hwpx"
        ? page.frameLocator("iframe").locator("html")
        : page.locator(".ds-docx-surface");
    expect(
      await nativeRoot.evaluate((element) => (element as HTMLElement).inert),
    ).toBe(true);
    const selection = await page.evaluate(
      () => window.documentStudioTest.state()!.selectionKey,
    );
    await choose(page, format, 2);
    expect(
      await page.evaluate(async () => {
        await window.documentStudioTest.export();
        return window.documentStudioTest.state()!.selectionKey;
      }),
    ).toBe(selection);
    await page.evaluate(() => window.documentStudioTest.releaseInputLock());
    await choose(page, format, start, start + partial.length);
    await expect
      .poll(() =>
        page.evaluate(() => window.documentStudioTest.state()!.selectionText),
      )
      .toBe(partial);
    const after = await observe();
    const { bytes: beforeBytes, ...beforeState } = before;
    const { bytes: afterBytes, ...afterState } = after;
    expect(afterState).toEqual(beforeState);
    expect(archive(afterBytes)).toEqual(archive(beforeBytes));
    await info.attach("read-only-question-invariants", {
      body: JSON.stringify({
        before: beforeState,
        after: afterState,
        quotedTarget: sent[0]!.target,
        archiveMembers: archive(afterBytes),
      }),
      contentType: "application/json",
    });
    await info.attach("read-only-question", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  });

  test(`${format}: read-only engines without native permission support remain fully locked`, async ({
    page,
  }) => {
    await page.goto(
      "/harness.html?questions=test&noStorage=true&noNativeReadOnly=true",
    );
    await page.waitForFunction(() => !!window.documentStudioTest);
    await page.evaluate(
      ({ bytes, format }) => {
        const host = window.documentStudioTest;
        host.readOnly = true;
        host.draftsDisabled = true;
        host.loadBytes(bytes, format);
      },
      { bytes: fixtures[format]!, format },
    );
    await expect
      .poll(() => page.evaluate(() => window.documentStudioTest.state()?.ready))
      .toBe(true);
    await expect
      .poll(() =>
        page
          .locator(".ds-editor-body")
          .evaluate((body) => (body as HTMLElement).inert),
      )
      .toBe(true);
    const before = await page.evaluate(
      () => window.documentStudioTest.state()!.selectionKey,
    );
    await choose(page, format, text.indexOf(partial) + 2);
    expect(
      await page.evaluate(
        () => window.documentStudioTest.state()!.selectionKey,
      ),
    ).toBe(before);
  });

  test(`${format}: an old pending native permission cannot stall a new document session`, async ({
    page,
  }) => {
    await page.goto("/harness.html?questions=test&noStorage=true");
    await page.waitForFunction(() => !!window.documentStudioTest);
    await page.evaluate(
      ({ bytes, format }) => {
        window.documentStudioTest.draftsDisabled = true;
        window.documentStudioTest.loadBytes(bytes, format);
      },
      { bytes: fixtures[format]!, format },
    );
    await expect
      .poll(() =>
        page
          .locator(".ds-editor-body")
          .evaluate((body) => (body as HTMLElement).inert),
      )
      .toBe(false);
    const originalSession = await page.evaluate(
      () => window.documentStudioTest.state()!.sessionId,
    );
    await page.evaluate(() => {
      const host = window.documentStudioTest;
      host.pauseNextPermission = true;
      host.readOnly = true;
      host.rerender();
    });
    await page.waitForFunction(
      () => !!window.documentStudioTest.releasePausedPermission,
    );
    await expect
      .poll(() =>
        page
          .locator(".ds-editor-body")
          .evaluate((body) => (body as HTMLElement).inert),
      )
      .toBe(true);
    await page.evaluate(
      ({ bytes, format }) =>
        window.documentStudioTest.loadBytes(bytes, format, "replacement"),
      { bytes: fixtures[format]!, format },
    );
    await expect
      .poll(() =>
        page.evaluate((previous) => {
          const state = window.documentStudioTest.state();
          return state?.ready && state.sessionId !== previous;
        }, originalSession),
      )
      .toBe(true);
    await expect
      .poll(() =>
        page
          .locator(".ds-editor-body")
          .evaluate((body) => (body as HTMLElement).inert),
      )
      .toBe(false);
    await choose(page, format, text.indexOf(partial) + 2);
    await page
      .getByRole("button", { name: "선택 영역 질문", exact: true })
      .click();
    await expect(
      page.getByLabel("선택 영역 질문", { exact: true }),
    ).toContainText(text);
    await page.evaluate(() =>
      window.documentStudioTest.releasePausedPermission?.(),
    );
    await expect
      .poll(() =>
        page
          .locator(".ds-editor-body")
          .evaluate((body) => (body as HTMLElement).inert),
      )
      .toBe(false);
  });

  test(`${format}: a transition lock acquired during native permission acknowledgement stays closed`, async ({
    page,
  }) => {
    await page.goto("/harness.html?noStorage=true");
    await page.waitForFunction(() => !!window.documentStudioTest);
    await page.evaluate(
      ({ bytes, format }) => {
        const host = window.documentStudioTest;
        host.readOnly = true;
        host.draftsDisabled = true;
        host.loadBytes(bytes, format);
      },
      { bytes: fixtures[format]!, format },
    );
    await expect
      .poll(() =>
        page
          .locator(".ds-editor-body")
          .evaluate((body) => (body as HTMLElement).inert),
      )
      .toBe(false);
    await page.evaluate(() => {
      const host = window.documentStudioTest;
      host.pauseNextPermission = true;
      host.readOnly = false;
      host.rerender();
    });
    await page.waitForFunction(
      () => !!window.documentStudioTest.releasePausedPermission,
    );
    const acquiring = page.evaluate(() =>
      window.documentStudioTest.acquireInputLock(),
    );
    await page.evaluate(() =>
      window.documentStudioTest.releasePausedPermission?.(),
    );
    await acquiring;
    await expect
      .poll(() =>
        page
          .locator(".ds-editor-body")
          .evaluate((body) => (body as HTMLElement).inert),
      )
      .toBe(true);
    const selection = await page.evaluate(
      () => window.documentStudioTest.state()!.selectionKey,
    );
    await choose(page, format, text.indexOf(partial) + 2);
    await page.keyboard.insertText("FORBIDDEN DURING LOCK");
    expect(
      await page.evaluate(
        () => window.documentStudioTest.state()!.selectionKey,
      ),
    ).toBe(selection);
    expect(
      await page.evaluate(() => window.documentStudioTest.state()!.dirty),
    ).toBe(false);
    await page.evaluate(() => window.documentStudioTest.releaseInputLock());
    await expect
      .poll(() =>
        page
          .locator(".ds-editor-body")
          .evaluate((body) => (body as HTMLElement).inert),
      )
      .toBe(false);
  });

  test(`${format}: acquireInputLock resolves only after the latest native freeze acknowledgement`, async ({
    page,
  }) => {
    await page.goto("/harness.html?noStorage=true");
    await page.waitForFunction(() => !!window.documentStudioTest);
    await page.evaluate(
      ({ bytes, format }) => {
        window.documentStudioTest.draftsDisabled = true;
        window.documentStudioTest.loadBytes(bytes, format);
      },
      { bytes: fixtures[format]!, format },
    );
    await expect
      .poll(() =>
        page
          .locator(".ds-editor-body")
          .evaluate((element) => (element as HTMLElement).inert),
      )
      .toBe(false);
    await page.evaluate(() => {
      const api = window.documentStudioTest;
      api.pauseNextInputBlock = true;
      void api.acquireInputLock().then(() => {
        api.inputLockReturned = true;
      });
    });
    await page.waitForFunction(
      () => !!window.documentStudioTest.releasePausedInputBlock,
    );
    expect(
      await page.evaluate(() => window.documentStudioTest.inputLockReturned),
    ).toBe(false);
    await page.evaluate(() =>
      window.documentStudioTest.releasePausedInputBlock?.(),
    );
    await expect
      .poll(() =>
        page.evaluate(() => window.documentStudioTest.inputLockReturned),
      )
      .toBe(true);
    const nativeRoot =
      format === "hwpx"
        ? page.frameLocator("iframe").locator("html")
        : page.locator(".ds-docx-surface");
    expect(
      await nativeRoot.evaluate((element) => (element as HTMLElement).inert),
    ).toBe(true);
    await page.evaluate(() => window.documentStudioTest.releaseInputLock());
  });
}
