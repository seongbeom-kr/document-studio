import { expect, it } from "vitest";
import { unzipSync, zipSync, strToU8, strFromU8 } from "fflate";
import * as template from "../../packages/template/src/index";
import { renderScenarioV3 } from "../helpers/template-v3";
import {
  openArchive,
  walk,
  NS,
  textOf,
  serialize,
  elements,
  attr,
} from "../../packages/template/src/xml";
for (const format of ["docx", "hwpx"] as const)
  it(`${format}: independent verification rejects changed protected content, styles and media`, async () => {
    const scenario = await renderScenarioV3(format),
      result = await template.renderTemplateV3(scenario);
    const verify = (output: Uint8Array) =>
      template.verifyWorkingDocumentV3({
        source: scenario.bytes,
        output,
        definition: scenario.definition,
        validatedPlan: scenario.validatedPlan,
      });
    await expect(verify(result.bytes)).resolves.toMatchObject({
      gridValid: true,
      stylesPreserved: true,
    });
    const part =
      format === "docx" ? "word/document.xml" : "Contents/section0.xml";
    for (const [from, to] of [
      ["보호 꼬리말", "다른 꼬리말"],
      ["한글😀", "삭제"],
      [
        format === "docx" ? 'w:val="22"' : 'charPrIDRef="0"',
        format === "docx" ? 'w:val="12"' : 'charPrIDRef="999"',
      ],
    ]) {
      const parts = unzipSync(result.bytes);
      parts[part] = strToU8(strFromU8(parts[part]!).replace(from!, to!));
      await expect(verify(zipSync(parts))).rejects.toThrow(
        "TEMPLATE_PRESERVATION_FAILED",
      );
    }
    const parts = unzipSync(result.bytes);
    parts[format === "docx" ? "word/media/logo.png" : "BinData/logo.png"] =
      new Uint8Array([9]);
    await expect(verify(zipSync(parts))).rejects.toThrow(
      "TEMPLATE_PRESERVATION_FAILED",
    );
  });
for (const format of ["docx", "hwpx"] as const)
  it(`${format}: rejects altered cell widths and cell font properties inside an editable table`, async () => {
    const scenario = await renderScenarioV3(format),
      rendered = await template.renderTemplateV3(scenario);
    const verify = (output: Uint8Array) =>
      template.verifyWorkingDocumentV3({
        source: scenario.bytes,
        output,
        definition: scenario.definition,
        validatedPlan: scenario.validatedPlan,
      });
    for (const tamper of ["width", "font"]) {
      const archive = openArchive(rendered.bytes, format),
        part = archive.bodyParts[0]!,
        doc = archive.xml.get(part)!;
      const cell = walk(doc).find((n) => n.localName === "tc")!;
      if (tamper === "width") {
        const width = walk(cell).find(
          (n) => n.localName === (format === "docx" ? "tcW" : "cellSz"),
        )!;
        if (format === "docx") width.setAttributeNS(NS.docx, "w:w", "1");
        else width.setAttribute("width", "1");
      } else {
        const run = walk(cell).find(
          (n) => n.localName === (format === "docx" ? "r" : "run"),
        )!;
        if (format === "docx")
          walk(run)
            .find((n) => n.localName === "sz")!
            .setAttributeNS(NS.docx, "w:val", "12");
        else run.setAttribute("charPrIDRef", "999");
      }
      archive.parts[part] = serialize(doc);
      await expect(verify(zipSync(archive.parts))).rejects.toThrow(
        "TEMPLATE_PRESERVATION_FAILED",
      );
    }
  });
it("revalidates plan digest and source/input identity at rendering boundary", async () => {
  const scenario = await renderScenarioV3("docx");
  await expect(
    template.renderTemplateV3({
      ...scenario,
      input: { ...scenario.input, values: { other: true } },
    }),
  ).rejects.toThrow();
  await expect(
    template.renderTemplateV3({
      ...scenario,
      validatedPlan: {
        ...scenario.validatedPlan,
        planDigest: `sha256:${"f".repeat(64)}`,
      },
    }),
  ).rejects.toThrow();
});
it("never repeats a paragraph that owns the section page settings", async () => {
  const scenario = await renderScenarioV3("hwpx");
  expect(
    scenario.structure.regions.find((r) => r.text === "고정 제목")!.capabilities
      .paragraphRepeat,
  ).toBe(false);
});
it("rejects hidden text inside DOCX vertical merge continuation cells", async () => {
  const scenario = await renderScenarioV3("docx"),
    rendered = await template.renderTemplateV3(scenario),
    archive = openArchive(rendered.bytes, "docx"),
    part = archive.bodyParts[0]!,
    doc = archive.xml.get(part)!;
  const continuation = walk(doc).find(
    (n) =>
      n.localName === "tc" &&
      walk(n).some(
        (c) => c.localName === "vMerge" && attr(c, "val") === "continue",
      ),
  )!;
  const t = walk(continuation).find((n) => n.localName === "t")!;
  t.textContent = "숨겨진 내용";
  archive.parts[part] = serialize(doc);
  await expect(
    template.verifyWorkingDocumentV3({
      source: scenario.bytes,
      output: zipSync(archive.parts),
      definition: scenario.definition,
      validatedPlan: scenario.validatedPlan,
    }),
  ).rejects.toThrow("TEMPLATE_PRESERVATION_FAILED");
});
