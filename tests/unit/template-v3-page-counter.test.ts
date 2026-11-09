import { expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import * as template from "../../packages/template/src/index";
import { hashV3, renderSourceV3 } from "../helpers/template-v3";

function source(control = '<hp:newNum num="1" numType="PAGE"/>') {
  const parts = unzipSync(renderSourceV3("hwpx"));
  parts["Contents/section0.xml"] = strToU8(
    strFromU8(parts["Contents/section0.xml"]!).replace(
      "<hp:t>반복 내용</hp:t>",
      `<hp:ctrl>${control}</hp:ctrl><hp:t>반복 내용</hp:t>`,
    ),
  );
  return zipSync(parts);
}

it("edits v3 paragraph text while preserving its native page-number reset and disallowing repetition", async () => {
  const bytes = source();
  const identity = {
    sourceHash: hashV3(bytes),
    normalizedHash: hashV3(bytes),
    structureRevision: 1,
  };
  const structure = await template.inspectTemplateV3({
    bytes,
    format: "hwpx",
    identity,
  });
  const paragraph = structure.regions.find((r) => r.text === "반복 내용")!;
  expect(paragraph.editable).toBe(true);
  expect(paragraph.capabilities.paragraphRepeat).toBe(false);
  const legacy = await template.inspectTemplate({ bytes, format: "hwpx" });
  expect(legacy.targets.find((r) => r.text === "반복 내용")!.editable).toBe(
    false,
  );
  const region: template.RegionDefinitionV3 = {
    id: "overview",
    sourceRegionId: paragraph.id,
    kind: "text",
    enabled: true,
    intent: {
      purpose: "새 개요",
      sources: [],
      include: [],
      exclude: [],
      tone: "보고체",
      instructions: "",
      fixedText: [],
    },
    reviewState: "confirmed",
    reviewDigest: null,
    styleIds: paragraph.styleIds,
    policy: {
      allowRowChanges: false,
      allowColumnChanges: false,
      allowMerges: false,
      allowParagraphRepeat: false,
      maxRows: 1,
      maxColumns: 1,
      minColumnWidth: 1,
      empty: "blank",
    },
    columnRoles: [],
  };
  region.reviewDigest = await template.regionReviewDigestV3(region);
  const definition: template.TemplateDefinitionV3 = {
    schemaVersion: 3,
    identity,
    regions: [region],
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    output: { allowedFormats: ["hwpx", "hwp"], defaultFormat: "hwp" },
    policy: {
      pageSize: "preserve",
      orientation: "preserve",
      fontSize: "preserve",
    },
  };
  const input = {
    values: {},
    evidenceRefs: ["source_ref"],
    sourceSnapshotDigest: await template.digestV3("source"),
  };
  const plan: template.RenderPlanV3 = {
    schemaVersion: 3,
    identity,
    definitionDigest: await template.digestV3(definition),
    inputDigest: await template.digestV3(input.values),
    sourceSnapshotDigest: input.sourceSnapshotDigest,
    regions: [
      {
        regionId: region.id,
        kind: "text",
        text: "2030년 새로운 개요",
        evidenceRefs: ["source_ref"],
      },
    ],
  };
  const validatedPlan = await template.validateRenderPlanV3({
    structure,
    definition,
    plan,
    ...input,
    inputDigest: plan.inputDigest,
  });
  const output = await template.renderTemplateV3({
    bytes,
    structure,
    definition,
    input,
    validatedPlan,
  });
  const parts = unzipSync(output.bytes);
  const xml = strFromU8(parts["Contents/section0.xml"]!);
  expect(xml).toContain('<hp:newNum num="1" numType="PAGE"/>');
  expect(xml).toContain("2030년 새로운 개요");
  parts["Contents/section0.xml"] = strToU8(
    xml.replace('num="1" numType="PAGE"', 'num="2" numType="PAGE"'),
  );
  await expect(
    template.verifyWorkingDocumentV3({
      source: bytes,
      output: zipSync(parts),
      definition,
      validatedPlan,
    }),
  ).rejects.toThrow("TEMPLATE_PRESERVATION_FAILED");
});

it.each([
  '<hp:newNum num="1" numType="FIGURE"/>',
  '<hp:newNum num="1" numType="PAGE"/><hp:fieldBegin/>',
])("keeps unsupported paragraph controls protected: %s", async (control) => {
  const bytes = source(control);
  const structure = await template.inspectTemplateV3({
    bytes,
    format: "hwpx",
    identity: {
      sourceHash: hashV3(bytes),
      normalizedHash: hashV3(bytes),
      structureRevision: 1,
    },
  });
  expect(structure.regions.find((r) => r.text === "반복 내용")!.editable).toBe(
    false,
  );
});
