import { describe, it, expect } from "vitest";
import {
  buildChartSvg,
  buildOrganizationSvg,
  drawNames,
  assignTeams,
  COMMAND_IDS,
  COMMAND_INPUT_SCHEMAS,
} from "@document-studio/core";
describe("original report graphics", () => {
  it.each(["bar", "line", "pie"] as const)(
    "creates a bounded %s SVG",
    (kind) => {
      const svg = buildChartSvg(
        [
          { label: "한글 <script>alert(1)</script>", value: 12 },
          { label: "검토 & 확정", value: 8 },
        ],
        kind,
      );
      expect(svg).toContain("&lt;");
      expect(svg).not.toContain("<script>");
      expect(svg).toContain("&amp;");
      expect(svg).not.toContain("href=");
      expect(svg).not.toContain("NaN");
    },
  );
  it("renders a single-value pie as a whole circle", () =>
    expect(buildChartSvg([{ label: "합계", value: 10 }], "pie")).toContain(
      "<circle",
    ));
  it.each(
    [
      [],
      [{ label: "x", value: NaN }],
      [{ label: "x", value: Infinity }],
      Array.from({ length: 51 }, () => ({ label: "x", value: 1 })),
    ].map((data) => ({ data })),
  )("rejects invalid chart data %j", ({ data }) =>
    expect(() => buildChartSvg(data)).toThrow(),
  );
  it("refuses negative and zero-total pie charts", () => {
    expect(() => buildChartSvg([{ label: "x", value: -1 }], "pie")).toThrow();
    expect(() => buildChartSvg([{ label: "x", value: 0 }], "pie")).toThrow();
  });
  it("renders signed bars and lines without invalid coordinates", () => {
    for (const kind of ["bar", "line"] as const) {
      const svg = buildChartSvg(
        [
          { label: "감소", value: -4 },
          { label: "증가", value: 8 },
        ],
        kind,
      );
      expect(svg).not.toContain("NaN");
      expect(svg).toContain("감소");
    }
  });
  it("draws hierarchy connections with escaped names", () => {
    const svg = buildOrganizationSvg([
      { id: "a", label: "본부 & 기획" },
      { id: "b", parentId: "a", label: "개발팀" },
    ]);
    expect(svg).toContain("<path");
    expect(svg).toContain("&amp;");
    expect(svg).toContain("개발팀");
  });
  it("rejects cycles and invalid organizations", () => {
    expect(() =>
      buildOrganizationSvg([{ id: "a", parentId: "a", label: "loop" }]),
    ).toThrow();
    expect(() => buildOrganizationSvg([])).toThrow();
  });
});
describe("draws and balanced teams", () => {
  const names = ["가", "나", "다", "라", "마"];
  it("keeps original inputs and returns unique winners", () => {
    const copy = [...names];
    const winners = drawNames(names, 3, () => 0.5);
    expect(new Set(winners).size).toBe(3);
    expect(names).toEqual(copy);
    expect(winners.every((name) => names.includes(name))).toBe(true);
  });
  it("assigns every person once with balanced sizes", () => {
    const teams = assignTeams(names, 2, () => 0.5);
    expect(teams.map((team) => team.length)).toEqual([3, 2]);
    expect([...teams.flat()].sort()).toEqual([...names].sort());
  });
  it("supports the default cryptographic random source", () =>
    expect(drawNames(names, 1)).toHaveLength(1));
  it.each([0, -1, 6, 1.5, NaN])("rejects count %s", (count) =>
    expect(() => drawNames(names, count)).toThrow(),
  );
  it("rejects duplicated names and invalid random values", () => {
    expect(() => drawNames(["x", "x"], 1)).toThrow();
    expect(() => drawNames(names, 1, () => 1)).toThrow();
  });
});
it("provides value schemas for every parameterized agent command", () => {
  expect(Object.keys(COMMAND_INPUT_SCHEMAS)).toHaveLength(17);
  expect(COMMAND_INPUT_SCHEMAS.insertText.type).toBe("string");
  expect(COMMAND_INPUT_SCHEMAS.pageSetup.additionalProperties).toBe(false);
  expect(
    Object.keys(COMMAND_INPUT_SCHEMAS).every((id) =>
      COMMAND_IDS.includes(id as never),
    ),
  ).toBe(true);
  expect(() => JSON.stringify(COMMAND_INPUT_SCHEMAS)).not.toThrow();
});
