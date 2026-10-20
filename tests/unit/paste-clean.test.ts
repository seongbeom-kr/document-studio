import { expect, it } from "vitest";
import { previewPasteCleanup, quickActionPlan } from "@document-studio/core";
it("previews artifacts without removing numbered references or ordinary brackets", () => {
  const before = "제목\u200b 【4:0†source】\n\\*\\*강조\\*\\* [1] 【붙임】";
  expect(previewPasteCleanup(before)).toMatchObject({
    before,
    after: "제목\n**강조** [1] 【붙임】",
    removed: 3,
    changes: [{ line: 1 }, { line: 2 }],
  });
});
it.each([
  "👩‍💻 می\u200cروم 가\u2060나 A\u00a0B",
  "\\*\\*\\*\\*\\*\\*",
  "\\*기호",
  "```ts\n\u200b 【a†b】\n```",
  "````\n```\n\u200b\n````",
  "~~~\n```js\n\u200b\n~~~",
  "`\u200b` 코드",
  "    \u200b",
  "\t\u200b",
  "【" + "a".repeat(9000) + "†",
])("preserves protected text and malformed citations %s", (text) => {
  expect(previewPasteCleanup(text).after).toBe(text);
});
it("closes only a matching fence of sufficient length without trailing text", () => {
  const text = "````\n``` nope\n\u200b\n````\n제목\u200b";
  expect(previewPasteCleanup(text).after).toBe(
    "````\n``` nope\n\u200b\n````\n제목",
  );
});
it("keeps CRLF and rejects oversized inputs and an empty insertion plan", () => {
  expect(previewPasteCleanup("제목\u200b\r\n본문").after).toBe("제목\r\n본문");
  expect(() => previewPasteCleanup("x".repeat(10001))).toThrow();
  expect(() =>
    quickActionPlan({ kind: "cleanPaste", text: "\u200b" }),
  ).toThrow();
  expect(
    quickActionPlan({ kind: "cleanPaste", text: "제목\u200b" }),
  ).toMatchObject({
    commands: [{ id: "insertText", value: "제목" }],
    cleanup: { removed: 1 },
  });
});
