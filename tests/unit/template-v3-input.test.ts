import { expect, it } from "vitest";
import cases from "../../packages/template/contracts/v3/fixtures/input-values.json";
import * as template from "../../packages/template/src/index";
import { renderScenarioV3 } from "../helpers/template-v3";

for (const test of cases) it(`actual v3 input: ${test.name}`, () => {
  expect(template).toHaveProperty("validateInputValuesV3");
  const validate = (template as any).validateInputValuesV3;
  if (test.valid) expect(() => validate(test.schema, test.values)).not.toThrow();
  else expect(() => validate(test.schema, test.values)).toThrow("REPORT_INVALID_INPUT");
});
it("refuses malformed values even when the input and plan digests were recomputed", async () => {
  const scenario = await renderScenarioV3("docx");
  scenario.definition.inputSchema = { type: "object", properties: { title: { type: "string" } }, required: ["title"], additionalProperties: false };
  scenario.input.values = { title: 123 };
  scenario.validatedPlan.plan.inputDigest = await template.digestV3(scenario.input.values);
  scenario.validatedPlan.plan.definitionDigest = await template.digestV3(scenario.definition);
  scenario.validatedPlan.planDigest = await template.digestV3(scenario.validatedPlan.plan);
  await expect(template.renderTemplateV3(scenario)).rejects.toThrow("REPORT_INVALID_INPUT");
});
