import { expect, it } from "vitest";
import { unzipSync, zipSync } from "fflate";
import {
  openArchive,
  walk,
  elements,
  serialize,
  NS,
} from "../../packages/template/src/xml";
import { renderSourceV3 } from "../helpers/template-v3";

const moduleUrl = new URL(
  "../../packages/template/src/v3/native-table-reflow.ts",
  import.meta.url,
).href;
function documentFixture(horizontal = false, converges = true) {
  const box = { x: 10, y: 10, w: 80, h: 20 };
  const run = {
    type: "TextRun",
    text: "자료",
    bbox: { x: horizontal ? 100 : 20, y: 20, w: 20, h: 20 },
  };
  const calls: Array<
    { cellIdx: number; heightDelta: number; widthDelta?: number }[]
  > = [];
  const document = {
    pageCount: () => 1,
    getPageInfo: () =>
      JSON.stringify({ width: 300, height: 300, sectionIndex: 0 }),
    getPageTextLayout: () => JSON.stringify({ runs: [] }),
    getPageRenderTree: () =>
      JSON.stringify({
        type: "Page",
        children: [
          {
            type: "Body",
            children: [
              {
                type: "Table",
                pi: 0,
                ci: 0,
                rows: 1,
                cols: 1,
                children: [
                  { type: "Cell", row: 0, col: 0, bbox: box, children: [run] },
                ],
              },
            ],
          },
        ],
      }),
    getTableDimensions: () =>
      JSON.stringify({ rowCount: 1, colCount: 1, cellCount: 1 }),
    getCellInfo: () =>
      JSON.stringify({ row: 0, col: 0, rowSpan: 1, colSpan: 1 }),
    getCellProperties: () => JSON.stringify({ verticalAlign: 1 }),
    resizeTableCells: (
      _section: number,
      _paragraph: number,
      _control: number,
      json: string,
    ) => {
      const changes = JSON.parse(json);
      calls.push(changes);
      if (converges) {
        const delta = changes[0].heightDelta / 75;
        box.h += delta;
        run.bbox.y += delta / 2;
      }
      return JSON.stringify({ ok: true });
    },
    reflowLinesegs: () => 0,
  };
  return { document, calls, box, run };
}

it("grows only native cell height for measured vertical overflow while retaining centered text flow", async () => {
  const { fitNativeTableRowsV3 } = await import(moduleUrl);
  const fixture = documentFixture();
  expect(await fitNativeTableRowsV3(fixture.document)).toBe(true);
  expect(fixture.calls).toHaveLength(1);
  expect(fixture.calls[0]![0]).toMatchObject({ cellIdx: 0 });
  expect(fixture.calls[0]![0]!.heightDelta).toBeGreaterThan(0);
  expect(fixture.calls[0]![0]!.widthDelta).toBeUndefined();
  expect(fixture.box.w).toBe(80);
  expect(fixture.run.bbox.y + fixture.run.bbox.h).toBeLessThanOrEqual(
    fixture.box.y + fixture.box.h + 0.75,
  );
});

it("rejects horizontal overflow without changing cell geometry", async () => {
  const { fitNativeTableRowsV3 } = await import(moduleUrl);
  const fixture = documentFixture(true);
  await expect(fitNativeTableRowsV3(fixture.document)).rejects.toThrow(
    "REPORT_LAYOUT_OVERFLOW",
  );
  expect(fixture.calls).toHaveLength(0);
});

it("bounds nonconverging native layout adjustment", async () => {
  const { fitNativeTableRowsV3 } = await import(moduleUrl);
  const fixture = documentFixture(false, false);
  await expect(fitNativeTableRowsV3(fixture.document)).rejects.toThrow(
    "REPORT_LAYOUT_OVERFLOW",
  );
  expect(fixture.calls.length).toBeLessThanOrEqual(4);
  expect(fixture.calls.length).toBeGreaterThan(0);
});

it("keeps HWPX protected package parts and text while applying only measured native height changes", async () => {
  const { patchNativeRowHeightsV3 } = await import(moduleUrl);
  const original = renderSourceV3("hwpx");
  const native = openArchive(original, "hwpx"),
    part = native.bodyParts[0]!;
  const table = walk(native.xml.get(part)!).find((n) => n.localName === "tbl")!;
  const cellSize = walk(table).find(
    (n) => n.namespaceURI === NS.hwpx && n.localName === "cellSz",
  )!;
  cellSize.setAttribute("height", "4000");
  elements(table)
    .find((n) => n.localName === "sz")!
    .setAttribute("height", "8000");
  native.parts[part] = serialize(native.xml.get(part)!);
  const output = await patchNativeRowHeightsV3(
    original,
    original,
    zipSync(native.parts),
  );
  const parts = unzipSync(output),
    before = unzipSync(original);
  expect(Buffer.from(parts["BinData/logo.png"]!)).toEqual(
    Buffer.from(before["BinData/logo.png"]!),
  );
  expect(Buffer.from(parts["Contents/header.xml"]!)).toEqual(
    Buffer.from(before["Contents/header.xml"]!),
  );
  const parsed = openArchive(output, "hwpx");
  expect(
    walk(parsed.xml.get(part)!)
      .find((n) => n.localName === "cellSz")!
      .getAttribute("height"),
  ).toBe("4000");
  expect(
    walk(parsed.xml.get(part)!)
      .filter((n) => n.localName === "t")
      .map((n) => n.textContent),
  ).toEqual(
    walk(openArchive(original, "hwpx").xml.get(part)!)
      .filter((n) => n.localName === "t")
      .map((n) => n.textContent),
  );
  cellSize.setAttribute("width", "20000");
  native.parts[part] = serialize(native.xml.get(part)!);
  await expect(
    patchNativeRowHeightsV3(original, original, zipSync(native.parts)),
  ).rejects.toThrow("REPORT_HWP_STRUCTURE_MISMATCH");
});
