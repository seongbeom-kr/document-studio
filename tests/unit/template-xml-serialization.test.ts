import { expect, it } from "vitest";
import { strToU8, strFromU8, unzipSync, zipSync } from "fflate";
import { parseXml, serialize } from "../../packages/template/src/xml";
import { renderTemplateV3 } from "../../packages/template/src/index";
import { renderSourceV3, renderScenarioV3 } from "../helpers/template-v3";

it("preserves carriage-return entities and escapes literal markup when serializing protected XML text", () => {
  const source = parseXml(
    strToU8("<root><note>원본 그림&#13;\n설명 &amp; &lt;표&gt;</note></root>"),
  );
  const original = source.documentElement!.textContent;
  const output = serialize(source),
    reopened = parseXml(output);
  expect(reopened.documentElement!.textContent).toBe(original);
  expect(strFromU8(output)).toContain("&#13;\n");
  expect(reopened.getElementsByTagName("표").length).toBe(0);
});

it("renders an editable HWPX table without altering protected picture comments with CRLF", async () => {
  const parts = unzipSync(renderSourceV3("hwpx"));
  parts["Contents/section0.xml"] = strToU8(
    strFromU8(parts["Contents/section0.xml"]!).replace(
      "<hp:t>고정 제목</hp:t>",
      "<hp:t>고정 제목</hp:t><hp:shapeComment>원본 그림&#13;\n설명</hp:shapeComment>",
    ),
  );
  const scenario = await renderScenarioV3("hwpx", undefined, zipSync(parts));
  await expect(renderTemplateV3(scenario)).resolves.toHaveProperty(
    "proof.stylesPreserved",
    true,
  );
});
