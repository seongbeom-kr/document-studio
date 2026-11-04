import { beforeAll, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import init, { HwpDocument } from "../../third_party/rhwp-core/rhwp.js";
import { renderScenarioV3, hashV3 } from "../helpers/template-v3";
import { renderTemplateV3 } from "../../packages/template/src/index";
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
