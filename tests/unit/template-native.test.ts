import { beforeAll, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import init, { HwpDocument } from "../../third_party/rhwp-core/rhwp.js";
import {
  inspectTemplate,
  createTemplateSelectionBridge,
  renderTemplate,
  verifyTemplateOutput,
  type TemplateDefinition,
} from "../../packages/template/src/index";
beforeAll(async () => {
  await init({
    module_or_path: await readFile(
      new URL("../../third_party/rhwp-core/rhwp_bg.wasm", import.meta.url),
    ),
  });
});
it("maps native HWPX source positions for duplicate and empty cells, including normalized HWP", async () => {
  const original = HwpDocument.createEmpty();
  original.createBlankDocument();
  original.insertText(0, 0, 0, "원본 😀");
  const table = JSON.parse(original.createTable(0, 0, 0, 2, 2));
  const parent = table.paraIdx,
    control = table.controlIdx ?? table.controlIndex ?? 0;
  original.insertTextInCell(0, parent, control, 0, 0, 0, "반복😀");
  original.insertTextInCell(0, parent, control, 1, 0, 0, "반복😀");
  const source = original.exportHwpx();
  original.free();
  const bridge = await createTemplateSelectionBridge({
    documentId: "normalized-hwp",
    bytes: source,
    format: "hwpx",
    structureRevision: 1,
    sourceHash: "sha256:" + "a".repeat(64),
  });
  const reopened = new HwpDocument(source);
  try {
    const cells = bridge.structure.targets.filter((t) => t.rowId);
    expect(cells).toHaveLength(4);
    for (let cell = 0; cell < 4; cell++) {
      const selected = { ...bridge.identity, targetId: cells[cell]!.id };
      const location = bridge.locate(selected);
      expect(location.address).toEqual({
        format: "hwpx",
        section: 0,
        paragraph: parent,
        control,
        cell,
        cellParagraph: 0,
      });
      expect(reopened.getTextInCell(0, parent, control, cell, 0, 0, 100)).toBe(
        location.text,
      );
      expect(bridge.resolve(location)).toEqual(selected);
    }
    expect(bridge.identity.sourceHash).not.toBe(bridge.identity.normalizedHash);
  } finally {
    reopened.free();
  }
});
it("maps the verified HWPX working copy after an actual native HWP conversion", async () => {
  const native = HwpDocument.createEmpty();
  let hwp: Uint8Array;
  try {
    native.createBlankDocument();
    native.insertText(0, 0, 0, "HWP 원본");
    const t = JSON.parse(native.createTable(0, 0, 0, 1, 2));
    for (let cell = 0; cell < 2; cell++)
      native.insertTextInCell(
        0,
        t.paraIdx,
        t.controlIdx ?? t.controlIndex ?? 0,
        cell,
        0,
        0,
        "중복😀",
      );
    hwp = native.exportHwp();
  } finally {
    native.free();
  }
  const converted = new HwpDocument(hwp);
  let bytes: Uint8Array;
  try {
    bytes = converted.exportHwpx();
  } finally {
    converted.free();
  }
  const sourceHash = "sha256:" + createHash("sha256").update(hwp).digest("hex");
  const bridge = await createTemplateSelectionBridge({
    documentId: "converted-hwp",
    bytes,
    format: "hwpx",
    sourceHash,
    structureRevision: 1,
  });
  const target = bridge.structure.targets.filter((t) => t.rowId)[1]!;
  const selection = {
    ...bridge.identity,
    targetId: target.id,
    start: 2,
    end: 4,
  };
  const location = bridge.locate(selection),
    address = location.address;
  expect(address).toMatchObject({ format: "hwpx", cell: 1, cellParagraph: 0 });
  const reopened = new HwpDocument(bytes);
  try {
    if (address.format !== "hwpx") throw Error("wrong format");
    expect(
      reopened.getTextInCell(
        address.section,
        address.paragraph,
        address.control!,
        address.cell!,
        address.cellParagraph!,
        0,
        100,
      ),
    ).toBe("중복😀");
    expect(bridge.resolve(location)).toEqual(selection);
    expect(createHash("sha256").update(hwp).digest("hex")).toBe(
      sourceHash.slice(7),
    );
  } finally {
    reopened.free();
  }
});
it("can map ordinary text alongside native HWPX section and column properties", async () => {
  const native = HwpDocument.createEmpty();
  let source: Uint8Array;
  try {
    native.createBlankDocument();
    native.insertText(0, 0, 0, "고정 제목 · 작성할 내용");
    source = native.exportHwpx();
  } finally {
    native.free();
  }
  const s = await inspectTemplate({ bytes: source, format: "hwpx" }),
    target = s.targets.find((t) => t.text === "고정 제목 · 작성할 내용")!;
  expect(target.editable).toBe(true);
  const definition: TemplateDefinition = {
    schemaVersion: 2,
    sourceHash: s.sourceHash,
    format: "hwpx",
    fields: [{ id: "body", label: "내용", type: "string", required: true }],
    bindings: [
      {
        id: "slot",
        targetId: target.id,
        fieldId: "body",
        start: 8,
        end: target.text.length,
      },
    ],
    repeatGroups: [],
    rules: [],
    output: {},
  };
  const input = { body: "새로운 내용" },
    result = await renderTemplate({
      bytes: source,
      format: "hwpx",
      definition,
      input,
    });
  expect(
    await verifyTemplateOutput({
      source,
      output: result.bytes,
      format: "hwpx",
      definition,
      input,
    }),
  ).toEqual({ structurePreserved: true });
});
it("reopens a real engine-created HWPX with repeated data and preserved header cells", async () => {
  const native = HwpDocument.createEmpty();
  let bytes: Uint8Array, location: { paraIdx: number; controlIdx: number };
  try {
    native.createBlankDocument();
    native.insertText(0, 0, 0, "새로운 임의 양식");
    const table = JSON.parse(native.createTable(0, 0, 0, 2, 2));
    expect(table.ok).toBe(true);
    location = {
      paraIdx: table.paraIdx,
      controlIdx: table.controlIdx ?? table.controlIndex ?? 0,
    };
    for (const [i, text] of ["항목", "금액", "기준 행", "0"].entries())
      native.insertTextInCell(
        0,
        location.paraIdx,
        location.controlIdx,
        i,
        0,
        0,
        text,
      );
    bytes = native.exportHwpx();
  } finally {
    native.free();
  }
  const structure = await inspectTemplate({ bytes, format: "hwpx" }),
    row = structure.rows[1]!;
  expect(row.repeatable).toBe(true);
  const definition: TemplateDefinition = {
    schemaVersion: 2,
    sourceHash: structure.sourceHash,
    format: "hwpx",
    fields: [
      {
        id: "lines",
        label: "내역",
        type: "array",
        required: true,
        itemFields: [
          { id: "name", label: "항목", type: "string", required: true },
          { id: "amount", label: "금액", type: "decimal", required: true },
        ],
      },
    ],
    bindings: [],
    repeatGroups: [
      {
        id: "repeat",
        rowId: row.id,
        fieldId: "lines",
        maxRows: 10,
        empty: "remove",
        bindings: [
          { id: "name_slot", targetId: row.targetIds[0]!, fieldId: "name" },
          { id: "amount_slot", targetId: row.targetIds[1]!, fieldId: "amount" },
        ],
      },
    ],
    rules: [],
    output: {},
  };
  const input = {
    lines: [
      { name: "첫 항목", amount: "10.00" },
      { name: "다음 항목", amount: "20.00" },
    ],
  };
  const output = await renderTemplate({
    bytes,
    format: "hwpx",
    definition,
    input,
  });
  expect(
    await verifyTemplateOutput({
      source: bytes,
      output: output.bytes,
      format: "hwpx",
      definition,
      input,
    }),
  ).toEqual({ structurePreserved: true });
  const reopened = new HwpDocument(output.bytes);
  try {
    const dimensions = JSON.parse(
      reopened.getTableDimensions(0, location!.paraIdx, location!.controlIdx),
    );
    expect(dimensions.rowCount ?? dimensions.rows).toBe(3);
    expect(
      reopened.getTextInCell(
        0,
        location!.paraIdx,
        location!.controlIdx,
        0,
        0,
        0,
        100,
      ),
    ).toContain("항목");
    expect(
      reopened.getTextInCell(
        0,
        location!.paraIdx,
        location!.controlIdx,
        2,
        0,
        0,
        100,
      ),
    ).toContain("첫 항목");
    expect(
      reopened.getTextInCell(
        0,
        location!.paraIdx,
        location!.controlIdx,
        4,
        0,
        0,
        100,
      ),
    ).toContain("다음 항목");
  } finally {
    reopened.free();
  }
});
