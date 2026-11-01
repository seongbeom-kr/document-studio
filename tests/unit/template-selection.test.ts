import { expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { unzipSync } from "fflate";
import * as template from "../../packages/template/src/index";
const ns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const bytes = zipSync({
  "[Content_Types].xml": strToU8(
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
  ),
  "word/document.xml": strToU8(
    `<w:document xmlns:w="${ns}"><w:body><w:p><w:r><w:t>중복😀</w:t></w:r></w:p><w:p><w:r><w:t>중복</w:t></w:r><w:r><w:t>😀</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p/></w:tc><w:tc><w:p/></w:tc></w:tr></w:tbl></w:body></w:document>`,
  ),
});
const path = (paragraph: number) => [
  { namespace: ns, name: "document", index: 0 },
  { namespace: ns, name: "body", index: 0 },
  { namespace: ns, name: "p", index: paragraph },
];
it("resolves the second identical paragraph by XML address, including split runs", async () => {
  expect(template.createTemplateSelectionBridge).toBeTypeOf("function");
  const bridge = await template.createTemplateSelectionBridge({
    documentId: "doc",
    bytes,
    format: "docx",
    structureRevision: 1,
  });
  const selected = bridge.resolve({
    sourceHash: bridge.identity.normalizedHash,
    address: { format: "docx", part: "word/document.xml", path: path(1) },
    text: "중복😀",
    start: 2,
    end: 4,
  });
  expect(selected.targetId).toBe(bridge.structure.targets[1]!.id);
  expect(selected).toMatchObject({
    documentId: "doc",
    structureRevision: 1,
    start: 2,
    end: 4,
  });
  expect(bridge.locate(selected)).toMatchObject({
    address: { path: path(1) },
    start: 2,
    end: 4,
  });
});
it("distinguishes empty cells without searching text and survives a new bridge", async () => {
  const bridge = await template.createTemplateSelectionBridge({
    documentId: "doc",
    bytes,
    format: "docx",
    structureRevision: 1,
  });
  const target = {
    ...bridge.identity,
    targetId: bridge.structure.targets[3]!.id,
  };
  const location = bridge.locate(target);
  expect(location.address).toMatchObject({
    path: [
      path(0)[0],
      path(0)[1],
      { namespace: ns, name: "tbl", index: 0 },
      { namespace: ns, name: "tr", index: 0 },
      { namespace: ns, name: "tc", index: 1 },
      { namespace: ns, name: "p", index: 0 },
    ],
  });
  const reopened = await template.createTemplateSelectionBridge({
    documentId: "doc",
    bytes,
    format: "docx",
    structureRevision: 1,
  });
  expect(reopened.resolve(location)).toEqual(target);
});
it("rejects stale identities, wrong native text, and split graphemes before highlighting", async () => {
  const bridge = await template.createTemplateSelectionBridge({
    documentId: "doc",
    bytes,
    format: "docx",
    structureRevision: 1,
  });
  const target = {
    ...bridge.identity,
    targetId: bridge.structure.targets[1]!.id,
  };
  for (const key of [
    "documentId",
    "sourceHash",
    "normalizedHash",
    "structureRevision",
  ] as const)
    expect(() => bridge.locate({ ...target, [key]: "stale" })).toThrow(
      "TEMPLATE_SELECTION_STALE",
    );
  expect(() =>
    bridge.resolve({
      sourceHash: bridge.identity.normalizedHash,
      address: { format: "docx", part: "word/document.xml", path: path(1) },
      text: "wrong",
    }),
  ).toThrow("TEMPLATE_SELECTION_PROVENANCE");
  expect(() => bridge.locate({ ...target, start: 2, end: 3 })).toThrow(
    "TEMPLATE_SELECTION_RANGE",
  );
});
it("rejects a range splitting a combining grapheme at its exact source location", async () => {
  const parts = unzipSync(bytes);
  parts["word/document.xml"] = strToU8(
    `<w:document xmlns:w="${ns}"><w:body><w:p><w:r><w:t>가😀e\u0301나</w:t></w:r></w:p></w:body></w:document>`,
  );
  const bridge = await template.createTemplateSelectionBridge({
    documentId: "doc",
    bytes: zipSync(parts),
    format: "docx",
    structureRevision: 1,
  });
  const target = {
    ...bridge.identity,
    targetId: bridge.structure.targets[0]!.id,
  };
  expect(() => bridge.locate({ ...target, start: 3, end: 4 })).toThrow(
    "TEMPLATE_SELECTION_RANGE",
  );
  expect(bridge.locate({ ...target, start: 5, end: 6 })).toMatchObject({
    text: "가😀e\u0301나",
    start: 5,
    end: 6,
  });
});
