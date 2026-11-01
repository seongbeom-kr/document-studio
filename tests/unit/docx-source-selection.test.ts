import { expect, it } from "vitest";
import { readOoxmlPart } from "@docx-editor.dev/core/store";
import * as mapping from "../../packages/engine-docx/src/source-selection";
it("retains source XML sibling identity for repeated paragraphs and empty table cells", () => {
  const parsed = readOoxmlPart(
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>동일</w:t></w:r></w:p><w:p><w:r><w:t>동일</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p/></w:tc><w:tc><w:p/></w:tc></w:tr></w:tbl></w:body></w:document>',
    { name: "/word/document.xml", contentType: "application/xml" },
  );
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  const index = mapping.docxSourceIndex(parsed.part);
  expect(index).toHaveLength(4);
  expect(new Set(index.map((p) => p.nodeId)).size).toBe(4);
  expect(index[1]!.address.path.at(-1)!.index).toBe(1);
  expect(index[3]!.address.path.at(-2)).toMatchObject({ name: "tc", index: 1 });
  expect(index.map((p) => p.text)).toEqual(["동일", "동일", "", ""]);
});
