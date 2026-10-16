import { test, expect, type Page } from "@playwright/test";
import { unzipSync, strFromU8 } from "fflate";
import { Document, Table, TableCell, TableRow, Paragraph, Packer } from "docx";
import initRhwp, { HwpDocument } from "@rhwp/core";
import { readFile } from "node:fs/promises";
const rows = [
  ["항목", "금액", "사번", "날짜"],
  ["첫째", "12340", "001234", "20261016"],
  ["둘째", "-4500.50", "123456", "2026-10-16"],
  ["셋째", "00123", "123456789012", "2026. 10. 16."],
  ["넷째", "20261016", "012345", "2026/10/16"],
  ["다섯째", "오류", "000001", "20261017"],
  ["여섯째", "변경전 변경전", "000002", "20261018"],
];
async function open(page: Page, format: "docx" | "hwpx") {
  await page.goto("/harness.html");
  await page.waitForFunction(() => !!window.documentStudioTest);
  await page.evaluate(
    async ({ format, rows }) => {
      await window.documentStudioTest.createTemplate(format, {
        fileName: `열편집.${format}`,
        blocks: [
          { kind: "paragraph", text: "표 밖 12340 변경전 유지" },
          { kind: "table", rows },
          { kind: "paragraph", text: "마지막 본문 유지" },
        ],
      });
    },
    { format, rows },
  );
  await expect
    .poll(() => page.evaluate(() => window.documentStudioTest.state()?.ready))
    .toBe(true);
  await select(page, "-4500.50");
}
async function select(page: Page, query: string) {
  await page.evaluate(async (query) => {
    const a = window.documentStudioTest.agent,
      s = a.getState(),
      found = await a.search({ documentId: s.documentId, query });
    if (!found.matches[0]) throw new Error("Missing fixture text");
    await a.select({
      documentId: s.documentId,
      expectedSessionId: s.sessionId,
      expectedRevision: found.revision,
      matchId: found.matches[0].id,
    });
  }, query);
}
async function preview(
  page: Page,
  kind: "commas" | "replace" = "commas",
  column = 2,
) {
  return page.evaluate(
    async ({ kind, column }) => {
      const a = window.documentStudioTest.agent,
        s = a.getState();
      return a.previewTableColumn({
        documentId: s.documentId,
        columnRequest: {
          column,
          columnKind: kind === "commas" ? "number" : "text",
          headerRows: 1,
          operation:
            kind === "commas"
              ? { kind }
              : { kind, find: "변경전", replacement: "변경후" },
        },
      });
    },
    { kind, column },
  );
}
async function apply(
  page: Page,
  p: Awaited<ReturnType<typeof preview>>,
  id = "table-test",
) {
  return page.evaluate(
    async (p) => {
      try {
        return await window.documentStudioTest.agent.applyTableColumn({
          documentId: p.documentId,
          expectedSessionId: p.sessionId,
          expectedRevision: p.revision,
          expectedSelectionKey: p.selectionKey!,
          previewId: p.previewId,
          operationId: p.id,
        });
      } catch (error) {
        throw new Error(
          `${error instanceof Error ? error.message : String(error)} / cause: ${error instanceof Error && error.cause instanceof Error ? error.cause.message : "none"}`,
        );
      }
    },
    { ...p, id },
  );
}
const text = (page: Page) =>
  page.evaluate(() => {
    const a = window.documentStudioTest.agent;
    return a.readDocument({ documentId: a.getState().documentId });
  });
for (const format of ["docx", "hwpx"] as const) {
  test(`${format} table column previews protect IDs and dates, apply once, undo/redo and persist`, async ({
    page,
  }) => {
    await open(page, format);
    const before = await text(page),
      initial = await page.evaluate(() => window.documentStudioTest.export());
    const p = await preview(page);
    expect(p.changes.map((c) => [c.row, c.column, c.after])).toEqual([
      [2, 2, "12,340"],
      [3, 2, "-4,500.50"],
    ]);
    expect(p.excluded).toHaveLength(5);
    expect((await text(page)).text).toBe(before.text);
    expect((await preview(page, "commas", 3)).changes).toHaveLength(0);
    expect((await preview(page, "commas", 4)).changes).toHaveLength(0);
    const receipt = await apply(page, p);
    expect(receipt).toMatchObject({
      changedCells: 2,
      undoSteps: 1,
      committed: false,
    });
    expect(await apply(page, p)).toEqual(receipt);
    expect((await text(page)).text).toContain("-4,500.50");
    await page.evaluate(() =>
      window.documentStudioTest.execute({ id: "undo" }),
    );
    expect((await text(page)).text).toBe(before.text);
    await page.evaluate(() =>
      window.documentStudioTest.execute({ id: "redo" }),
    );
    expect((await text(page)).text).toContain("12,340");
    await page.evaluate(() => window.documentStudioTest.save());
    const saved = await page.evaluate(() => ({
      bytes: window.documentStudioTest.saved,
      session: window.documentStudioTest.state()!.sessionId,
    }));
    const z1 = unzipSync(new Uint8Array(initial)),
      z2 = unzipSync(new Uint8Array(saved.bytes));
    if (format === "docx") {
      const properties = (zip: typeof z1) =>
        strFromU8(zip["word/document.xml"]!).match(
          /<w:tcPr\b[\s\S]*?<\/w:tcPr>/g,
        );
      expect(properties(z2)).toEqual(properties(z1));
    }
    await page.evaluate(
      ({ bytes, format }) => window.documentStudioTest.loadBytes(bytes, format),
      { bytes: saved.bytes, format },
    );
    await expect
      .poll(() =>
        page.evaluate((id) => {
          const s = window.documentStudioTest.state();
          return !!s?.ready && s.sessionId !== id;
        }, saved.session),
      )
      .toBe(true);
    const after = await text(page);
    expect(after.text).toContain("12,340");
    expect(after.text).toContain("-4,500.50");
    expect(after.text).toContain("00123");
    expect(after.text).toContain("20261016");
    expect(after.text).toContain("표 밖 12340 변경전 유지");
  });
  test(`${format} literal replacements affect only the selected column`, async ({
    page,
  }) => {
    await open(page, format);
    const p = await preview(page, "replace");
    expect(p.changes).toHaveLength(1);
    expect(p.changes[0]?.after).toBe("변경후 변경후");
    await apply(page, p);
    expect((await text(page)).text).toContain("표 밖 12340 변경전 유지");
    expect((await text(page)).text).toContain("변경후 변경후");
  });
  test(`${format} preview cannot survive revision, selection or permission changes`, async ({
    page,
  }) => {
    await open(page, format);
    const p = await preview(page);
    await select(page, "마지막 본문 유지");
    await expect(apply(page, p)).rejects.toThrow();
    await select(page, "-4500.50");
    const q = await preview(page);
    await page.evaluate(() =>
      window.documentStudioTest.execute({
        id: "insertText",
        value: "변경된 값",
      }),
    );
    await expect(apply(page, q, "table-stale")).rejects.toThrow();
    await select(page, "12340");
    const matches = await page.evaluate(async () => {
      const a = window.documentStudioTest.agent;
      return a.search({ documentId: a.getState().documentId, query: "12340" });
    });
    await page.evaluate(async (matches) => {
      const a = window.documentStudioTest.agent,
        s = a.getState();
      await a.select({
        documentId: s.documentId,
        expectedSessionId: s.sessionId,
        expectedRevision: matches.revision,
        matchId: matches.matches.at(-1)!.id,
      });
    }, matches);
    const r = await preview(page);
    await page.evaluate(() => {
      window.documentStudioTest.readOnly = true;
      window.documentStudioTest.rerender();
    });
    await expect
      .poll(() =>
        page.evaluate(
          () => window.documentStudioTest.state()?.commands.insertText?.enabled,
        ),
      )
      .toBe(false);
    await expect(apply(page, r, "table-readonly")).rejects.toThrow();
  });
  test(`${format} human UI uses the same preview and preserves excluded values`, async ({
    page,
  }) => {
    await open(page, format);
    await page
      .getByRole("button", { name: "문단·표·그림", exact: true })
      .click();
    await page.getByRole("tab", { name: "표", exact: true }).click();
    await page
      .getByRole("button", { name: "선택한 표 읽기", exact: true })
      .click();
    await page
      .getByLabel("열의 자료 종류", { exact: true })
      .selectOption("number");
    await page
      .getByRole("button", { name: "열 변경 미리보기", exact: true })
      .click();
    await expect(
      page.getByRole("table", { name: "바뀔 셀", exact: true }),
    ).toContainText("12,340");
    await expect(
      page.getByRole("table", { name: "제외된 셀", exact: true }),
    ).toContainText("00123");
    await expect(
      page.getByRole("table", { name: "제외된 셀", exact: true }),
    ).toContainText("8자리 날짜");
    await page
      .getByRole("button", { name: "확인한 2개 셀 적용", exact: true })
      .click();
    await expect(page.getByText(/2개 셀을 적용했습니다/)).toBeVisible();
    expect((await text(page)).text).toContain("-4,500.50");
  });
  test(`${format} rich mixed formatting is excluded and long Unicode replacement remains one undo`, async ({
    page,
  }) => {
    await open(page, format);
    await select(page, "4500");
    await page.evaluate(() =>
      window.documentStudioTest.execute({ id: "bold" }),
    );
    const p = await preview(page);
    expect(p.changes.map((c) => c.after)).toEqual(["12,340"]);
    expect(p.excluded.find((c) => c.row === 3)?.reason).toMatch(/서식/);
    await select(page, "변경전 변경전");
    await page.evaluate(() =>
      window.documentStudioTest.execute({
        id: "insertText",
        value: "😀변경전😀 긴 문자열 테스트",
      }),
    );
    const before = (await text(page)).text;
    const q = await page.evaluate(async () => {
      const a = window.documentStudioTest.agent;
      return a.previewTableColumn({
        documentId: a.getState().documentId,
        columnRequest: {
          column: 2,
          columnKind: "text",
          headerRows: 1,
          operation: {
            kind: "replace",
            find: "😀변경전😀",
            replacement: "👩‍💻새로운 긴 문자열 결과👩‍💻",
          },
        },
      });
    });
    expect(q.changes).toHaveLength(1);
    await apply(page, q);
    expect((await text(page)).text).toContain(
      "👩‍💻새로운 긴 문자열 결과👩‍💻 긴 문자열 테스트",
    );
    await page.evaluate(() =>
      window.documentStudioTest.execute({ id: "undo" }),
    );
    expect((await text(page)).text).toBe(before);
  });
  test(`${format} document replacement invalidates a table preview`, async ({
    page,
  }) => {
    await open(page, format);
    const p = await preview(page);
    await page.evaluate(
      (format) => window.documentStudioTest.load(format, `blank.${format}`),
      format,
    );
    await expect
      .poll(() =>
        page.evaluate(
          (id) =>
            window.documentStudioTest.state()?.sessionId !== id &&
            window.documentStudioTest.state()?.ready,
          p.sessionId,
        ),
      )
      .toBe(true);
    await expect(apply(page, p)).rejects.toThrow();
    expect((await text(page)).text).not.toContain("12,340");
  });
  test(`${format} merged cells are shown as exclusions while other rows remain editable`, async ({
    page,
  }) => {
    await open(page, format);
    let bytes: number[];
    if (format === "docx") {
      const doc = new Document({
        sections: [
          {
            children: [
              new Table({
                rows: rows.map(
                  (row, r) =>
                    new TableRow({
                      children: row.flatMap((value, c) =>
                        r === 2 && c === 2
                          ? []
                          : [
                              new TableCell({
                                columnSpan: r === 2 && c === 1 ? 2 : 1,
                                children: [new Paragraph(value)],
                              }),
                            ],
                      ),
                    }),
                ),
              }),
            ],
          },
        ],
      });
      bytes = Array.from(await Packer.toBuffer(doc));
    } else {
      await initRhwp({
        module_or_path: await readFile("node_modules/@rhwp/core/rhwp_bg.wasm"),
      });
      const native = new HwpDocument(
        new Uint8Array(
          await page.evaluate(() => window.documentStudioTest.export()),
        ),
      );
      try {
        const hit = JSON.parse(native.searchAllText("-4500.50", true, true))[0];
        const c = hit.cellContext;
        expect(
          JSON.parse(
            native.mergeTableCells(
              hit.sec,
              c.parentPara,
              c.ctrlIdx,
              2,
              1,
              2,
              2,
            ),
          ).ok,
        ).toBe(true);
        bytes = Array.from(native.exportHwpx());
      } finally {
        native.free();
      }
    }
    const prior = await page.evaluate(
      () => window.documentStudioTest.state()!.sessionId,
    );
    await page.evaluate(
      ({ bytes, format }) => window.documentStudioTest.loadBytes(bytes, format),
      { bytes, format },
    );
    await expect
      .poll(() =>
        page.evaluate(
          (id) =>
            window.documentStudioTest.state()?.ready &&
            window.documentStudioTest.state()?.sessionId !== id,
          prior,
        ),
      )
      .toBe(true);
    await select(page, "-4500.50");
    const p = await preview(page);
    expect(p.changes.map((c) => c.after)).toEqual(["12,340"]);
    expect(
      p.excluded.some((c) => c.row === 3 && c.reason.includes("병합")),
    ).toBe(true);
    await apply(page, p);
    expect((await text(page)).text).toContain("-4500.50");
  });
}
test("hwpx mid-batch failure rolls all cells back and retains the earlier undo history", async ({
  page,
}) => {
  await open(page, "hwpx");
  await page.evaluate(() => window.documentStudioTest.execute({ id: "bold" }));
  const before = await text(page),
    p = await preview(page);
  const frame = page
    .frames()
    .find((f) => f.url().includes("/editor-assets/rhwp/index.html"))!;
  await frame.evaluate(() => {
    const automation = (
      window as unknown as { rhwpStudio: { automation: any } }
    ).rhwpStudio.automation;
    automation.registerCommand({
      id: "ext:test:table-failure",
      label: "Test failure",
      canExecute: () => true,
      execute(services: any) {
        const native = services.wasm.insertTextInCell.bind(services.wasm);
        let count = 0;
        services.wasm.insertTextInCell = (...args: unknown[]) => {
          if (++count === 2) throw new Error("injected second-cell failure");
          return native(...args);
        };
      },
    });
    automation.execute("ext:test:table-failure");
  });
  const error = await page.evaluate(async (p) => {
    const a = window.documentStudioTest.agent;
    try {
      await a.applyTableColumn({
        documentId: p.documentId,
        expectedSessionId: p.sessionId,
        expectedRevision: p.revision,
        expectedSelectionKey: p.selectionKey!,
        previewId: p.previewId,
        operationId: "failure",
      });
      return null;
    } catch (error) {
      return {
        message: (error as Error).message,
        effect: (error as { effect?: string }).effect,
      };
    }
  }, p);
  expect(error).toMatchObject({ effect: "rolled-back" });
  expect((await text(page)).text).toBe(before.text);
  await page.evaluate(() => window.documentStudioTest.execute({ id: "undo" }));
  expect((await text(page)).text).toBe(before.text);
  expect(
    await page.evaluate(
      () => window.documentStudioTest.state()?.commands.bold?.active,
    ),
  ).toBe(false);
});
