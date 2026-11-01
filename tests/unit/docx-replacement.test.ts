import { expect, it } from "vitest";
import {
  readOoxmlPart,
  TreeDocumentStore,
  paragraphTextOf,
  serializeOoxmlPart,
  canonicalOoxmlFingerprint,
} from "@docx-editor.dev/core/store";
import { docxReplacementOps } from "../../packages/engine-docx/src/replace-text";
function fixture() {
  const parsed = readOoxmlPart(
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:rFonts w:ascii="Arial"/></w:rPr><w:t>고정</w:t></w:r><w:r><w:rPr><w:rFonts w:ascii="Noto Sans KR" w:eastAsia="Noto Sans KR"/><w:sz w:val="22"/><w:color w:val="246384"/></w:rPr><w:t>원문</w:t></w:r></w:p></w:body></w:document>',
    { name: "/word/document.xml", contentType: "application/xml" },
  );
  if (!parsed.ok) throw Error(parsed.reason);
  const paragraph = (parsed.part.root.children[0] as any).children[0];
  return { part: parsed.part, paragraphId: paragraph.id };
}
it("preserves the matched run at a style boundary for multiline/tab replacement in one undo", () => {
  const { part, paragraphId } = fixture(),
    store = new TreeDocumentStore(part),
    before = canonicalOoxmlFingerprint(part.root);
  const ops = docxReplacementOps(
    part,
    [{ blockId: paragraphId, start: 2, length: 2, text: "원문" }],
    "첫 줄\n둘째\t끝",
  );
  const result = store.transact((ctx) => {
    for (const op of ops) ctx.apply(op);
  });
  expect(result.ok).toBe(true);
  expect(store.historyDepth).toBe(1);
  expect(paragraphTextOf(store.part, paragraphId)).toBe("고정첫 줄\n둘째\t끝");
  const xml = serializeOoxmlPart(store.part);
  expect(xml).toContain(
    '<w:rFonts w:ascii="Noto Sans KR" w:eastAsia="Noto Sans KR"',
  );
  expect(xml).toContain('<w:sz w:val="22"');
  expect(xml).toContain("<w:br");
  expect(xml).toContain("<w:tab");
  const originalStyle = (part.root.children[0] as any).children[0].children[1]
    .children[0];
  const written = (
    store.part.root.children[0] as any
  ).children[0].children.filter((node: any) => node.kind === "run");
  for (const run of written) {
    const text = run.children
      .filter((node: any) => node.kind === "text")
      .flatMap((node: any) =>
        node.children.map((child: any) => child.value ?? ""),
      )
      .join("");
    if (text && text !== "고정")
      expect(
        canonicalOoxmlFingerprint(
          run.children.find((node: any) => node.kind === "runProperties"),
        ),
      ).toBe(canonicalOoxmlFingerprint(originalStyle));
  }
  store.undo();
  expect(canonicalOoxmlFingerprint(store.part.root)).toBe(before);
});
it("refuses an expired exact native span before any transaction is planned", () => {
  const { part, paragraphId } = fixture();
  expect(() =>
    docxReplacementOps(
      part,
      [{ blockId: paragraphId, start: 2, length: 2, text: "다름" }],
      "새 값",
    ),
  ).toThrow();
});
