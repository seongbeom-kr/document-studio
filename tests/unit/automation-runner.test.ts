import { describe, expect, it } from "vitest";
import {
  AUTOMATION_ACTIONS,
  AUTOMATION_INPUT_LIMIT,
  previewAutomation,
} from "@document-studio/core";

describe("shared automation preview contract", () => {
  it.each(AUTOMATION_ACTIONS)("runs the documented input for $id", (action) => {
    const result = previewAutomation({
      actionId: action.id,
      input: action.example,
      ...(action.id === "age" ? { argument: "2026-10-16" } : {}),
    });
    expect(result.actionId).toBe(action.id);
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.input.input).toBe(action.example);
    expect(action.inputSchema.properties.actionId.const).toBe(action.id);
    if (result.kind === "document")
      expect(result.template?.blocks.length).toBeGreaterThan(0);
    if (result.kind === "graphic") expect(result.svg).toContain("<svg");
    if (result.kind === "table") expect(result.rows?.length).toBeGreaterThan(0);
  });
  it("keeps monetary and calendar conversions exact", () => {
    expect(
      previewAutomation({ actionId: "amount-korean", input: "12340" }).text,
    ).toBe("금12,340원(금일만이천삼백사십원)");
    expect(
      previewAutomation({
        actionId: "age",
        input: "2000-10-17",
        argument: "2026-10-16",
      }).text,
    ).toBe("25");
    expect(
      previewAutomation({ actionId: "date-format", input: "2026-10-16" }).text,
    ).toBe("2026. 10. 16.(금)");
  });
  it("retains quoted table cells and structured report blocks", () => {
    const table = previewAutomation({
      actionId: "table-clean",
      input: '" A,B ", 2\n C , 3',
      transform: "trim",
    });
    expect(table.rows).toEqual([
      ["A,B", "2"],
      ["C", "3"],
    ]);
    const report = previewAutomation({
      actionId: "markdown-report",
      input: "# 보고\n\n| 이름 | 금액 |\n|---|---|\n| 가 | 123 |",
    });
    expect(report.template?.blocks).toContainEqual({
      kind: "table",
      rows: [
        ["이름", "금액"],
        ["가", "123"],
      ],
    });
  });
  it("rejects unknown actions/options and oversized input before computation", () => {
    expect(() =>
      previewAutomation({ actionId: "unknown", input: "1" } as never),
    ).toThrow("지원하지 않는");
    expect(() =>
      previewAutomation({
        actionId: "chart",
        input: "가,1",
        argument: "unknown",
      }),
    ).toThrow("옵션");
    expect(() =>
      previewAutomation({
        actionId: "date-period",
        input: "2026-10-16",
        argument: "언젠가",
      }),
    ).toThrow("옵션");
    expect(() =>
      previewAutomation({
        actionId: "table-clean",
        input: "1",
        delimiter: "|",
      } as never),
    ).toThrow("열 구분");
    expect(() =>
      previewAutomation({
        actionId: "amount-korean",
        input: "1".repeat(AUTOMATION_INPUT_LIMIT + 1),
      }),
    ).toThrow("1,000,000");
    expect(() =>
      previewAutomation({ actionId: "date-format", input: "2026-02-30" }),
    ).toThrow("존재하지 않는");
  });
  it("describes print and LLM limitations in structured warnings", () => {
    expect(
      previewAutomation({
        actionId: "name-cards",
        input: "홍길동,기획,팀장",
      }).warnings.join(),
    ).toContain("재단선");
    expect(
      previewAutomation({
        actionId: "report-prompt",
        input: "검증된 사실",
      }).warnings.join(),
    ).toContain("LLM을 실행한 결과가 아닙니다");
  });
});
