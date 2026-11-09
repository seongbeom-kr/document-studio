import { beforeAll, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import init, { HwpDocument } from "../../third_party/rhwp-core/rhwp.js";
import { renderScenarioV3, hashV3 } from "../helpers/template-v3";
import { renderTemplateV3, digestV3 } from "../../packages/template/src/index";
import { unzipSync, zipSync } from "fflate";
import {
  openArchive,
  walk,
  elements,
  serialize,
} from "../../packages/template/src/xml";
import { nativeScenarioV3 } from "../helpers/template-v3-native";
import { verifiedHwpBytesV3 } from "../../packages/template/src/v3/hwp";
let api: typeof import("../../packages/template/src/node");
beforeAll(async () => {
  const url = new URL("../../packages/template/dist/node.js", import.meta.url);
  expect(existsSync(url), "missing headless final export").toBe(true);
  api = await import(url.href);
  await init({
    module_or_path: await readFile(
      new URL("../../third_party/rhwp-core/rhwp_bg.wasm", import.meta.url),
    ),
  });
});
it("exports_real_verified_hwp and compares reopened native grid, all pages and protected styles", async () => {
  const scenario = await nativeScenarioV3(),
    working = await renderTemplateV3(scenario),
    profile = await api.nativeRuntimeProfileV3();
  const final = await api.exportFinalDocumentV3({
    working,
    outputFormat: "hwp",
    definition: scenario.definition,
    validatedPlan: scenario.validatedPlan,
    runtimeProfile: profile,
  });
  expect([...final.bytes.slice(0, 8)]).toEqual([
    208, 207, 17, 224, 161, 177, 26, 225,
  ]);
  expect(final.proof.contentLoss.count).toBe(0);
  expect(final.digest).toBe(hashV3(final.bytes));
  expect(final.byteLength).toBe(final.bytes.length);
  expect(final.proof.pageCountAfter).toBe(final.proof.pageCountBefore);
  expect(final.proof.gridPreserved).toBe(true);
  expect(final.proof.protectedStylesPreserved).toBe(true);
  expect(final.proof.pageCountAfter).toBeGreaterThan(1);
  expect(final.previews).toHaveLength(final.proof.pageCountAfter);
  expect(final.previews.every((page) => page.svg.includes("<svg"))).toBe(true);
  const reopened = new HwpDocument(final.bytes);
  try {
    const grid = JSON.parse(reopened.getTableDimensions(0, 3, 0));
    expect(grid.rowCount ?? grid.rows).toBe(30);
    expect(grid.colCount ?? grid.cols).toBe(4);
  } finally {
    reopened.free();
  }
}, 60000);
it("preserves HWP5 layout lineage on roundtrip while marking genuine HWPX sources", async () => {
  const scenario = await nativeScenarioV3();
  const runtime = await api.loadNativeRuntime(
    await api.nativeRuntimeProfileV3(),
  );
  for (const hwp5Origin of [true, false]) {
    const parts = unzipSync(scenario.bytes);
    if (hwp5Origin) parts["META-INF/rhwp-hwp5-origin"] = Uint8Array.of(49);
    else delete parts["META-INF/rhwp-hwp5-origin"];
    const document = new runtime.HwpDocument(zipSync(parts));
    try {
      const exported = document.exportHwpWithReport();
      try {
        expect(JSON.parse(exported.contentLoss()).count).toBe(0);
        const bytes = Buffer.from(exported.takeBytes());
        // This synthetic document never contains the reserved name as body text.
        expect(bytes.includes(Buffer.from("RhwpHwpxOrigin\0", "utf16le"))).toBe(
          !hwp5Origin,
        );
      } finally {
        exported.free();
      }
    } finally {
      document.free();
    }
  }
}, 60000);
for (const outputFormat of ["hwp", "hwpx"] as const)
  it(`${outputFormat}: rejects horizontal glyph clipping from large fonts and paragraph indents`, async () => {
    const native = await nativeScenarioV3(),
      archive = openArchive(native.bytes, "hwpx"),
      part = archive.bodyParts[0]!;
    const prototype = walk(archive.xml.get(part)!).find(
      (n) => n.localName === "tbl",
    )!;
    const header = archive.xml.get("Contents/header.xml")!;
    const charShapes = walk(header).filter((n) => n.localName === "charPr"),
      paragraphShapes = walk(header).filter((n) => n.localName === "paraPr");
    const character = charShapes[0]!.cloneNode(
      true,
    ) as (typeof charShapes)[number];
    character.setAttribute("id", String(charShapes.length));
    character.setAttribute("height", "2700");
    charShapes[0]!.parentNode!.appendChild(character);
    (character.parentNode as typeof character).setAttribute(
      "itemCnt",
      String(charShapes.length + 1),
    );
    const paragraph = paragraphShapes[0]!.cloneNode(
      true,
    ) as (typeof paragraphShapes)[number];
    paragraph.setAttribute("id", String(paragraphShapes.length));
    walk(paragraph)
      .find((n) => n.localName === "left")!
      .setAttribute("value", "3000");
    paragraphShapes[0]!.parentNode!.appendChild(paragraph);
    (paragraph.parentNode as typeof paragraph).setAttribute(
      "itemCnt",
      String(paragraphShapes.length + 1),
    );
    for (const node of walk(prototype)) {
      if (node.localName === "run")
        node.setAttribute("charPrIDRef", String(charShapes.length));
      if (node.localName === "p")
        node.setAttribute("paraPrIDRef", String(paragraphShapes.length));
    }
    for (const size of walk(prototype).filter((n) => n.localName === "cellSz"))
      size.setAttribute("height", "3000");
    elements(prototype)
      .find((n) => n.localName === "sz")!
      .setAttribute("height", "9000");
    archive.parts[part] = serialize(archive.xml.get(part)!);
    archive.parts["Contents/header.xml"] = serialize(header);
    const scenario = await renderScenarioV3(
      "hwpx",
      undefined,
      zipSync(archive.parts),
    );
    const table = scenario.validatedPlan.plan.regions[0]!;
    if (table.kind !== "table") throw new Error("table expected");
    table.rows = table.rows.slice(0, 3);
    for (const row of table.rows)
      for (const cell of row.cells) cell.text = "확인";
    table.rows[2]!.cells[2]!.text = "자료 확인 결과 보고";
    scenario.validatedPlan.planDigest = await digestV3(
      scenario.validatedPlan.plan,
    );
    const working = await renderTemplateV3(scenario);
    await expect(
      api.exportFinalDocumentV3({
        working,
        outputFormat,
        definition: scenario.definition,
        validatedPlan: scenario.validatedPlan,
        runtimeProfile: await api.nativeRuntimeProfileV3(),
      }),
    ).rejects.toThrow("REPORT_LAYOUT_OVERFLOW");
  }, 60000);
for (const reason of ["loss", "bytes", "reopen"] as const)
  it(`rejects ${reason} without returning a successful final file`, () => {
    let freed = false,
      exported = false;
    const document = {
      exportHwpVerify: () =>
        JSON.stringify({
          recovered: reason !== "reopen",
          bytesLen: 100,
          pageCountBefore: 2,
          pageCountAfter: 2,
        }),
      exportHwpWithReport: () => {
        exported = true;
        return {
          contentLoss: () =>
            JSON.stringify({
              schemaVersion: 1,
              outputFormat: "hwp",
              count: reason === "loss" ? 1 : 0,
              losses: reason === "loss" ? ["omitted object"] : [],
            }),
          takeBytes: () => new Uint8Array(1),
          free: () => {
            freed = true;
          },
        };
      },
    };
    expect(() => verifiedHwpBytesV3(document)).toThrow(
      reason === "loss"
        ? "REPORT_HWP_CONTENT_LOSS"
        : reason === "bytes"
          ? "REPORT_HWP_BYTE_LENGTH_MISMATCH"
          : "REPORT_HWP_REOPEN_FAILED",
    );
    expect(exported).toBe(reason !== "reopen");
    expect(freed).toBe(reason !== "reopen");
  });
