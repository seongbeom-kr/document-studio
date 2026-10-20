import type { Editor } from "@docx-editor.dev/react";
import type { DocxEditorInstance } from "@docx-editor.dev/core/editor";
import type { OoxmlNode } from "@docx-editor.dev/core/store";
import {
  SaveConflictError,
  SelectionConflictError,
  TableEditError,
  TableReadError,
  validateTableChanges,
  type TableSnapshot,
  type TableCellChange,
} from "@document-studio/core";
import { docxSelectionKey } from "./selection";

const children = (node: OoxmlNode) => ("children" in node ? node.children : []);
const named = (node: OoxmlNode, name: string) =>
  children(node).filter((n) => "localName" in n && n.localName === name);
const attr = (node: OoxmlNode | undefined, name: string) =>
  node && "attributes" in node
    ? node.attributes.find((a) => a.localName === name)?.value
    : undefined;
const textOf = (node: OoxmlNode): string =>
  node.kind === "textValue" ? node.value : children(node).map(textOf).join("");
const signature = (node: OoxmlNode | undefined): string =>
  !node
    ? ""
    : JSON.stringify(node, (key, value) => (key === "id" ? undefined : value));
export function createDocxTableColumn(editor: Editor) {
  const cache = new Map<
    string,
    { table: TableSnapshot; paragraphs: Map<string, string> }
  >();
  const instance = editor as DocxEditorInstance;
  const read = async (): Promise<TableSnapshot> => {
    const surface = instance.surface;
    if (!surface) throw new TableEditError("편집기를 준비해 주세요.", "none");
    surface.flushPendingInput();
    const scope = surface.storyScope(),
      part = surface.session.partFor(scope),
      selected = editor.getSelectedTable();
    if (scope.kind !== "body" || !part || !selected)
      throw new TableReadError(
        "본문 표 안의 셀을 선택해 주세요.",
        "table-cell-required",
      );
    if (selected.columnCount > 50)
      throw new TableReadError(
        "표 크기 제한을 넘었습니다.",
        "table-limit-exceeded",
      );
    let tableNode: OoxmlNode | undefined,
      nested = false,
      ordinal = 0,
      selectedOrdinal = 0;
    const visit = (node: OoxmlNode, inTable = false) => {
      const table = "localName" in node && node.localName === "tbl";
      if (table) ordinal++;
      if (node.id === selected.blockId) {
        tableNode = node;
        nested = inTable;
        selectedOrdinal = ordinal;
      }
      for (const child of children(node)) visit(child, inTable || table);
    };
    visit(part.root);
    if (!tableNode || nested)
      throw new TableReadError(
        "중첩 표는 열 일괄 편집을 지원하지 않습니다.",
        "table-structure-unsupported",
      );
    const tableId = crypto.randomUUID(),
      paragraphs = new Map<string, string>();
    const table: TableSnapshot = {
      tableId,
      label: `본문 ${selectedOrdinal}번 표 (${selected.rowCount}행 × ${selected.columnCount}열)`,
      revision: String(editor.getDocumentHandle().revision),
      selectionKey: docxSelectionKey(editor),
      rows: selected.rowCount,
      columns: selected.columnCount,
      selectedColumn: (selected.cell?.column ?? 0) + 1,
      cells: [],
    };
    const cells: TableSnapshot["cells"][number][] = [];
    for (const [rowIndex, row] of named(tableNode, "tr").entries()) {
      const rowProps = named(row, "trPr")[0];
      if (
        rowProps &&
        (named(rowProps, "gridBefore").length ||
          named(rowProps, "gridAfter").length)
      )
        throw new TableEditError(
          "빈 격자 칸이 있는 표는 열 일괄 편집을 지원하지 않습니다.",
          "none",
        );
      let column = 1;
      for (const cell of named(row, "tc")) {
        const props = named(cell, "tcPr")[0];
        const span = Number(
          attr(props && named(props, "gridSpan")[0], "val") ?? 1,
        );
        if (!Number.isInteger(span) || span < 1 || span > 50)
          throw new TableEditError(
            "표의 열 범위를 확인할 수 없습니다.",
            "none",
          );
        const merged =
          span !== 1 || Boolean(props && named(props, "vMerge").length);
        const ps = named(cell, "p"),
          p = ps[0],
          runs = p ? named(p, "r") : [];
        const ordinary =
          p &&
          children(p).every(
            (n) => "localName" in n && ["pPr", "r"].includes(n.localName),
          ) &&
          runs.every((r) =>
            children(r).every(
              (n) => "localName" in n && ["rPr", "t"].includes(n.localName),
            ),
          );
        const signatures = new Set(
          runs
            .filter((r) => named(r, "t").some((t) => textOf(t)))
            .map((r) => signature(named(r, "rPr")[0])),
        );
        const text = ps.map(textOf).join("\n");
        const reason = merged
          ? "병합 셀 제외"
          : ps.length !== 1 || named(cell, "tbl").length
            ? "여러 문단·중첩 표 셀 제외"
            : !ordinary
              ? "그림·필드·수식·특수 요소가 있는 셀 제외"
              : signatures.size > 1
                ? "글자 서식이 혼합된 셀 제외"
                : text.length > 10000
                  ? "셀 길이 제한 초과"
                  : undefined;
        const id = `${tableId}:${cells.length}`;
        cells.push({
          id,
          row: rowIndex + 1,
          column,
          rowSpan: props && named(props, "vMerge").length ? 2 : 1,
          columnSpan: span,
          text,
          editable: !reason,
          reason,
        });
        if (p) paragraphs.set(id, p.id);
        column += span;
      }
    }
    if (
      cells.length > 2000 ||
      cells.reduce((n, c) => n + c.text.length, 0) > 1_000_000
    )
      throw new TableEditError("표 크기 제한을 넘었습니다.", "none");
    table.cells = cells;
    if (cache.size >= 12) cache.delete(cache.keys().next().value!);
    cache.set(tableId, { table, paragraphs });
    return structuredClone(table);
  };
  return {
    read,
    async apply(
      table: TableSnapshot,
      changes: readonly TableCellChange[],
      assertCurrent: () => void,
    ) {
      const cached = cache.get(table.tableId),
        surface = instance.surface;
      if (!cached || !surface)
        throw new TableEditError("표 미리보기가 만료됐습니다.", "none");
      surface.flushPendingInput();
      assertCurrent();
      if (table.revision !== String(editor.getDocumentHandle().revision))
        throw new SaveConflictError("표 미리보기 이후 문서가 변경됐습니다.");
      if (table.selectionKey !== docxSelectionKey(editor))
        throw new SelectionConflictError();
      validateTableChanges(cached.table, changes);
      type Op = Parameters<typeof surface.session.applyTreeOps>[0][number];
      const ops: Op[] = [];
      for (const change of changes) {
        const paragraphId = cached.paragraphs.get(change.cellId)!;
        // Insert into the existing first run before deleting old text, preserving its authored font.
        if (change.after)
          ops.push({
            op: "insertText",
            paragraphId,
            offset: 0,
            text: change.after,
            bias: "right",
          });
        if (change.before)
          ops.push({
            op: "deleteText",
            paragraphId,
            start: change.after.length,
            end: change.after.length + change.before.length,
          });
      }
      const result = surface.applyAutomationOps(() => {
        assertCurrent();
        return ops;
      }, surface.storyScope());
      if (result.rejected)
        throw new TableEditError(
          String(
            result.reason ?? "표 변경이 거절됐습니다. 적용된 셀이 없습니다.",
          ),
          "none",
        );
      editor.focus();
    },
  };
}
