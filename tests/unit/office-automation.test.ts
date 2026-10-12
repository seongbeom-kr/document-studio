import { describe, it, expect } from "vitest";
import {
  splitReportTable,
  koreanNumber,
  formatAccountingAmount,
  parseCalendarDate,
  formatOfficeDate,
  ageOn,
  datePeriod,
  parseDelimited,
  serializeDelimited,
  transformCells,
  safeCalculate,
  percentageAnalysis,
  reverseTotals,
  consolidateRows,
  sortByOrganization,
  participantTable,
  organizationRows,
  parseReportMarkdown,
  markdownTemplate,
  meetingTemplate,
  organizationTemplate,
  validateTemplate,
  validateCommand,
  validateSearch,
  validateReplace,
  REPORT_PRESETS,
} from "../../packages/core/src/index";
describe("report automation arithmetic", () => {
  it.each([
    [0, "영"],
    [1, "일"],
    [10, "십"],
    [100, "백"],
    [1000, "천"],
    [12340, "일만이천삼백사십"],
    [100000000, "일억"],
    [-20000, "마이너스 이만"],
  ] as const)("formats Korean integer %s", (value, text) =>
    expect(koreanNumber(value)).toBe(text),
  );
  it("retains integer precision beyond JavaScript's safe number range", () => {
    expect(koreanNumber("10000000000000000")).toBe("일경");
    expect(() => koreanNumber(9007199254740992)).toThrow();
  });
  it("formats accounting amounts without reinterpreting decimals", () => {
    expect(formatAccountingAmount("12,340")).toBe(
      "금12,340원(금일만이천삼백사십원)",
    );
    expect(() => formatAccountingAmount("12.30")).toThrow();
  });
  it.each(["abc", "1e100", "1.2", "", "9".repeat(25)])(
    "rejects invalid amounts %s",
    (value) => expect(() => koreanNumber(value)).toThrow(),
  );
  it.each([
    ["0.1+0.2", 0.3],
    ["(2+3)*4", 20],
    ["10,000원 × 3개 × 2일", 60000],
    ["100*15%", 15],
    ["-2*-3", 6],
    [".5+1.5", 2],
    ["10/4", 2.5],
  ] as const)("calculates bounded expression %s", (expression, result) =>
    expect(safeCalculate(expression)).toBe(result),
  );
  it.each([
    "1/0",
    "alert(1)",
    "globalThis.process",
    "2**5000",
    "(1+2",
    "1+",
    "",
    "9".repeat(100),
  ])("refuses invalid expression %s", (expression) =>
    expect(() => safeCalculate(expression)).toThrow(),
  );
  it("sums percentages and reverse totals independently of input order", () => {
    expect(percentageAnalysis([1, 2, 1])).toEqual([
      { value: 1, percentage: 25 },
      { value: 2, percentage: 50 },
      { value: 1, percentage: 25 },
    ]);
    expect(reverseTotals([10, 20, 30])).toEqual([60, 50, 30]);
    expect(() => percentageAnalysis([0, 0])).toThrow();
    expect(() => percentageAnalysis([-1, 2])).toThrow();
  });
});
describe("calendar utilities", () => {
  it.each(["2026-02-29", "2026-13-01", "20260001", "1899-01-01", "garbage"])(
    "rejects invalid calendar date %s",
    (value) => expect(() => parseCalendarDate(value)).toThrow(),
  );
  it("uses date-only values without local timezone shifts", () => {
    expect(parseCalendarDate("20240229")).toEqual({
      year: 2024,
      month: 2,
      day: 29,
    });
    expect(formatOfficeDate("2026-01-01")).toBe("2026. 1. 1.(목)");
    expect(formatOfficeDate("2026.1.1.", "iso")).toBe("2026-01-01");
  });
  it.each([
    ["1993-07-05", "2026-07-04", 32],
    ["1993-07-05", "2026-07-05", 33],
    ["2026-01-01", "2026-01-01", 0],
  ] as const)("checks the birthday boundary", (birth, on, age) =>
    expect(ageOn(birth, on)).toBe(age),
  );
  it("refuses future births", () =>
    expect(() => ageOn("2026-01-02", "2026-01-01")).toThrow());
  it("handles week and month rollover", () => {
    expect(datePeriod("2026-12-31", "nextWeek")).toEqual({
      from: "2027-01-04",
      to: "2027-01-10",
    });
    expect(datePeriod("2024-01-31", "nextMonth")).toEqual({
      from: "2024-02-01",
      to: "2024-02-29",
    });
  });
});
describe("table data utilities", () => {
  it("round trips quoted multiline cells and Korean characters", () => {
    const rows = [
      ["한국어", "line1\nline2", 'a"b'],
      ["", "tab\tcell", "끝"],
    ];
    expect(parseDelimited(serializeDelimited(rows))).toEqual(rows);
  });
  it("reads CSV quotes, escaped quotes and CRLF", () =>
    expect(parseDelimited('"a,b","c""d"\r\n1,2', ",")).toEqual([
      ["a,b", 'c"d'],
      ["1", "2"],
    ]));
  it("does not discard an empty trailing cell", () =>
    expect(parseDelimited("a\tb\t")).toEqual([["a", "b", ""]]));
  it("rejects unbalanced quotes", () =>
    expect(() => parseDelimited('"unfinished')).toThrow());
  it("transforms a copy and rejects nonnumeric cells", () => {
    const original = [[" 1,000 ", "2"]];
    expect(transformCells(original, "multiply", 2)).toEqual([["2000", "4"]]);
    expect(original[0]![0]).toBe(" 1,000 ");
    expect(() => transformCells([["bad"]], "divide", 2)).toThrow();
    expect(() => transformCells([["1"]], "divide", 0)).toThrow();
  });
  it("numbers cells across rows", () =>
    expect(
      transformCells(
        [
          ["", ""],
          ["", ""],
        ],
        "sequence",
        7,
      ),
    ).toEqual([
      ["7", "8"],
      ["9", "10"],
    ]));
  it("consolidates selected row ranges and removes empty-key rows", () =>
    expect(
      consolidateRows(
        [
          [["head"], ["a"], [""]],
          [["head"], ["b"]],
        ],
        { startRow: 2, removeEmptyColumn: 0 },
      ),
    ).toEqual([["a"], ["b"]]));
  it("keeps stable order for repeated and unknown organizations", () => {
    expect(
      sortByOrganization(
        [
          ["b", "1"],
          ["a", "2"],
          ["b", "3"],
          ["z", "4"],
        ],
        0,
        ["a", "b"],
      ),
    ).toEqual([
      ["a", "2"],
      ["b", "1"],
      ["b", "3"],
      ["z", "4"],
    ]);
    expect(() => sortByOrganization([], 0, ["a", "a"])).toThrow();
  });
  it("checks organization cycles and missing parents", () => {
    expect(
      organizationRows([
        { id: "a", label: "총괄" },
        { id: "b", parentId: "a", label: "팀" },
      ]),
    ).toEqual([["총괄"], ["총괄", "팀"]]);
    expect(() =>
      organizationRows([{ id: "a", parentId: "a", label: "순환" }]),
    ).toThrow();
    expect(() =>
      organizationRows([{ id: "a", parentId: "missing", label: "x" }]),
    ).toThrow();
  });
  it("creates original participant templates", () => {
    expect(
      participantTable([
        { name: "홍길동", organization: "개발", role: "팀장" },
      ]),
    ).toEqual([
      ["번호", "소속", "직위", "성명"],
      ["1", "개발", "팀장", "홍길동"],
    ]);
    expect(
      meetingTemplate([{ name: "홍길동" }], "nameCards", "명패.docx").blocks,
    ).toHaveLength(2);
    expect(
      organizationTemplate([{ id: "a", label: "본부" }], "조직도.docx")
        .blocks[1]!.kind,
    ).toBe("table");
  });
});
describe("markdown, templates and API input gates", () => {
  it("parses headings, lists, fenced code and rectangular tables", () => {
    const blocks = parseReportMarkdown(
      "# 보고서\n\n- 항목\n1. 순서\n\n|항목|내용|\n|---|---|\n|a|b|\n\n```\n<script>literal</script>\n```",
    );
    expect(blocks.map((b) => b.kind)).toEqual([
      "heading",
      "bullet",
      "numbered",
      "table",
      "code",
    ]);
    expect(blocks[4]).toMatchObject({ text: "<script>literal</script>" });
  });
  it("rejects malformed fenced code and oversized templates", () => {
    expect(() => parseReportMarkdown("```\nopen")).toThrow();
    expect(() =>
      validateTemplate({
        fileName: "x",
        blocks: [{ kind: "table", rows: [["a", "b"], ["c"]] }],
      }),
    ).toThrow();
    expect(() =>
      validateTemplate(markdownTemplate("a".repeat(1_000_001))),
    ).toThrow();
  });
  it("validates every original report preset", () => {
    for (const preset of REPORT_PRESETS)
      for (const command of preset.commands)
        expect(() => validateCommand(command)).not.toThrow();
  });
  it.each([
    { id: "paragraphFormat", value: { beforePt: -1 } },
    { id: "paragraphFormat", value: { leftMm: NaN } },
    { id: "paragraphFormat", value: { unknown: true } },
    {
      id: "paragraphFormat",
      value: { lineSpacing: { rule: "exact", value: 0 } },
    },
    { id: "insertTable", value: { rows: 2.5, columns: 2 } },
    { id: "insertTable", value: { rows: 100, columns: 50 } },
    {
      id: "pageSetup",
      value: {
        widthMm: 210,
        heightMm: 297,
        topMm: 200,
        bottomMm: 200,
        leftMm: 20,
        rightMm: 20,
        orientation: "portrait",
      },
    },
    { id: "textColor", value: "javascript:alert(1)" },
    {
      id: "insertImage",
      value: { bytes: new Uint8Array([0, 1]), mimeType: "image/png" },
    },
    { id: "insertText", value: "bad\0text" },
  ])("refuses malformed commands without invoking an engine: %j", (command) =>
    expect(() =>
      validateCommand(command as Parameters<typeof validateCommand>[0]),
    ).toThrow(),
  );
  it("requires bounded search and unambiguous replacement targets", () => {
    expect(() => validateSearch({ query: "" })).toThrow();
    expect(() => validateSearch({ query: "a", maxResults: 501 })).toThrow();
    expect(() => validateReplace({ replacement: "x" })).toThrow();
    expect(() =>
      validateReplace({ replacement: "", matchId: "match" }),
    ).not.toThrow();
  });
});
