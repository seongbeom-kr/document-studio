import { expect, it } from "vitest";
import { zipSync, unzipSync } from "fflate";
import * as template from "../../packages/template/src/index";
import {
  openArchive,
  walk,
  elements,
  serialize,
} from "../../packages/template/src/xml";
import { renderSourceV3, renderScenarioV3 } from "../helpers/template-v3";

it("preserves distinct header and body prototype row heights including merged source cells", async () => {
  const original = openArchive(renderSourceV3("hwpx"), "hwpx"),
    part = original.bodyParts[0]!;
  const sourceTable = walk(original.xml.get(part)!).find(
    (n) => n.localName === "tbl",
  )!;
  const rows = elements(sourceTable).filter((n) => n.localName === "tr");
  const cells = rows.map((r) =>
    elements(r).filter((n) => n.localName === "tc"),
  );
  for (const [index, row] of cells.entries())
    for (const cell of row) {
      elements(cell)
        .find((n) => n.localName === "cellSz")!
        .setAttribute("height", index ? "3000" : "1000");
      cell.setAttribute("header", index ? "0" : "1");
    }
  elements(cells[1]![0]!)
    .find((n) => n.localName === "cellSpan")!
    .setAttribute("rowSpan", "2");
  elements(cells[1]![0]!)
    .find((n) => n.localName === "cellSz")!
    .setAttribute("height", "6000");
  rows[2]!.removeChild(cells[2]![0]!);
  elements(sourceTable)
    .find((n) => n.localName === "sz")!
    .setAttribute("height", "7000");
  original.parts[part] = serialize(original.xml.get(part)!);
  const scenario = await renderScenarioV3(
    "hwpx",
    undefined,
    zipSync(original.parts),
  );
  const definition = scenario.definition.regions[0]!,
    plan = scenario.validatedPlan.plan.regions[0]!;
  if (plan.kind !== "table") throw new Error("table expected");
  definition.headerRows = 1;
  definition.prototypeRow = 1;
  definition.reviewDigest = await template.regionReviewDigestV3(definition);
  plan.rows = plan.rows.slice(0, 3);
  const firstRole = {
    roleId: plan.columns[0]!.roleId,
    styleId: plan.columns[0]!.styleId,
  };
  Object.assign(plan.columns[0]!, {
    roleId: plan.columns[1]!.roleId,
    styleId: plan.columns[1]!.styleId,
  });
  Object.assign(plan.columns[1]!, firstRole);
  plan.rows[1]!.cells.unshift({
    columnKey: plan.columns[0]!.key,
    text: "본문 병합",
    evidenceRefs: ["source_ref"],
  });
  plan.rows[2]!.cells = plan.rows[2]!.cells.filter(
    (c) => c.columnKey !== plan.columns[0]!.key,
  );
  plan.rows[0]!.groupKey = "header";
  plan.rows[1]!.groupKey = plan.rows[2]!.groupKey = "body";
  plan.merges = [{ row: 1, column: 0, rowSpan: 2, columnSpan: 1 }];
  scenario.validatedPlan.plan.definitionDigest = await template.digestV3(
    scenario.definition,
  );
  scenario.validatedPlan.planDigest = await template.digestV3(
    scenario.validatedPlan.plan,
  );
  const output = await template.renderTemplateV3(scenario);
  const archive = openArchive(output.bytes, "hwpx");
  const table = walk(archive.xml.get(part)!).find(
    (n) => n.localName === "tbl",
  )!;
  const actualRows = elements(table).filter((n) => n.localName === "tr");
  const sizes = actualRows.map((r) =>
    walk(r).filter((n) => n.localName === "cellSz"),
  );
  expect(sizes[0]!.map((n) => n.getAttribute("height"))).toEqual([
    "1000",
    "1000",
    "1000",
    "1000",
  ]);
  expect(sizes[1]!.map((n) => n.getAttribute("height"))).toEqual([
    "6000",
    "3000",
    "3000",
    "3000",
  ]);
  expect(sizes[2]!.map((n) => n.getAttribute("height"))).toEqual([
    "3000",
    "3000",
    "3000",
  ]);
  expect(
    elements(table)
      .find((n) => n.localName === "sz")!
      .getAttribute("height"),
  ).toBe("7000");
  sizes[0]![0]!.setAttribute("height", "2000");
  const tampered = unzipSync(output.bytes);
  tampered[part] = serialize(archive.xml.get(part)!);
  await expect(
    template.verifyWorkingDocumentV3({
      source: scenario.bytes,
      output: zipSync(tampered),
      definition: scenario.definition,
      validatedPlan: scenario.validatedPlan,
    }),
  ).rejects.toThrow("TEMPLATE_PRESERVATION_FAILED");
});
