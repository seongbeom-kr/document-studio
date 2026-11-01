import { expect, test } from "@playwright/test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Document, Packer, Paragraph, TextRun } from "docx";
import { unzipSync, strFromU8 } from "fflate";
import {
  readOoxmlPart,
  storyParagraphs,
  paragraphTextOf,
  canonicalOoxmlFingerprint,
  type OoxmlNode,
} from "@docx-editor.dev/core/store";
const oldText = "치환할 문장";
const children = (n: OoxmlNode) => ("children" in n ? n.children : []);
function inspect(bytes: Uint8Array) {
  const parsed = readOoxmlPart(
    strFromU8(unzipSync(bytes)["word/document.xml"]!),
    { name: "/word/document.xml", contentType: "application/xml" },
  );
  if (!parsed.ok) throw Error(parsed.reason);
  const body = children(parsed.part.root).find((n) => n.kind === "body")!;
  return storyParagraphs(body).map((p) => ({
    text: paragraphTextOf(parsed.part, p.id),
    styles: children(p)
      .filter(
        (r) =>
          r.kind === "run" &&
          children(r).some(
            (n) =>
              n.kind === "text" &&
              children(n).some((t) => t.kind === "textValue" && t.value.length),
          ),
      )
      .map((r) => {
        const props = children(r).find((n) => n.kind === "runProperties");
        return props ? canonicalOoxmlFingerprint(props) : null;
      }),
  }));
}
for (const scenario of [
  { name: "single", all: false, replacement: "교체한 목적 문장" },
  { name: "all", all: true, replacement: "교체한 목적 문장" },
  { name: "multiline", all: false, replacement: "교체한 첫 줄\n둘째 줄" },
])
  test(`DOCX ${scenario.name} search replacement retains the matched character formatting and one undo`, async ({
    page,
  }) => {
    const styled = (text: string) =>
      new TextRun({
        text,
        font: "Noto Sans KR",
        size: 22,
        color: "246384",
        italics: true,
      });
    const bytes = await Packer.toBuffer(
      new Document({
        sections: [
          {
            children: [
              new Paragraph({
                children: [
                  new TextRun({ text: "고정 제목", bold: true, size: 36 }),
                ],
              }),
              new Paragraph({ children: [styled(oldText)] }),
              new Paragraph({
                children: [
                  styled(oldText.slice(0, 3)),
                  styled(oldText.slice(3)),
                ],
              }),
              new Paragraph({
                children: [
                  new TextRun({ text: "고정 꼬리", font: "Arial", size: 18 }),
                ],
              }),
            ],
          },
        ],
      }),
    );
    const before = inspect(bytes);
    expect(before).toHaveLength(4);
    await page.goto("/harness.html");
    await page.waitForFunction(() => Boolean(window.documentStudioTest));
    await page.evaluate(
      (data) =>
        window.documentStudioTest.loadBytes(data, "docx", "format-replace"),
      Array.from(bytes),
    );
    await expect
      .poll(() => page.evaluate(() => window.documentStudioTest.state()?.ready))
      .toBe(true);
    const result = await page.evaluate(
      async ({ oldText, scenario }) => {
        const api = window.documentStudioTest,
          a = api.agent,
          state = a.getState();
        const found = await a.search({
          documentId: state.documentId,
          query: oldText,
        });
        await a.select({
          documentId: state.documentId,
          expectedSessionId: state.sessionId,
          expectedRevision: found.revision,
          matchId: found.matches[1]!.id,
        });
        const receipt = await a.replace({
          documentId: state.documentId,
          expectedSessionId: state.sessionId,
          expectedRevision: found.revision,
          replacement: scenario.replacement,
          ...(scenario.all
            ? { all: true, query: oldText }
            : { matchId: found.matches[1]!.id }),
        });
        const after = await api.export();
        await api.execute({ id: "undo" });
        return { receipt, after, undone: await api.export() };
      },
      { oldText, scenario },
    );
    const after = inspect(new Uint8Array(result.after));
    expect(result.receipt.count).toBe(scenario.all ? 2 : 1);
    expect(after[0]).toEqual(before[0]);
    expect(after.at(-1)).toEqual(before.at(-1));
    if (!scenario.all) expect(after[1]).toEqual(before[1]);
    const changed =
      scenario.name === "multiline"
        ? after.slice(2, -1)
        : after.filter((p) => p.text === scenario.replacement);
    if (scenario.name === "multiline")
      expect(changed.map((p) => p.text).join("\n")).toBe(scenario.replacement);
    else expect(changed).toHaveLength(scenario.all ? 2 : 1);
    for (const paragraph of changed)
      expect(new Set(paragraph.styles)).toEqual(new Set(before[2]!.styles));
    expect(inspect(new Uint8Array(result.undone))).toEqual(before);
  });
test("DOCX supplied QA paragraph replacement preserves all target and non-target formatting", async ({
  page,
}, testInfo) => {
  const sourcePath = process.env.DOCUMENT_STUDIO_REPLACEMENT_QA_FILE;
  test.skip(
    !sourcePath,
    "Optional private QA copy is supplied explicitly by the operator.",
  );
  const bytes = await readFile(sourcePath!),
    before = inspect(bytes),
    index = Number(process.env.DOCUMENT_STUDIO_REPLACEMENT_QA_INDEX ?? 11),
    query = before[index]!.text!;
  expect(query.length).toBeGreaterThan(0);
  await page.goto("/harness.html");
  await page.waitForFunction(() => Boolean(window.documentStudioTest));
  await page.evaluate(
    (data) =>
      window.documentStudioTest.loadBytes(data, "docx", "private-qa-replace"),
    Array.from(bytes),
  );
  await expect
    .poll(() => page.evaluate(() => window.documentStudioTest.state()?.ready))
    .toBe(true);
  const replacement =
    "합성 검증: 사전 점검 결과와 후속 보수 계획을 확인합니다.";
  const result = await page.evaluate(
    async ({ query, replacement }) => {
      const api = window.documentStudioTest,
        a = api.agent,
        state = a.getState(),
        found = await a.search({ documentId: state.documentId, query });
      if (found.matches.length !== 1) throw Error("QA target is ambiguous");
      await a.select({
        documentId: state.documentId,
        expectedSessionId: state.sessionId,
        expectedRevision: found.revision,
        matchId: found.matches[0]!.id,
      });
      await a.replace({
        documentId: state.documentId,
        expectedSessionId: state.sessionId,
        expectedRevision: found.revision,
        matchId: found.matches[0]!.id,
        replacement,
      });
      const after = await api.export();
      await api.execute({ id: "undo" });
      return { after, undone: await api.export() };
    },
    { query, replacement },
  );
  const after = inspect(new Uint8Array(result.after));
  expect(after).toHaveLength(before.length);
  expect(after[index]!.text).toBe(replacement);
  expect(new Set(after[index]!.styles)).toEqual(new Set(before[index]!.styles));
  for (let i = 0; i < before.length; i++)
    if (i !== index) expect(after[i]).toEqual(before[i]);
  expect(inspect(new Uint8Array(result.undone))).toEqual(before);
  const sourceHash = createHash("sha256").update(bytes).digest("hex");
  expect(
    createHash("sha256")
      .update(await readFile(sourcePath!))
      .digest("hex"),
  ).toBe(sourceHash);
  const evidence = new URL(
    "../../.build/docx-replacement-proof/",
    import.meta.url,
  );
  await mkdir(evidence, { recursive: true });
  await writeFile(
    new URL(`qa-${testInfo.project.name}-after.docx`, evidence),
    new Uint8Array(result.after),
  );
  await writeFile(
    new URL(`qa-${testInfo.project.name}.json`, evidence),
    JSON.stringify(
      {
        passed: true,
        sourceHash,
        targetIndex: index,
        targetFormattingPreserved: true,
        nonTargetParagraphsPreserved: before.length - 1,
        oneUndoRestored: true,
        completedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
});
