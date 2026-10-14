import { expect, test, type Page } from "@playwright/test";
import { strToU8, zipSync } from "fflate";
import {
  Document as DocxDocument,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
} from "docx";

type Format = "docx" | "hwpx";
const expectedCell = (text: string, extra = {}) => ({
  row: 0,
  column: 0,
  rowSpan: 1,
  columnSpan: 1,
  text,
  ...extra,
});

function xmlTools(format: Format) {
  const p = format === "docx" ? "w" : "hp";
  const text = (value: string) =>
    `<${p}:p><${p}:r><${p}:t>${value}</${p}:t></${p}:r></${p}:p>`;
  const cell = (
    content: string,
    options: {
      span?: number;
      rowSpan?: number;
      row?: number;
      column?: number;
      merge?: string;
    } = {},
  ) =>
    `<${p}:tc>${
      format === "docx"
        ? `<w:tcPr>${options.span === undefined ? "" : `<w:gridSpan w:val="${options.span}"/>`}${options.merge === undefined ? "" : options.merge ? `<w:vMerge w:val="${options.merge}"/>` : "<w:vMerge/>"}</w:tcPr>`
        : `${options.span === undefined && options.rowSpan === undefined ? "" : `<hp:cellSpan colSpan="${options.span ?? 1}" rowSpan="${options.rowSpan ?? 1}"/>`}${options.row === undefined && options.column === undefined ? "" : `<hp:cellAddr rowAddr="${options.row ?? 0}" colAddr="${options.column ?? 0}"/>`}`
    }${content}</${p}:tc>`;
  const row = (cells: string, before = 0, after = 0) =>
    `<${p}:tr>${format === "docx" && (before || after) ? `<w:trPr><w:gridBefore w:val="${before}"/><w:gridAfter w:val="${after}"/></w:trPr>` : ""}${cells}</${p}:tr>`;
  const table = (columns: number, rows: string, rowCount = 1) =>
    `<${p}:tbl${format === "hwpx" ? ` rowCnt="${rowCount}" colCnt="${columns}"` : ""}>${format === "docx" ? `<w:tblGrid>${'<w:gridCol w:w="1200"/>'.repeat(columns)}</w:tblGrid>` : ""}${rows}</${p}:tbl>`;
  const archive = (body: string) =>
    Array.from(
      zipSync(
        format === "docx"
          ? {
              "[Content_Types].xml": strToU8("<Types/>"),
              "word/document.xml": strToU8(
                `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
              ),
            }
          : {
              "Contents/header.xml": strToU8("<header/>"),
              "Contents/section0.xml": strToU8(
                `<hp:sec xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">${body}</hp:sec>`,
              ),
            },
      ),
    );
  return { text, cell, row, table, archive };
}

for (const format of ["docx", "hwpx"] as const) {
  const { text, cell, row, table, archive } = xmlTools(format);
  const inner = table(
    2,
    row(cell(text("INNER-MERGED"), { span: 2 })) +
      row(cell(text("LEFT")) + cell(text("RIGHT"))),
    2,
  );
  const leaf = table(3, row(cell(text("LEAF"), { span: 3 })));
  const middle = table(2, row(cell(text("MIDDLE") + leaf, { span: 2 })));
  const cases = [
    {
      name: "parent cell never inherits a child's horizontal span or text",
      xml: table(1, row(cell(text("BEFORE") + inner + text("AFTER")))),
      expected: [
        { rows: 1, columns: 1, cells: [expectedCell("BEFOREAFTER")] },
        {
          rows: 2,
          columns: 2,
          cells: [
            expectedCell("INNER-MERGED", { columnSpan: 2 }),
            expectedCell("LEFT", { row: 1 }),
            expectedCell("RIGHT", { row: 1, column: 1 }),
          ],
        },
      ],
    },
    {
      name: "parent's own span and nested child's span stay independent",
      xml: table(3, row(cell(text("PARENT") + inner, { span: 3 }))),
      expected: [
        {
          rows: 1,
          columns: 3,
          cells: [expectedCell("PARENT", { columnSpan: 3 })],
        },
        { rows: 2, columns: 2 },
      ],
    },
    {
      name: "three nesting levels have distinct addresses and no duplicated child text",
      xml: table(1, row(cell(text("TOP") + middle))),
      expected: [
        { columns: 1, cells: [expectedCell("TOP")] },
        { columns: 2, cells: [expectedCell("MIDDLE", { columnSpan: 2 })] },
        { columns: 3, cells: [expectedCell("LEAF", { columnSpan: 3 })] },
      ],
    },
    {
      name: "child vertical merge never changes an unmerged parent",
      xml: table(
        1,
        row(
          cell(
            text("PARENT") +
              table(
                1,
                row(
                  cell(
                    text("CHILD"),
                    format === "docx" ? { merge: "restart" } : { rowSpan: 2 },
                  ),
                ) +
                  row(
                    cell(
                      text("CONTINUE"),
                      format === "docx" ? { merge: "" } : { row: 1 },
                    ),
                  ),
                2,
              ),
          ),
        ),
      ),
      expected: [
        { rows: 1, columns: 1, cells: [expectedCell("PARENT")] },
        {
          rows: 2,
          columns: 1,
          cells: [
            expectedCell(
              "CHILD",
              format === "docx"
                ? { rowSpan: null, verticalMerge: "restart" }
                : { rowSpan: 2 },
            ),
            expectedCell(
              "CONTINUE",
              format === "docx"
                ? { row: 1, rowSpan: null, verticalMerge: "continue" }
                : { row: 1 },
            ),
          ],
        },
      ],
    },
    {
      name: "parent's own vertical span remains distinct from the nested child's merge",
      xml: table(
        1,
        row(
          cell(
            text("PARENT") +
              table(
                1,
                row(
                  cell(
                    text("CHILD"),
                    format === "docx" ? { merge: "restart" } : { rowSpan: 2 },
                  ),
                ),
                format === "docx" ? 1 : 2,
              ),
            format === "docx" ? { merge: "" } : { rowSpan: 3 },
          ),
        ),
        format === "docx" ? 1 : 3,
      ),
      expected: [
        {
          rows: format === "docx" ? 1 : 3,
          columns: 1,
          cells: [
            expectedCell(
              "PARENT",
              format === "docx"
                ? { rowSpan: null, verticalMerge: "continue" }
                : { rowSpan: 3 },
            ),
          ],
        },
        {
          rows: format === "docx" ? 1 : 2,
          columns: 1,
          cells: [
            expectedCell(
              "CHILD",
              format === "docx"
                ? { rowSpan: null, verticalMerge: "restart" }
                : { rowSpan: 2 },
            ),
          ],
        },
      ],
    },
    {
      name: "own grid and cell addresses account for omitted columns",
      xml:
        format === "docx"
          ? table(5, row(cell(text("OFFSET"), { span: 2 }), 2, 1))
          : table(
              8,
              row(cell(text("OFFSET"), { row: 1, column: 3, span: 2 })),
              3,
            ),
      expected: [
        {
          rows: format === "docx" ? 1 : 3,
          columns: format === "docx" ? 5 : 8,
          cells: [
            expectedCell("OFFSET", {
              row: format === "docx" ? 0 : 1,
              column: format === "docx" ? 2 : 3,
              columnSpan: 2,
            }),
          ],
        },
      ],
    },
    {
      name: "an inner cell address cannot leak into the containing cell",
      xml: table(
        1,
        row(
          cell(
            text("OUTER") +
              table(
                6,
                row(
                  cell(
                    text("INNER"),
                    format === "docx"
                      ? { span: 6 }
                      : { row: 3, column: 4, span: 2 },
                  ),
                ),
                4,
              ),
          ),
        ),
      ),
      expected: [
        { rows: 1, columns: 1, cells: [expectedCell("OUTER")] },
        {
          columns: 6,
          cells: [
            expectedCell(
              "INNER",
              format === "docx"
                ? { columnSpan: 6 }
                : { row: 3, column: 4, columnSpan: 2 },
            ),
          ],
        },
      ],
    },
  ];
  for (const scenario of cases) {
    test(`${format}: exported inspection ${scenario.name}`, async ({
      page,
    }) => {
      await page.goto("/harness.html");
      await page.waitForFunction(() => window.documentStudioTest);
      const result = await page.evaluate(
        ({ bytes, format }) =>
          window.documentStudioTest.inspectBytes(bytes, format),
        { bytes: archive(scenario.xml), format },
      );
      expect(result.tables).toHaveLength(scenario.expected.length);
      expect(result.tables).toMatchObject(scenario.expected);
      expect(new Set(result.tables.map((item) => item.address)).size).toBe(
        scenario.expected.length,
      );
      expect(result.truncated).toBe(false);
      expect(result.limitations).toContain(
        "셀 텍스트는 해당 셀의 텍스트만 연결하며 중첩 표 텍스트는 별도 표에 반환",
      );
    });
  }
  test(`${format}: malformed span is rejected and large cell text is explicitly truncated`, async ({
    page,
  }) => {
    await page.goto("/harness.html");
    await page.waitForFunction(() => window.documentStudioTest);
    await expect(
      page.evaluate(
        ({ bytes, format }) =>
          window.documentStudioTest.inspectBytes(bytes, format),
        {
          bytes: archive(table(1, row(cell(text("INVALID"), { span: 0 })))),
          format,
        },
      ),
    ).rejects.toThrow("표 크기·셀 주소·병합 정보");
    const result = await page.evaluate(
      ({ bytes, format }) =>
        window.documentStudioTest.inspectBytes(bytes, format),
      { bytes: archive(table(1, row(cell(text("가".repeat(2001)))))), format },
    );
    expect(result.tables[0]!.cells[0]!.text).toHaveLength(2000);
    expect(result.truncated).toBe(true);
  });
}

test("DOCX native export and public agent.inspect preserve nested table ownership", async ({
  page,
}) => {
  const inner = new Table({
    columnWidths: [2000, 2000],
    rows: [
      new TableRow({
        children: [
          new TableCell({
            columnSpan: 2,
            children: [new Paragraph("안쪽 병합")],
          }),
        ],
      }),
      new TableRow({
        children: [
          new TableCell({ children: [new Paragraph("안쪽 왼쪽")] }),
          new TableCell({ children: [new Paragraph("안쪽 오른쪽")] }),
        ],
      }),
    ],
  });
  const outer = new Table({
    columnWidths: [4000],
    rows: [
      new TableRow({
        children: [
          new TableCell({
            children: [
              new Paragraph("바깥 시작"),
              inner,
              new Paragraph("바깥 끝"),
            ],
          }),
        ],
      }),
    ],
  });
  const bytes = Array.from(
    await Packer.toBuffer(
      new DocxDocument({ sections: [{ children: [outer] }] }),
    ),
  );
  await page.goto("/harness.html");
  await page.waitForFunction(() => window.documentStudioTest);
  await page.evaluate(
    (bytes) => window.documentStudioTest.loadBytes(bytes, "docx"),
    bytes,
  );
  await expect
    .poll(() => page.evaluate(() => window.documentStudioTest.state()?.ready))
    .toBe(true);
  const result = await page.evaluate(async () => {
    const api = window.documentStudioTest;
    const inspection = await api.agent.inspect({
      documentId: api.agent.getState().documentId,
    });
    const exported = await api.export();
    return { inspection, exported: api.inspectBytes(exported, "docx") };
  });
  for (const inspection of [result.inspection, result.exported]) {
    expect(inspection.tables).toHaveLength(2);
    expect(inspection.tables[0]).toMatchObject({
      rows: 1,
      columns: 1,
      cells: [expectedCell("바깥 시작바깥 끝")],
    });
    expect(inspection.tables[1]).toMatchObject({
      rows: 2,
      columns: 2,
      cells: [
        expectedCell("안쪽 병합", { columnSpan: 2 }),
        expectedCell("안쪽 왼쪽", { row: 1 }),
        expectedCell("안쪽 오른쪽", { row: 1, column: 1 }),
      ],
    });
  }
});

async function openAutomation(
  page: Page,
  format: Format,
  persistAutomation = false,
) {
  await page.goto("/harness.html");
  await page.waitForFunction(() => window.documentStudioTest);
  await page.evaluate(
    ({ format, persistAutomation }) => {
      window.documentStudioTest.persistAutomation = persistAutomation;
      return window.documentStudioTest.load(format, `blank.${format}`);
    },
    { format, persistAutomation },
  );
  await expect
    .poll(() => page.evaluate(() => window.documentStudioTest.state()?.ready))
    .toBe(true);
  await page.getByRole("button", { name: "문단·표·그림", exact: true }).click();
  await page.getByRole("tab", { name: "업무 자동화", exact: true }).click();
}

for (const format of ["docx", "hwpx"] as const) {
  test(`${format}: automation search matches displayed labels, distinguishes no results and preserves draft input`, async ({
    page,
  }) => {
    await openAutomation(page, format);
    const select = page.getByLabel("자동화 기능", { exact: true });
    const search = page.getByLabel("자동화 기능 찾기", { exact: true });
    await select.selectOption("마크다운 보고서");
    const input = page.getByLabel("보고서 마크다운", { exact: true });
    await input.fill("# 유지할 입력\n검색과 무관한 원문");
    for (const [query, names] of [
      ["내용 초안", ["명찰 내용 초안", "회의명패 내용 초안"]],
      ["명찰", ["명찰 내용 초안"]],
      ["명패", ["회의명패 내용 초안"]],
    ] as const) {
      await search.fill(` ${query} `);
      const options = await select.locator("option").allTextContents();
      for (const name of names) expect(options).toContain(name);
      await expect(
        page.getByText(
          `검색 결과 ${names.length}개. 현재 선택과 입력을 유지합니다.`,
          { exact: true },
        ),
      ).toBeVisible();
      await expect(input).toHaveValue("# 유지할 입력\n검색과 무관한 원문");
    }
    await search.fill("절대로없는기능-024");
    await expect(
      page.getByText("검색 결과가 없습니다. 현재 선택과 입력을 유지합니다.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(select.locator("option")).toHaveCount(1);
    await expect(select).toHaveValue("마크다운 보고서");
    await search.fill("행사 자료");
    await expect(
      page.getByText("검색 결과 5개. 현재 선택과 입력을 유지합니다.", {
        exact: true,
      }),
    ).toBeVisible();
    await search.fill("");
    await expect(select.locator("option")).toHaveCount(20);
    await expect(input).toHaveValue("# 유지할 입력\n검색과 무관한 원문");
    await select.selectOption("명찰");
    await select.selectOption("마크다운 보고서");
    await expect(input).toHaveValue("# 유지할 입력\n검색과 무관한 원문");
  });

  for (const width of [1366, 480]) {
    test(`${format}: structured preview occupies the result column at ${width}px and collapsed text releases its space`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await openAutomation(page, format);
      // A short dock now expands automatically when automation opens.
      if (
        (await page
          .locator(".ds-editing-tools")
          .getAttribute("data-expanded")) !== "true"
      )
        await page
          .getByRole("button", { name: "도구 크게 보기", exact: true })
          .click();
      const select = page.getByLabel("자동화 기능", { exact: true });
      await select.selectOption("마크다운 보고서");
      await page
        .getByLabel("보고서 마크다운", { exact: true })
        .fill("# 배치 검사\n| A | B |\n|---|---|\n| 1 | 2 |");
      await page
        .getByRole("button", { name: "결과 미리보기", exact: true })
        .click();
      const preview = page.getByRole("region", {
        name: "마크다운 보고서 구조 미리보기",
        exact: true,
      });
      await expect(preview).toBeVisible();
      const dimensions = await page
        .locator(".ds-automation-data")
        .evaluate((grid) => {
          const input = grid
            .querySelector("[data-automation-input]")!
            .getBoundingClientRect();
          const result = grid
            .querySelector(".ds-template-preview")!
            .getBoundingClientRect();
          const details = grid.parentElement!.querySelector(".ds-text-result")!;
          return {
            input: {
              x: input.x,
              y: input.y,
              width: input.width,
              bottom: input.bottom,
            },
            result: { x: result.x, y: result.y, width: result.width },
            detailsHeight: details.getBoundingClientRect().height,
            detailsInsideGrid: grid.contains(details),
            opened: details.hasAttribute("open"),
            overflow: grid.scrollWidth > grid.clientWidth + 2,
          };
        });
      expect(dimensions.detailsInsideGrid).toBe(false);
      expect(dimensions.opened).toBe(false);
      expect(dimensions.detailsHeight).toBeLessThan(55);
      expect(dimensions.overflow).toBe(false);
      if (width === 1366) {
        expect(dimensions.result.x).toBeGreaterThan(
          dimensions.input.x + dimensions.input.width,
        );
        expect(Math.abs(dimensions.result.y - dimensions.input.y)).toBeLessThan(
          35,
        );
      } else {
        expect(Math.abs(dimensions.result.x - dimensions.input.x)).toBeLessThan(
          5,
        );
        expect(dimensions.result.y).toBeGreaterThanOrEqual(
          dimensions.input.bottom,
        );
      }
      await page
        .getByText("텍스트 결과 · 표·서식 제외", { exact: true })
        .click();
      await expect(
        page.getByLabel("업무 자동화 결과", { exact: true }),
      ).toBeVisible();
      await page
        .getByText("텍스트 결과 · 표·서식 제외", { exact: true })
        .click();
      await expect(
        page.getByLabel("업무 자동화 결과", { exact: true }),
      ).toBeHidden();
      await select.selectOption("명찰");
      await page
        .getByRole("button", { name: "결과 미리보기", exact: true })
        .click();
      await expect(
        page.getByRole("region", { name: "명찰 구조 미리보기", exact: true }),
      ).toBeVisible();
      await select.selectOption("차트");
      await page
        .getByRole("button", { name: "결과 미리보기", exact: true })
        .click();
      await expect(
        page.getByAltText("업무 자동화 그림 미리보기", { exact: true }),
      ).toBeVisible();
      await select.selectOption("금액 한글화");
      await page
        .getByRole("button", { name: "결과 미리보기", exact: true })
        .click();
      const result = page.getByLabel("업무 자동화 결과", { exact: true });
      await expect(result).toBeVisible();
      await expect(result).toBeEditable();
      await result.fill("계산 결과 보정");
      await expect(result).toHaveValue("계산 결과 보정");
    });
  }
  test(`${format}: automation next actions follow result type and the host's document creation availability`, async ({
    page,
  }) => {
    await openAutomation(page, format, true);
    const select = page.getByLabel("자동화 기능", { exact: true });
    const create = page.getByRole("button", {
      name: "구조를 유지해 새 문서 만들기",
      exact: true,
    });
    await page.evaluate(() => {
      window.documentStudioTest.creationEnabled = false;
      window.documentStudioTest.rerender();
    });
    for (const utility of ["차트", "조직도 그림"]) {
      await select.selectOption(utility);
      await page
        .getByRole("button", { name: "결과 미리보기", exact: true })
        .click();
      await expect(
        page.getByAltText("업무 자동화 그림 미리보기"),
      ).toBeVisible();
      await expect(create).toHaveCount(0);
      await expect(
        page.getByRole("button", {
          name: "그림을 선택 위치에 삽입",
          exact: true,
        }),
      ).toBeEnabled();
      await expect(
        page.getByText(
          "미리보기를 만든 뒤 현재 문서에 그림으로 삽입할 수 있습니다.",
          { exact: false },
        ),
      ).toBeVisible();
      await expect(
        page.getByText("새 문서는 원본 입력으로 만듭니다.", { exact: false }),
      ).toHaveCount(0);
    }
    await select.selectOption("금액 한글화");
    await page
      .getByRole("button", { name: "결과 미리보기", exact: true })
      .click();
    await expect(create).toHaveCount(0);
    await expect(
      page.getByLabel("업무 자동화 결과", { exact: true }),
    ).toBeEditable();
    await expect(
      page.getByRole("button", {
        name: "텍스트로 삽입 · 표/서식 제외",
        exact: true,
      }),
    ).toBeEnabled();
    await select.selectOption("마크다운 보고서");
    await page
      .getByLabel("보고서 마크다운", { exact: true })
      .fill("# 생성 지원 확인\n| A | B |\n|---|---|\n| 1 | 2 |");
    await page
      .getByRole("button", { name: "결과 미리보기", exact: true })
      .click();
    await expect(create).toBeDisabled();
    await expect(
      page.getByLabel("새 문서 파일명", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText("이 앱에서는 새 문서 생성을 지원하지 않습니다.", {
        exact: false,
      }),
    ).toBeVisible();
    const oldSession = await page.evaluate(
      () => window.documentStudioTest.state()!.sessionId,
    );
    await page.evaluate(() => {
      window.documentStudioTest.creationEnabled = true;
      window.documentStudioTest.rerender();
    });
    await expect(create).toBeEnabled();
    await expect(
      page.getByLabel("새 문서 파일명", { exact: true }),
    ).toHaveValue(/\.\w+$/);
    await create.click();
    await expect
      .poll(() =>
        page.evaluate((old) => {
          const state = window.documentStudioTest.state();
          return state?.ready && state.sessionId !== old;
        }, oldSession),
      )
      .toBe(true);
    const result = await page.evaluate(() => {
      const agent = window.documentStudioTest.agent;
      return agent.inspect({ documentId: agent.getState().documentId });
    });
    expect(result.tables).toHaveLength(1);
    expect(result.tables[0]).toMatchObject({ rows: 2, columns: 2 });
  });
}
