import { expect, it } from "vitest";
import { strToU8, strFromU8, unzipSync, zipSync } from "fflate";
import {
  renderTemplateV3,
  verifyWorkingDocumentV3,
} from "../../packages/template/src/index";
import {
  parseXml,
  walk,
  attr,
  NS,
  parent,
  elements,
  serialize,
} from "../../packages/template/src/xml";
import { renderSourceV3, renderScenarioV3 } from "../helpers/template-v3";
import { writeRange } from "../../packages/template/src/render";

it("keeps the source body style when a table prototype starts with a larger bullet", async () => {
  const parts = unzipSync(renderSourceV3("hwpx"));
  parts["Contents/section0.xml"] = strToU8(
    strFromU8(parts["Contents/section0.xml"]!).replaceAll(
      '<hp:run charPrIDRef="0"><hp:t>옛 예시</hp:t></hp:run>',
      '<hp:run charPrIDRef="17"><hp:t>·</hp:t></hp:run><hp:run charPrIDRef="14"><hp:t> 옛 예시</hp:t></hp:run>',
    ),
  );
  const scenario = await renderScenarioV3("hwpx", undefined, zipSync(parts));
  const rendered = await renderTemplateV3(scenario),
    document = parseXml(unzipSync(rendered.bytes)["Contents/section0.xml"]!);
  const cells = walk(document).filter(
    (node) => node.namespaceURI === NS.hwpx && node.localName === "tc",
  );
  const visibleRuns = walk(cells[0]!).filter(
    (node) => node.localName === "run" && node.textContent?.trim(),
  );
  expect(visibleRuns.map((node) => attr(node, "charPrIDRef"))).toEqual(["14"]);
});

it("preserves exact common prefix and suffix styles across Unicode replacements", async () => {
  const modulePath = new URL(
    "../../packages/template/src/v3/text-style.ts",
    import.meta.url,
  ).href;
  const { writeStyledRangeV3 } = await import(modulePath);
  const document = parseXml(
    strToU8(
      `<hp:p xmlns:hp="${NS.hwpx}"><hp:run charPrIDRef="17"><hp:t>· </hp:t></hp:run><hp:run charPrIDRef="14"><hp:t>이전😀 내용</hp:t></hp:run><hp:run charPrIDRef="18"><hp:t> 끝</hp:t></hp:run></hp:p>`,
    ),
  );
  const p = document.documentElement!;
  writeStyledRangeV3(p, 0, p.textContent!.length, "· 새😃 데이터 끝", "hwpx");
  const runs = walk(p).filter((node) => node.localName === "run");
  expect(
    runs.map((node) => [attr(node, "charPrIDRef"), node.textContent]),
  ).toEqual([
    ["17", "· "],
    ["14", "새😃 데이터"],
    ["18", " 끝"],
  ]);
});

it("retains the existing v2 replacement style unless v3 explicitly selects a body anchor", () => {
  const document = parseXml(
    strToU8(
      `<hp:p xmlns:hp="${NS.hwpx}"><hp:run charPrIDRef="17"><hp:t>·</hp:t></hp:run><hp:run charPrIDRef="14"><hp:t> 이전 내용</hp:t></hp:run></hp:p>`,
    ),
  );
  const p = document.documentElement!;
  writeRange(p, 0, p.textContent!.length, "새 내용", "hwpx");
  expect(
    walk(p)
      .filter((node) => node.localName === "run" && node.textContent?.trim())
      .map((node) => attr(node, "charPrIDRef")),
  ).toEqual(["17"]);
});

it("invalidates only affected inline table host layout caches so native pagination measures the expanded table", async () => {
  const parts = unzipSync(renderSourceV3("hwpx"));
  const cache =
    '<hp:linesegarray><hp:lineseg textpos="0" vertpos="0" vertsize="2000" textheight="2000" baseline="1500" spacing="0" horzpos="0" horzsize="30000" flags="0"/></hp:linesegarray>';
  parts["Contents/section0.xml"] = strToU8(
    strFromU8(parts["Contents/section0.xml"]!)
      .replace("</hp:tbl></hp:run></hp:p>", `</hp:tbl></hp:run>${cache}</hp:p>`)
      .replace(
        "<hp:t>보호 꼬리말</hp:t></hp:run></hp:p>",
        `<hp:t>보호 꼬리말</hp:t></hp:run>${cache}</hp:p>`,
      ),
  );
  const scenario = await renderScenarioV3("hwpx", undefined, zipSync(parts));
  const result = await renderTemplateV3(scenario),
    doc = parseXml(unzipSync(result.bytes)["Contents/section0.xml"]!);
  const table = walk(doc).find((node) => node.localName === "tbl")!,
    host = parent(table, "p", NS.hwpx)!;
  expect(
    elements(host).filter((node) => node.localName === "linesegarray"),
  ).toHaveLength(0);
  const protectedParagraph = walk(doc).find(
    (node) => node.localName === "p" && node.textContent === "보호 꼬리말",
  )!;
  expect(
    elements(protectedParagraph).filter(
      (node) => node.localName === "linesegarray",
    ),
  ).toHaveLength(1);
  const outputParts = unzipSync(result.bytes);
  const verify = () =>
    verifyWorkingDocumentV3({
      source: scenario.bytes,
      output: zipSync(outputParts),
      definition: scenario.definition,
      validatedPlan: scenario.validatedPlan,
    });
  const fixedCache = elements(protectedParagraph).find(
    (node) => node.localName === "linesegarray",
  )!;
  elements(fixedCache)[0]!.setAttribute("textheight", "9999");
  outputParts["Contents/section0.xml"] = serialize(doc);
  await expect(verify()).rejects.toThrow("TEMPLATE_PRESERVATION_FAILED");
  elements(fixedCache)[0]!.setAttribute("textheight", "2000");
  host.appendChild(fixedCache.cloneNode(true));
  outputParts["Contents/section0.xml"] = serialize(doc);
  await expect(verify()).rejects.toThrow("TEMPLATE_PRESERVATION_FAILED");
});
