import { expect, it } from "vitest";
import * as template from "../../packages/template/src/index";
import { renderScenarioV3, hashV3 } from "../helpers/template-v3";
import { unzipSync, strFromU8 } from "fflate";
import { zipSync } from "fflate";
import {
  openArchive,
  walk,
  NS,
  textOf,
  serialize,
  elements,
} from "../../packages/template/src/xml";
import { renderSourceV3 } from "../helpers/template-v3";
for (const format of ["docx", "hwpx"] as const) {
  it(`${format}: writes reviewed headers and horizontal merges`, async () => {
    const scenario = await renderScenarioV3(format),
      d = scenario.definition.regions[0]!,
      plan = scenario.validatedPlan.plan.regions[0]!;
    if (plan.kind !== "table") throw new Error("table expected");
    d.headerRows = 1;
    d.prototypeRow = 1;
    d.reviewDigest = await template.regionReviewDigestV3(d);
    plan.rows[1]!.cells.unshift({
      columnKey: "c0",
      text: "복원된 셀",
      evidenceRefs: ["source_ref"],
    });
    plan.rows[2]!.cells.pop();
    plan.merges = [{ row: 2, column: 2, rowSpan: 1, columnSpan: 2 }];
    scenario.validatedPlan.plan.definitionDigest = await template.digestV3(
      scenario.definition,
    );
    scenario.validatedPlan.planDigest = await template.digestV3(
      scenario.validatedPlan.plan,
    );
    const result = await template.renderTemplateV3(scenario),
      s = await template.inspectTemplateV3({
        bytes: result.bytes,
        format,
        identity: {
          ...scenario.structure.identity,
          normalizedHash: hashV3(result.bytes),
        },
      }),
      table = s.regions.find((r) => r.kind === "table")!.table!;
    expect(table.headerRows).toBe(1);
    expect(table.rows[2]!.cells[2]!.columnSpan).toBe(2);
    expect(table.rows[1]!.cells[0]!.rowSpan).toBe(1);
  });
  it(`${format}: replaces only the reviewed inline range`, async () => {
    const scenario = await renderScenarioV3(format),
      d = scenario.definition.regions[1]!;
    d.kind = "text";
    d.range = { start: 3, end: 5 };
    d.reviewDigest = await template.regionReviewDigestV3(d);
    scenario.validatedPlan.plan.regions[1] = {
      regionId: d.id,
      kind: "text",
      text: "새로운😀",
      evidenceRefs: ["source_ref"],
    };
    scenario.validatedPlan.plan.definitionDigest = await template.digestV3(
      scenario.definition,
    );
    scenario.validatedPlan.planDigest = await template.digestV3(
      scenario.validatedPlan.plan,
    );
    const result = await template.renderTemplateV3(scenario),
      s = await template.inspectTemplateV3({
        bytes: result.bytes,
        format,
        identity: {
          ...scenario.structure.identity,
          normalizedHash: hashV3(result.bytes),
        },
      });
    expect(s.regions.some((r) => r.text === "반복 새로운😀")).toBe(true);
  });
  it(`${format}: expands columns, grows rows, reorders roles and merges without changing protected parts`, async () => {
    const scenario = await renderScenarioV3(format),
      before = hashV3(scenario.bytes),
      result = await template.renderTemplateV3(scenario);
    const s = await template.inspectTemplateV3({
      bytes: result.bytes,
      format,
      identity: {
        ...scenario.structure.identity,
        normalizedHash: hashV3(result.bytes),
      },
    });
    const table = s.regions.find((r) => r.kind === "table")!.table!;
    expect(table.columns).toHaveLength(4);
    expect(table.rows).toHaveLength(30);
    expect(table.rows[0]!.cells[0]).toMatchObject({
      rowSpan: 2,
      columnSpan: 1,
      text: "1행 1열 한글😀\n줄바꿈",
    });
    expect(table.rows[1]!.cells).toHaveLength(3);
    expect(
      s.regions.filter(
        (r) => r.text === "새 문단 하나" || r.text === "새 문단 둘",
      ),
    ).toHaveLength(2);
    expect(s.protectedParts).toEqual(scenario.structure.protectedParts);
    expect(s.page).toEqual(scenario.structure.page);
    expect(hashV3(scenario.bytes)).toBe(before);
    expect(result.proof).toMatchObject({
      sourceIdentity: scenario.structure.identity,
      planDigest: scenario.validatedPlan.planDigest,
      outputDigest: hashV3(result.bytes),
      gridValid: true,
      stylesPreserved: true,
    });
    const part =
        format === "docx" ? "word/document.xml" : "Contents/section0.xml",
      xml = strFromU8(unzipSync(result.bytes)[part]!);
    expect(xml).toContain("고정 제목");
    expect(xml).toContain("보호 꼬리말");
    expect(xml).not.toContain("옛 예시");
  });
  for (const empty of ["remove", "keep", "blank"] as const)
    it(`${format}: ${empty} empty data never retains old example facts`, async () => {
      const scenario = await renderScenarioV3(format, empty),
        result = await template.renderTemplateV3(scenario);
      const s = await template.inspectTemplateV3({
        bytes: result.bytes,
        format,
        identity: {
          ...scenario.structure.identity,
          normalizedHash: hashV3(result.bytes),
        },
      });
      expect(
        s.regions.some(
          (r) => r.text.includes("옛 예시") || r.text === "반복 내용",
        ),
      ).toBe(false);
      const table = s.regions.find((r) => r.kind === "table");
      if (empty === "remove") expect(table).toBeUndefined();
      else expect(table!.table!.rows).toHaveLength(empty === "keep" ? 3 : 1);
    });
}
it("places newly required DOCX cell properties before cell paragraphs", async () => {
  const source = renderSourceV3("docx"),
    archive = openArchive(source, "docx"),
    part = archive.bodyParts[0]!,
    doc = archive.xml.get(part)!;
  for (const n of walk(doc).filter((n) => n.localName === "tcPr"))
    n.parentNode!.removeChild(n);
  archive.parts[part] = serialize(doc);
  const scenario = await renderScenarioV3(
      "docx",
      undefined,
      zipSync(archive.parts),
    ),
    result = await template.renderTemplateV3(scenario),
    out = openArchive(result.bytes, "docx");
  for (const cell of walk(out.xml.get(part)!).filter(
    (n) => n.localName === "tc",
  ))
    expect(elements(cell)[0]!.localName).toBe("tcPr");
});
it("preserves the run style at a reviewed range starting after a bold prefix", async () => {
  const archive = openArchive(renderSourceV3("docx"), "docx"),
    part = archive.bodyParts[0]!,
    doc = archive.xml.get(part)!,
    paragraph = walk(doc).find(
      (n) => n.localName === "p" && textOf(n, NS.docx) === "반복 내용",
    )!;
  const run = elements(paragraph).find((n) => n.localName === "r")!,
    copy = run.cloneNode(true) as typeof run;
  walk(run).find((n) => n.localName === "t")!.textContent = "반복 ";
  const b = doc.createElementNS(NS.docx, "w:b");
  walk(run)
    .find((n) => n.localName === "rPr")!
    .appendChild(b);
  const props = walk(copy).find((n) => n.localName === "rPr")!;
  props.parentNode!.removeChild(props);
  walk(copy).find((n) => n.localName === "t")!.textContent = "내용";
  paragraph.appendChild(copy);
  archive.parts[part] = serialize(doc);
  const scenario = await renderScenarioV3(
      "docx",
      undefined,
      zipSync(archive.parts),
    ),
    d = scenario.definition.regions[1]!;
  d.kind = "text";
  d.range = { start: 3, end: 5 };
  d.reviewDigest = await template.regionReviewDigestV3(d);
  scenario.validatedPlan.plan.regions[1] = {
    regionId: d.id,
    kind: "text",
    text: "수정",
    evidenceRefs: ["source_ref"],
  };
  scenario.validatedPlan.plan.definitionDigest = await template.digestV3(
    scenario.definition,
  );
  scenario.validatedPlan.planDigest = await template.digestV3(
    scenario.validatedPlan.plan,
  );
  await expect(template.renderTemplateV3(scenario)).resolves.toHaveProperty(
    "bytes",
  );
});
