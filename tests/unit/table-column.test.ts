import { describe, it, expect, vi } from "vitest";
import {
  planTableColumn,
  createTableColumnEditor,
  verifyTableChanges,
  TableEditError,
  SaveConflictError,
  SelectionConflictError,
  type TableSnapshot,
  type TableColumnRequest,
} from "../../packages/core/src/index";

const request: TableColumnRequest = {
  column: 2,
  columnKind: "number",
  headerRows: 1,
  operation: { kind: "commas" },
};
function table(
  values = [
    "금액",
    "1000",
    "  -12345.60  ",
    "001234",
    "20261016",
    "10,000",
    "abc",
  ],
): TableSnapshot {
  return {
    tableId: "table-a",
    label: "본문 2번 표",
    rows: values.length,
    columns: 2,
    selectedColumn: 2,
    revision: "1",
    selectionKey: "selection-a",
    cells: values.flatMap((text, i) => [
      {
        id: `name-${i}`,
        row: i + 1,
        column: 1,
        rowSpan: 1,
        columnSpan: 1,
        text: `다른 열 ${i}`,
        editable: true,
      },
      {
        id: `value-${i}`,
        row: i + 1,
        column: 2,
        rowSpan: 1,
        columnSpan: 1,
        text,
        editable: true,
      },
    ]),
  };
}
describe("safe table column preview", () => {
  it.each([
    [{ kind: "prefix", text: "앞 " }, ["앞   가  나  ", "앞 다"]],
    [{ kind: "suffix", text: " 뒤" }, ["  가  나   뒤", "다 뒤"]],
    [{ kind: "trim" }, ["가  나"]],
    [{ kind: "collapseSpaces" }, ["가 나"]],
  ] as const)("transforms only safe cells with %j", (operation, expected) => {
    const result = planTableColumn(
      table(["항목", "  가  나  ", "다", "001234", "2026-10-16"]),
      { ...request, columnKind: "text", operation },
    );
    expect(result.changes.map((c) => c.after)).toEqual(expected);
    expect(result.excluded.map((c) => c.row)).toEqual([1, 4, 5]);
  });
  it("shows precise targets, preserves whitespace/decimal precision and protects IDs and dates", () => {
    const source = table(),
      before = structuredClone(source),
      result = planTableColumn(source, request);
    expect(result.changes).toEqual([
      { cellId: "value-1", row: 2, column: 2, before: "1000", after: "1,000" },
      {
        cellId: "value-2",
        row: 3,
        column: 2,
        before: "  -12345.60  ",
        after: "  -12,345.60  ",
      },
    ]);
    expect(result.excluded.map((x) => x.row)).toEqual([1, 4, 5, 7]);
    expect(result.unchanged).toBe(1);
    expect(result.selected).toBe(7);
    expect(source).toEqual(before);
  });
  it.each(["unknown", "text", "identifier", "date"] as const)(
    "does not infer numeric data from %s",
    (columnKind) => {
      expect(
        planTableColumn(table(), { ...request, columnKind }).changes,
      ).toHaveLength(0);
    },
  );
  it.each(["사번", "회원 번호", "생년월일", "고객 ID", "우편번호", "Date"])(
    "protects %s even if the caller incorrectly declares numbers and no header",
    (header) => {
      expect(
        planTableColumn(table([header, "123456"]), {
          ...request,
          headerRows: 0,
        }).changes,
      ).toHaveLength(0);
    },
  );
  it.each([
    "0001",
    "-0012",
    "2026-10-16",
    "2026. 10. 16.",
    "2026-10-16T12:00:00",
    "123456789012",
    "1,23",
    "1e6",
    "+0012",
  ])("excludes %s with a reason", (value) => {
    const result = planTableColumn(table(["금액", value]), request);
    expect(result.changes).toHaveLength(0);
    expect(result.excluded[1]?.reason).toBeTruthy();
  });
  it("replaces literal text only in the selected column and preserves empty replacements", () => {
    const result = planTableColumn(table(["소속", "A.$ A.$", "a.$", "00123"]), {
      ...request,
      columnKind: "text",
      operation: { kind: "replace", find: "A.$", replacement: "" },
    });
    expect(result.changes).toEqual([
      { cellId: "value-1", row: 2, column: 2, before: "A.$ A.$", after: " " },
    ]);
    expect(result.excluded.at(-1)?.reason).toMatch(/식별자/);
  });
  it("lists unsupported rich/merged cells without changing supported cells in other columns", () => {
    const source = table(["금액", "1000", "2000"]);
    source.cells = source.cells.map((c) =>
      c.id === "value-1"
        ? { ...c, editable: false, reason: "그림 포함" }
        : c.id === "value-2"
          ? { ...c, columnSpan: 2 }
          : c,
    );
    const result = planTableColumn(source, request);
    expect(result.changes).toHaveLength(0);
    expect(result.excluded.map((c) => c.reason)).toEqual([
      "제목 행 제외",
      "그림 포함",
      "병합 셀 제외",
    ]);
  });
  it("does not infer column meaning beneath a merged heading", () => {
    const source = table(["임직원", "사번", "123456"]);
    source.cells = source.cells
      .filter((c) => c.row !== 1 || c.column === 2)
      .map((c) => (c.row === 1 ? { ...c, column: 1, columnSpan: 2 } : c));
    const result = planTableColumn(source, request);
    expect(result.changes).toHaveLength(0);
    expect(result.excluded.at(-1)?.reason).toMatch(/병합된 제목/);
  });
  it("rejects a table exceeding the total column limit", () => {
    expect(() => planTableColumn({ ...table(), columns: 51 }, request)).toThrow(
      /크기 제한/,
    );
  });
  it.each([
    { ...request, column: 0 },
    { ...request, column: 3 },
    { ...request, operation: { kind: "replace", find: "", replacement: "x" } },
    {
      ...request,
      operation: { kind: "replace", find: "a", replacement: "b\n" },
    },
    { ...request, operation: { kind: "eval", code: "1" } },
  ])("rejects invalid input without partial output", (bad) =>
    expect(() => planTableColumn(table(), bad as TableColumnRequest)).toThrow(),
  );
});

function setup() {
  const state = {
    documentId: "doc",
    sessionId: "session",
    revision: "1",
    selectionKey: "selection-a",
  };
  let current = table();
  const read = vi.fn(async () => ({
    ...current,
    revision: state.revision,
    selectionKey: state.selectionKey,
  }));
  const apply = vi.fn(
    async (
      _table: TableSnapshot,
      changes: readonly { cellId: string; after: string }[],
    ) => {
      current = {
        ...current,
        cells: current.cells.map((cell) => ({
          ...cell,
          text:
            changes.find((change) => change.cellId === cell.id)?.after ??
            cell.text,
        })),
      };
      state.revision = "2";
    },
  );
  return {
    state,
    read,
    apply,
    actions: createTableColumnEditor({
      state: () => ({ ...state }),
      read,
      apply,
    }),
  };
}
describe("shared UI/agent table workflow", () => {
  it("accepts new read IDs but rejects a different logical table even with identical cell values", () => {
    const before = { ...table(), sourceKey: "body/table-1" };
    const after = {
      ...before,
      tableId: "read-2",
      cells: before.cells.map((cell, i) => ({ ...cell, id: `new-${i}` })),
    };
    expect(verifyTableChanges(before, [], after).status).toBe("verified");
    expect(
      verifyTableChanges(before, [], { ...after, sourceKey: "body/table-2" }),
    ).toMatchObject({
      status: "mismatch",
      differences: [expect.objectContaining({ reason: "표 대상 불일치" })],
    });
  });
  it("verifies requested cells and preserved cells after a successful native call", async () => {
    const t = setup(),
      preview = await t.actions.preview(request);
    const receipt = await t.actions.apply({
      previewId: preview.previewId,
      operationId: "verified",
    });
    expect(receipt.verification).toMatchObject({
      status: "verified",
      differences: [],
    });
    expect(receipt.verification.checkedCells).toBeGreaterThan(
      receipt.changedCells,
    );
    expect(receipt.excludedCells).toBe(preview.excluded.length);
  });
  it("does not report success or repeat the write when the engine silently applied nothing", async () => {
    const t = setup(),
      preview = await t.actions.preview(request);
    t.apply.mockImplementationOnce(async () => {
      t.state.revision = "2";
    });
    const input = { previewId: preview.previewId, operationId: "not-applied" };
    await expect(t.actions.apply(input)).rejects.toMatchObject({
      code: "table-verification-failed",
      effect: "unknown",
      verification: { status: "mismatch" },
    });
    await expect(t.actions.apply(input)).rejects.toMatchObject({
      code: "table-verification-failed",
    });
    expect(t.apply).toHaveBeenCalledOnce();
  });
  it("reports read failure after a write as unverified, not an effect-none retry", async () => {
    const t = setup(),
      preview = await t.actions.preview(request);
    t.read.mockRejectedValueOnce(new Error("read lost"));
    await expect(
      t.actions.apply({
        previewId: preview.previewId,
        operationId: "read-failed",
      }),
    ).rejects.toMatchObject({
      effect: "unknown",
      verification: { status: "unavailable" },
    });
    expect(t.apply).toHaveBeenCalledOnce();
  });
  it("detects changes to an excluded heading", async () => {
    const t = setup(),
      preview = await t.actions.preview(request);
    t.read.mockResolvedValueOnce({
      ...table(),
      revision: "2",
      selectionKey: t.state.selectionKey,
      cells: table().cells.map((c) => ({
        ...c,
        text: c.row === 1 ? "corrupted" : c.text,
      })),
    });
    await expect(
      t.actions.apply({
        previewId: preview.previewId,
        operationId: "corruption",
      }),
    ).rejects.toMatchObject({
      verification: {
        status: "mismatch",
        differences: expect.arrayContaining([
          expect.objectContaining({ reason: "보존 대상 셀 변경" }),
        ]),
      },
    });
  });
  it("cannot mutate the private plan by changing the returned preview", async () => {
    const t = setup(),
      preview = await t.actions.preview(request);
    preview.changes[0]!.after = "tampered";
    await t.actions.apply({ previewId: preview.previewId, operationId: "one" });
    expect(t.apply).toHaveBeenCalledOnce();
    expect(
      (
        t.apply.mock.calls[0] as unknown as [TableSnapshot, { after: string }[]]
      )[1][0]?.after,
    ).toBe("1,000");
  });
  it.each(["documentId", "sessionId", "revision", "selectionKey"] as const)(
    "rejects stale %s without writing",
    async (key) => {
      const t = setup(),
        p = await t.actions.preview(request);
      t.state[key] = "changed";
      await expect(
        t.actions.apply({ previewId: p.previewId, operationId: "one" }),
      ).rejects.toBeInstanceOf(
        key === "selectionKey" ? SelectionConflictError : SaveConflictError,
      );
      expect(t.apply).not.toHaveBeenCalled();
    },
  );
  it("replays concurrent and completed operation IDs once, never accepts reuse for another preview", async () => {
    const t = setup(),
      p = await t.actions.preview(request),
      input = { previewId: p.previewId, operationId: "one" };
    const [a, b] = await Promise.all([
      t.actions.apply(input),
      t.actions.apply(input),
    ]);
    expect(a).toEqual(b);
    expect(await t.actions.apply(input)).toEqual(a);
    expect(t.apply).toHaveBeenCalledOnce();
    await expect(
      t.actions.apply({ ...input, previewId: "other" }),
    ).rejects.toThrow(/작업 ID/);
  });
  it("never retries an unknown write outcome", async () => {
    const t = setup();
    t.apply.mockRejectedValue(new TableEditError("lost response", "unknown"));
    const p = await t.actions.preview(request),
      input = { previewId: p.previewId, operationId: "one" };
    await expect(t.actions.apply(input)).rejects.toMatchObject({
      effect: "unknown",
    });
    await expect(t.actions.apply(input)).rejects.toMatchObject({
      effect: "unknown",
    });
    await expect(
      t.actions.apply({ ...input, operationId: "different-id" }),
    ).rejects.toThrow(/만료/);
    expect(t.apply).toHaveBeenCalledOnce();
  });
  it("a no-op produces no undo entry and no write", async () => {
    const t = setup(),
      p = await t.actions.preview({ ...request, columnKind: "identifier" });
    expect(
      await t.actions.apply({ previewId: p.previewId, operationId: "one" }),
    ).toMatchObject({ changedCells: 0, undoSteps: 0, committed: false });
    expect(t.apply).not.toHaveBeenCalled();
  });
  it("reports unexpected engine failures as unknown and does not repeat the write", async () => {
    const t = setup();
    t.apply.mockRejectedValue(new Error("native failure"));
    const p = await t.actions.preview(request),
      input = { previewId: p.previewId, operationId: "unexpected" };
    await expect(t.actions.apply(input)).rejects.toMatchObject({
      effect: "unknown",
      cause: new Error("native failure"),
    });
    await expect(t.actions.apply(input)).rejects.toMatchObject({
      effect: "unknown",
    });
    expect(t.apply).toHaveBeenCalledOnce();
  });
  it("reports an unavailable post-write session as an unknown outcome", async () => {
    let available = true;
    const t = setup(),
      actions = createTableColumnEditor({
        state: () => {
          if (!available) throw new SaveConflictError("closed");
          return t.state;
        },
        read: t.read,
        apply: async () => {
          available = false;
        },
      });
    const p = await actions.preview(request);
    await expect(
      actions.apply({ previewId: p.previewId, operationId: "closed" }),
    ).rejects.toMatchObject({ effect: "unknown" });
  });
  it("cancels a read completed after the document changed", async () => {
    const t = setup();
    let resolve!: (value: TableSnapshot) => void;
    t.read.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const pending = t.actions.preview(request);
    t.state.sessionId = "new";
    resolve(table());
    await expect(pending).rejects.toBeInstanceOf(SaveConflictError);
  });
});
