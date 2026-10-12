import { it, expect } from "vitest";
import {
  meetingTemplate,
  validateTemplate,
  splitReportTable,
  safeCalculate,
  datePeriod,
  transformCells,
} from "@document-studio/core";
it.each([0, 1, 99, 100, 150, 2000])(
  "preserves %s attendees in bounded generated tables",
  (count) => {
    const template = meetingTemplate(
      Array.from({ length: count }, (_, i) => ({
        name: `참석자 ${i + 1}`,
        organization: "검토팀",
      })),
      "attendance",
      "명단.docx",
    );
    expect(() => validateTemplate(template)).not.toThrow();
    const tables = template.blocks.filter((block) => block.kind === "table");
    expect(tables.reduce((sum, table) => sum + table.rows.length - 1, 0)).toBe(
      count,
    );
    expect(
      tables.every(
        (table) => table.rows.length <= 100 && table.rows[0]?.[3] === "성명",
      ),
    ).toBe(true);
  },
);
it("splits a wide table by the cell count as well as row count", () => {
  const rows = Array.from({ length: 100 }, () =>
    Array.from({ length: 50 }, () => "셀"),
  );
  const tables = splitReportTable(rows);
  expect(tables.every((table) => table.rows.length * 50 <= 2000)).toBe(true);
  expect(tables.reduce((n, table) => n + table.rows.length - 1, 0)).toBe(99);
});
it.each([
  ["25만원 × 12개월 × 5명", 15000000],
  ["1 / 5만원", 0.00002],
  ["1.5만원 + 3,000원", 18000],
] as const)("calculates explicit report units: %s", (text, expected) =>
  expect(safeCalculate(text)).toBe(expected),
);
it("rejects unknown enum values instead of choosing a different operation", () => {
  expect(() => datePeriod("2026-10-05", "later" as never)).toThrow();
  expect(() => transformCells([["1"]], "unknown" as never)).toThrow();
});
