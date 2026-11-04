import { expect, it } from "vitest";
import { unzipSync, zipSync } from "fflate";
import * as template from "../../packages/template/src/index";
import {
  openArchive,
  walk,
  elements,
  serialize,
  NS,
} from "../../packages/template/src/xml";
import { renderSourceV3, renderScenarioV3 } from "../helpers/template-v3";

for (const format of ["docx", "hwpx"] as const) {
  it(`${format}: preserves the existing run style when an empty cell becomes a populated column`, async () => {
    const source = openArchive(renderSourceV3(format), format);
    const part = source.bodyParts[0]!;
    const cell = walk(source.xml.get(part)!).find(
      (n) => n.namespaceURI === NS[format] && n.localName === "tc",
    )!;
    const run = walk(cell).find(
      (n) => n.localName === (format === "docx" ? "r" : "run"),
    )!;
    const text = walk(run).find((n) => n.localName === "t")!;
    text.textContent = "";
    if (format === "hwpx") run.setAttribute("charPrIDRef", "9");
    else {
      const props = elements(run).find((n) => n.localName === "rPr")!;
      const color = run.ownerDocument!.createElementNS(NS.docx, "w:color");
      color.setAttributeNS(NS.docx, "w:val", "FF0000");
      props.appendChild(color);
    }
    source.parts[part] = serialize(source.xml.get(part)!);
    const scenario = await renderScenarioV3(
      format,
      undefined,
      zipSync(source.parts),
    );
    const result = await template.renderTemplateV3(scenario);
    expect(result.proof.stylesPreserved).toBe(true);
    const output = openArchive(result.bytes, format);
    const cells = walk(output.xml.get(part)!).filter(
      (n) => n.namespaceURI === NS[format] && n.localName === "tc",
    );
    const changedRun = walk(cells[1]!).find(
      (n) => n.localName === (format === "docx" ? "r" : "run"),
    )!;
    if (format === "hwpx") {
      expect(changedRun.getAttribute("charPrIDRef")).toBe("9");
      changedRun.setAttribute("charPrIDRef", "0");
    } else {
      const color = walk(changedRun).find((n) => n.localName === "color")!;
      expect(color.getAttributeNS(NS.docx, "val")).toBe("FF0000");
      color.setAttributeNS(NS.docx, "w:val", "00FF00");
    }
    const tampered = unzipSync(result.bytes);
    tampered[part] = serialize(output.xml.get(part)!);
    await expect(
      template.verifyWorkingDocumentV3({
        source: scenario.bytes,
        output: zipSync(tampered),
        definition: scenario.definition,
        validatedPlan: scenario.validatedPlan,
      }),
    ).rejects.toThrow("TEMPLATE_PRESERVATION_FAILED");
  });
}
