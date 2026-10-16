import { SaveConflictError } from "./index";
import { SelectionConflictError } from "./selection-conflict";

export interface TableCell {
  id: string;
  /** All public row/column coordinates are one-based. */
  row: number;
  column: number;
  rowSpan: number;
  columnSpan: number;
  text: string;
  editable: boolean;
  reason?: string;
}
export interface TableSnapshot {
  tableId: string;
  label: string;
  revision: string;
  selectionKey: string;
  rows: number;
  columns: number;
  selectedColumn: number;
  cells: readonly TableCell[];
}
export interface TableEditIdentity {
  documentId: string;
  sessionId: string;
  revision: string;
  selectionKey?: string;
}
export type TableColumnOperation =
  | { kind: "commas" }
  | { kind: "replace"; find: string; replacement: string }
  | { kind: "prefix" | "suffix"; text: string }
  | { kind: "trim" | "collapseSpaces" };
export interface TableColumnRequest {
  column: number;
  /** Explicit semantic choice. A numeric-looking string alone is never sufficient. */
  columnKind: "unknown" | "number" | "text" | "identifier" | "date";
  headerRows: 0 | 1;
  operation: TableColumnOperation;
}
export interface TableCellChange {
  cellId: string;
  row: number;
  column: number;
  before: string;
  after: string;
}
export interface TableColumnPreview extends TableEditIdentity {
  previewId: string;
  tableId: string;
  tableLabel: string;
  column: number;
  header: string;
  request: TableColumnRequest;
  changes: readonly TableCellChange[];
  excluded: readonly {
    cellId: string;
    row: number;
    column: number;
    value: string;
    reason: string;
  }[];
  unchanged: number;
  selected: number;
}
export interface TableColumnReceipt extends TableEditIdentity {
  operationId: string;
  previewId: string;
  changedCells: number;
  committed: false;
  undoSteps: 0 | 1;
}
export class TableEditError extends Error {
  constructor(
    message: string,
    readonly effect: "none" | "rolled-back" | "unknown",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "TableEditError";
  }
}
export const TABLE_COLUMN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["column", "columnKind", "headerRows", "operation"],
  properties: {
    column: {
      type: "integer",
      minimum: 1,
      maximum: 50,
      description:
        "열 번호, 1부터 시작. readTable의 selectedColumn 또는 cells.column을 사용합니다.",
    },
    columnKind: {
      type: "string",
      enum: ["unknown", "number", "text", "identifier", "date"],
      description:
        "쉼표 처리는 금액·수량 등 실제 숫자 열로 확인한 경우에만 number. 사번·날짜는 보호됩니다.",
    },
    headerRows: { type: "integer", enum: [0, 1] },
    operation: {
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["kind"],
          properties: { kind: { enum: ["trim", "collapseSpaces"] } },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "text"],
          properties: {
            kind: { enum: ["prefix", "suffix"] },
            text: { type: "string", minLength: 1, maxLength: 1000 },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["kind"],
          properties: { kind: { const: "commas" } },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "find", "replacement"],
          properties: {
            kind: { const: "replace" },
            find: { type: "string", minLength: 1, maxLength: 1024 },
            replacement: { type: "string", maxLength: 10000 },
          },
        },
      ],
    },
  },
} as const;
const ownKeys = (value: object, keys: readonly string[]) =>
  Object.keys(value).every((key) => keys.includes(key));
export function validateTableColumnRequest(value: TableColumnRequest): void {
  if (
    !value ||
    !ownKeys(value, ["column", "columnKind", "headerRows", "operation"]) ||
    !Number.isInteger(value.column) ||
    value.column < 1 ||
    value.column > 50 ||
    !["unknown", "number", "text", "identifier", "date"].includes(
      value.columnKind,
    ) ||
    ![0, 1].includes(value.headerRows)
  )
    throw new TableEditError(
      "표 열·자료 종류·제목 행 설정이 올바르지 않습니다.",
      "none",
    );
  const op = value.operation;
  if (op && ["trim", "collapseSpaces"].includes(op.kind)) {
    if (!ownKeys(op, ["kind"]))
      throw new TableEditError("공백 처리 입력이 올바르지 않습니다.", "none");
    return;
  }
  if (op && (op.kind === "prefix" || op.kind === "suffix")) {
    if (
      !ownKeys(op, ["kind", "text"]) ||
      typeof op.text !== "string" ||
      !op.text.length ||
      op.text.length > 1000 ||
      /[\u0000-\u001f\u007f]/.test(op.text)
    )
      throw new TableEditError(
        "붙일 문구는 제어 문자가 없는 1~1,000자여야 합니다.",
        "none",
      );
    return;
  }
  if (
    !op ||
    typeof op !== "object" ||
    (op.kind === "commas"
      ? !ownKeys(op, ["kind"])
      : op.kind !== "replace" ||
        !ownKeys(op, ["kind", "find", "replacement"]) ||
        typeof op.find !== "string" ||
        !op.find.length ||
        op.find.length > 1024 ||
        typeof op.replacement !== "string" ||
        op.replacement.length > 10000 ||
        /[\u0000-\u001f\u007f]/.test(op.find + op.replacement))
  )
    throw new TableEditError(
      "치환할 문자열이 올바르지 않습니다. 줄바꿈·제어 문자는 지원하지 않습니다.",
      "none",
    );
}
const protectedHeader = (text: string) =>
  /사번|학번|주민|사업자|전화|연락처|우편|코드|번호|식별|일자|날짜|생년|\b(?:id|code|date|phone|zip)\b/i.test(
    text,
  );
function protectedValue(text: string): string | undefined {
  const value = text.trim();
  if (/^[+-]?0\d/.test(value)) return "앞자리 0이 있는 식별자 보호";
  if (
    /^\d{4}\s*[-/.]\s*\d{1,2}\s*[-/.]\s*\d{1,2}(?:\.?|[ T].*)$/.test(value) ||
    /^\d{1,4}(?:[-/]\d{1,4})+$/.test(value)
  )
    return "날짜·번호 형식 보호";
  if (/^(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])$/.test(value))
    return "8자리 날짜 형식 보호";
  if (/^\d{12,}$/.test(value)) return "긴 숫자 식별자 보호";
  return undefined;
}
/** Same deterministic plan is used by the human UI and agent. No document mutation here. */
export function planTableColumn(
  table: TableSnapshot,
  request: TableColumnRequest,
): Omit<TableColumnPreview, keyof TableEditIdentity | "previewId"> {
  validateTableColumnRequest(request);
  if (
    request.column > table.columns ||
    table.columns > 50 ||
    table.cells.length > 2000 ||
    table.cells.reduce((n, c) => n + c.text.length, 0) > 1_000_000
  )
    throw new TableEditError("표 범위 또는 크기 제한을 넘었습니다.", "none");
  const firstCell = table.cells.find(
    (c) =>
      c.row === 1 &&
      c.column <= request.column &&
      c.column + c.columnSpan > request.column,
  );
  const firstValue = firstCell?.text ?? "";
  const header = request.headerRows ? firstValue : "";
  const cells = table.cells.filter(
    (c) =>
      c.column <= request.column && c.column + c.columnSpan > request.column,
  );
  const changes: TableCellChange[] = [],
    excluded: TableColumnPreview["excluded"][number][] = [];
  let unchanged = 0;
  for (const cell of cells) {
    let reason =
      cell.row <= request.headerRows
        ? "제목 행 제외"
        : !cell.editable
          ? (cell.reason ?? "지원하지 않는 셀 구조")
          : cell.rowSpan !== 1 || cell.columnSpan !== 1
            ? "병합 셀 제외"
            : firstCell &&
                (firstCell.rowSpan !== 1 || firstCell.columnSpan !== 1)
              ? "병합된 제목 아래 열의 의미를 확인할 수 없습니다"
              : request.columnKind === "identifier" ||
                  request.columnKind === "date" ||
                  protectedHeader(firstValue)
                ? "식별자·날짜 열 보호"
                : protectedValue(cell.text);
    if (
      !reason &&
      request.operation.kind === "commas" &&
      request.columnKind !== "number"
    )
      reason = "숫자 열인지 확인이 필요합니다";
    let after = cell.text;
    if (!reason && request.operation.kind === "commas" && cell.text.trim()) {
      const value = cell.text.trim();
      if (!/^-?(?:0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)(?:\.\d+)?$/.test(value))
        reason = "일반 숫자 형식이 아닙니다";
      else {
        const [integer, fraction] = value.replaceAll(",", "").split(".");
        const formatted =
          integer!.replace(/\B(?=(\d{3})+(?!\d))/g, ",") +
          (fraction === undefined ? "" : `.${fraction}`);
        after =
          cell.text.slice(0, cell.text.length - cell.text.trimStart().length) +
          formatted +
          cell.text.slice(cell.text.trimEnd().length);
      }
    } else if (!reason && request.operation.kind === "replace")
      after = cell.text
        .split(request.operation.find)
        .join(request.operation.replacement);
    else if (!reason && request.operation.kind === "prefix")
      after = request.operation.text + cell.text;
    else if (!reason && request.operation.kind === "suffix")
      after = cell.text + request.operation.text;
    else if (!reason && request.operation.kind === "trim")
      after = cell.text.trim();
    else if (!reason && request.operation.kind === "collapseSpaces")
      after = cell.text.replace(/[ \u00a0\u3000]+/g, " ").trim();
    if (after.length > 10000) reason = "변경 후 셀 길이 제한 초과";
    if (reason)
      excluded.push({
        cellId: cell.id,
        row: cell.row,
        column: cell.column,
        value: cell.text,
        reason,
      });
    else if (after !== cell.text)
      changes.push({
        cellId: cell.id,
        row: cell.row,
        column: cell.column,
        before: cell.text,
        after,
      });
    else unchanged++;
  }
  if (changes.reduce((n, c) => n + c.after.length, 0) > 1_000_000)
    throw new TableEditError("변경 결과가 크기 제한을 넘었습니다.", "none");
  return {
    tableId: table.tableId,
    tableLabel: table.label,
    column: request.column,
    header,
    request: structuredClone(request),
    changes,
    excluded,
    unchanged,
    selected: cells.length,
  };
}
export function validateTableChanges(
  table: TableSnapshot,
  changes: readonly TableCellChange[],
): void {
  if (!Array.isArray(changes) || changes.length > 2000)
    throw new TableEditError("셀 변경 목록이 올바르지 않습니다.", "none");
  const ids = new Set<string>();
  for (const change of changes) {
    const cell = table.cells.find((c) => c.id === change.cellId);
    if (
      !cell ||
      !cell.editable ||
      cell.rowSpan !== 1 ||
      cell.columnSpan !== 1 ||
      ids.has(cell.id) ||
      cell.text !== change.before ||
      cell.row !== change.row ||
      cell.column !== change.column ||
      typeof change.after !== "string" ||
      change.after.length > 10000 ||
      /[\u0000-\u001f\u007f]/.test(change.after)
    )
      throw new TableEditError(
        "셀 대상 또는 미리보기 값이 변경됐습니다.",
        "none",
      );
    ids.add(cell.id);
  }
}
/** Private immutable previews, bounded replay receipts, and one shared mutation path. */
export function createTableColumnEditor(port: {
  state(): TableEditIdentity;
  read(): Promise<TableSnapshot>;
  apply(
    table: TableSnapshot,
    changes: readonly TableCellChange[],
  ): Promise<void>;
}) {
  const previews = new Map<
    string,
    { preview: TableColumnPreview; table: TableSnapshot }
  >();
  const operations = new Map<
    string,
    { previewId: string; task: Promise<TableColumnReceipt> }
  >();
  const check = (expected: TableEditIdentity) => {
    const state = port.state();
    if (
      state.documentId !== expected.documentId ||
      state.sessionId !== expected.sessionId ||
      state.revision !== expected.revision
    )
      throw new SaveConflictError(
        "미리보기 이후 문서가 변경됐습니다. 다시 미리보기해 주세요.",
      );
    if (state.selectionKey !== expected.selectionKey)
      throw new SelectionConflictError();
    return state;
  };
  const read = async () => {
    const identity = port.state(),
      table = await port.read();
    check(identity);
    if (
      identity.revision !== table.revision ||
      identity.selectionKey !== table.selectionKey
    )
      throw new SaveConflictError("표를 읽는 동안 대상이 변경됐습니다.");
    return {
      ...structuredClone(table),
      documentId: identity.documentId,
      sessionId: identity.sessionId,
    };
  };
  return {
    read,
    async preview(request: TableColumnRequest) {
      validateTableColumnRequest(request);
      const input = structuredClone(request),
        table = await read();
      const preview: TableColumnPreview = {
        ...planTableColumn(table, input),
        documentId: table.documentId,
        sessionId: table.sessionId,
        revision: table.revision,
        selectionKey: table.selectionKey,
        previewId: crypto.randomUUID(),
      };
      if (previews.size >= 8) previews.delete(previews.keys().next().value!);
      previews.set(preview.previewId, { preview, table });
      return structuredClone(preview);
    },
    async apply(input: {
      previewId: string;
      operationId: string;
    }): Promise<TableColumnReceipt> {
      if (
        !input ||
        !ownKeys(input, ["previewId", "operationId"]) ||
        typeof input.previewId !== "string" ||
        typeof input.operationId !== "string" ||
        !/^[a-zA-Z0-9._:-]{1,128}$/.test(input.operationId)
      )
        throw new TableEditError("표 적용 요청이 올바르지 않습니다.", "none");
      const { previewId, operationId } = input;
      const previous = operations.get(operationId);
      if (previous) {
        if (previous.previewId !== previewId)
          throw new TableEditError(
            "작업 ID가 다른 미리보기에 사용됐습니다.",
            "none",
          );
        const receipt = await previous.task,
          state = port.state();
        if (
          receipt.documentId !== state.documentId ||
          receipt.sessionId !== state.sessionId
        )
          throw new SaveConflictError("표 작업의 편집 세션이 변경됐습니다.");
        return structuredClone(receipt);
      }
      if (operations.size >= 128)
        throw new TableEditError("표 작업 기록 한도에 도달했습니다.", "none");
      const stored = previews.get(previewId);
      if (!stored)
        throw new TableEditError(
          "미리보기가 만료됐습니다. 다시 확인해 주세요.",
          "none",
        );
      check(stored.preview);
      // A new operation ID must never repeat a preview whose mutation outcome is uncertain.
      previews.delete(previewId);
      const task = (async () => {
        if (stored.preview.changes.length) {
          try {
            await port.apply(
              structuredClone(stored.table),
              structuredClone(stored.preview.changes),
            );
          } catch (cause) {
            if (
              cause instanceof TableEditError ||
              cause instanceof SaveConflictError ||
              cause instanceof SelectionConflictError
            )
              throw cause;
            throw new TableEditError(
              "표 적용 결과를 확인하지 못했습니다. 문서를 확인하고 같은 작업을 반복하지 마세요.",
              "unknown",
              { cause },
            );
          }
        }
        let state: TableEditIdentity;
        try {
          state = port.state();
        } catch (cause) {
          throw new TableEditError(
            "적용 후 문서 상태를 확인하지 못했습니다.",
            "unknown",
            { cause },
          );
        }
        if (
          state.documentId !== stored.preview.documentId ||
          state.sessionId !== stored.preview.sessionId
        )
          throw new TableEditError(
            "적용 후 문서가 전환돼 결과를 확인하지 못했습니다.",
            "unknown",
          );
        return {
          ...state,
          operationId,
          previewId,
          changedCells: stored.preview.changes.length,
          committed: false as const,
          undoSteps: stored.preview.changes.length
            ? (1 as const)
            : (0 as const),
        };
      })();
      operations.set(operationId, { previewId, task });
      return structuredClone(await task);
    },
  };
}
