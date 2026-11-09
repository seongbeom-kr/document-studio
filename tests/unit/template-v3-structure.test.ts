import { expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { createHash } from "node:crypto";
import * as template from "../../packages/template/src/index";

const ns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const hash = (bytes: Uint8Array) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}` as const;
export function sourceV3(extra = "") {
  return zipSync({
    "[Content_Types].xml": strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    ),
    "word/document.xml": strToU8(
      `<w:document xmlns:w="${ns}"><w:body><w:p><w:pPr><w:pStyle w:val="Body"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="22"/></w:rPr><w:t>고정: </w:t></w:r><w:r><w:t>반복😀</w:t></w:r></w:p><w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid><w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>반복😀</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>반복😀</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc><w:tc><w:p/></w:tc></w:tr></w:tbl>${extra}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:bottom="1440" w:left="1440" w:right="1440"/></w:sectPr></w:body></w:document>`,
    ),
    "word/styles.xml": strToU8(
      `<w:styles xmlns:w="${ns}"><w:style w:styleId="Body"><w:rPr><w:rFonts w:ascii="Arial"/><w:sz w:val="22"/></w:rPr></w:style></w:styles>`,
    ),
    "word/media/logo.png": new Uint8Array([1, 2, 3]),
  });
}
async function inspect(bytes = sourceV3()) {
  return template.inspectTemplateV3({
    bytes,
    format: "docx",
    identity: {
      sourceHash: hash(bytes),
      normalizedHash: hash(bytes),
      structureRevision: 1,
    },
  });
}
it("extracts exact source addresses, merged grid, styles and page without modifying bytes", async () => {
  const bytes = sourceV3(),
    before = hash(bytes),
    s = await inspect(bytes);
  expect(() => template.validateContractV3("structure", s)).not.toThrow();
  expect(hash(bytes)).toBe(before);
  expect(s.page).toEqual({
    width: 11906,
    height: 16838,
    marginTop: 1440,
    marginBottom: 1440,
    marginLeft: 1440,
    marginRight: 1440,
    orientation: "portrait",
  });
  const table = s.regions.find((r) => r.kind === "table")!;
  expect(table.table!.rows[0]!.cells[0]).toMatchObject({
    row: 0,
    column: 0,
    rowSpan: 2,
    columnSpan: 1,
    text: "반복😀",
  });
  expect(table.table!.rows[1]!.cells).toHaveLength(1);
  expect(table.table!.headerRows).toBe(1);
  expect(table.capabilities).toMatchObject({
    rowChanges: true,
    columnChanges: true,
    merges: true,
  });
  expect(
    s.styles.some((style) =>
      Object.values(style.properties).some((v) => v.includes("22")),
    ),
  ).toBe(true);
  expect(s.regions[0]!.textRuns).toMatchObject([
    { start: 0, end: 4 },
    { start: 4, end: 8 },
  ]);
  expect(s.protectedParts["word/styles.xml"]).toMatch(/^sha256:/);
  expect(s.protectedParts["word/media/logo.png"]).toBe(
    hash(new Uint8Array([1, 2, 3])),
  );
  expect(await inspect(bytes)).toEqual(s);
});
it("keeps_duplicate_cell_addresses_distinct and source selection roundtrips", async () => {
  const bytes = sourceV3(),
    structure = await inspect(bytes);
  const bridge = await template.createTemplateSelectionBridgeV3({
    documentId: "doc",
    bytes,
    structure,
  });
  const duplicates = structure.regions.filter(
    (r) => r.kind === "text" && r.text === "반복😀",
  );
  expect(duplicates).toHaveLength(2);
  expect(duplicates[0]!.id).not.toBe(duplicates[1]!.id);
  const locations = duplicates.map((r) =>
    bridge.locate({ ...bridge.identity, targetId: r.id, start: 2, end: 4 }),
  );
  expect(locations[0]!.address).not.toEqual(locations[1]!.address);
  for (const location of locations)
    expect(bridge.locate(bridge.resolve(location))).toEqual(location);
  expect(bridge.structure.identity).toEqual(structure.identity);
  const empty = structure.regions.filter((r) => r.kind === "text" && !r.text);
  expect(empty[0]!.id).not.toBe(empty[1]!.id);
});
it("rejects stale source identities, changed structure and unsupported selections", async () => {
  const bytes = sourceV3(),
    structure = await inspect(bytes);
  await expect(
    template.inspectTemplateV3({
      bytes,
      format: "docx",
      identity: {
        ...structure.identity,
        normalizedHash: `sha256:${"f".repeat(64)}`,
      },
    }),
  ).rejects.toThrow("TEMPLATE_SELECTION_STALE");
  await expect(
    template.createTemplateSelectionBridgeV3({
      documentId: "doc",
      bytes,
      structure: { ...structure, page: { ...structure.page, width: 1 } },
    }),
  ).rejects.toThrow("TEMPLATE_SELECTION_STALE");
  const bridge = await template.createTemplateSelectionBridgeV3({
    documentId: "doc",
    bytes,
    structure,
  });
  expect(() =>
    bridge.locate({
      ...bridge.identity,
      targetId: structure.regions[0]!.id,
      structureRevision: 2,
    }),
  ).toThrow("TEMPLATE_SELECTION_STALE");
});
it("limits dynamic capabilities locally for nested tables and fixed graphics", async () => {
  const s = await inspect(
    sourceV3(
      "<w:tbl><w:tr><w:tc><w:p><w:r><w:drawing/></w:r></w:p><w:tbl><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl></w:tc></w:tr></w:tbl>",
    ),
  );
  const tables = s.regions.filter((r) => r.kind === "table");
  expect(tables[0]!.editable).toBe(true);
  for (const table of tables.slice(1)) {
    expect(table.capabilities.rowChanges).toBe(false);
    expect(table.reason).toBeTruthy();
  }
});
it("uses bounded source IDs for deep source paths", async () => {
  const s = await inspect(
    sourceV3("<w:custom>".repeat(35) + "<w:p/>" + "</w:custom>".repeat(35)),
  );
  expect(s.regions.every((r) => r.id.length <= 80)).toBe(true);
});
