import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Document, Packer, Paragraph } from "docx";
import { unzipSync } from "fflate";
import init, { HwpDocument } from "../../third_party/rhwp-core/rhwp.js";

const text = "보고서 검토: 선택한 문단만 설명해 주세요. ⦁ ∙ • ☞ ※ □ ○ ① Ⅰ";
const fixtures: Record<string, number[]> = {};
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
      new Document({ sections: [{ children: [new Paragraph(text)] }] }),
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
    fixtures.hwpx = Array.from(doc.exportHwpx());
  } finally {
    doc.free();
  }
});

for (const format of ["docx", "hwpx"] as const) {
  test(`${format}: read-only paragraph question preserves content, history state and storage`, async ({
    page,
  }, info) => {
    await page.goto("/harness.html?questions=test");
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
    await page
      .getByRole("button", { name: "선택 영역 질문", exact: true })
      .click();
    const composer = page.getByLabel("선택 영역 질문", { exact: true });
    await expect(composer).toContainText("보고서 검토");
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
}
