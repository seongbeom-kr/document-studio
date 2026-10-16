import { unzipSync, strFromU8 } from "fflate";
import {
  SaveConflictError,
  SelectionConflictError,
  TableEditError,
  validateTableChanges,
  type TableSnapshot,
  type TableCellChange,
} from "@document-studio/core";

export interface RhwpTableSnapshot extends TableSnapshot {
  location: { section: number; paragraph: number; control: number };
}
const direct = (node: Element, name: string) =>
  Array.from(node.children).filter((n) => n.localName === name);
/** Cross-check native coordinates against saved HWPX structure; exclude unsupported rich cells. */
export function inspectRhwpTable(
  table: RhwpTableSnapshot,
  bytes: Uint8Array,
): TableSnapshot {
  const parts = unzipSync(bytes),
    source = parts[`Contents/section${table.location.section}.xml`];
  if (!source)
    throw new TableEditError("표 구역을 확인하지 못했습니다.", "none");
  const doc = new DOMParser().parseFromString(
    strFromU8(source),
    "application/xml",
  );
  const paragraph = direct(doc.documentElement, "p")[table.location.paragraph];
  if (!paragraph || doc.querySelector("parsererror"))
    throw new TableEditError("표 문단을 확인하지 못했습니다.", "none");
  const tables = Array.from(
    paragraph.getElementsByTagNameNS("*", "tbl"),
  ).filter((t) => {
    let parent = t.parentElement;
    while (parent && parent !== paragraph) {
      if (parent.localName === "tbl" || parent.localName === "p") return false;
      parent = parent.parentElement;
    }
    return parent === paragraph;
  });
  if (tables.length !== 1)
    throw new TableEditError(
      "같은 문단의 복수 표는 열 일괄 편집을 지원하지 않습니다.",
      "none",
    );
  const nodes = direct(tables[0]!, "tr").flatMap((row) => direct(row, "tc"));
  if (nodes.length !== table.cells.length)
    throw new TableEditError("표 구조가 일치하지 않습니다.", "none");
  const cells = table.cells.map((cell) => {
    const candidates = nodes.filter((node) => {
      const address = direct(node, "cellAddr")[0];
      return (
        Number(address?.getAttribute("rowAddr")) === cell.row - 1 &&
        Number(address?.getAttribute("colAddr")) === cell.column - 1
      );
    });
    if (candidates.length !== 1)
      throw new TableEditError("셀 좌표가 중복되거나 변경됐습니다.", "none");
    const node = candidates[0]!,
      sub = direct(node, "subList")[0],
      ps = sub ? direct(sub, "p") : [],
      p = ps[0];
    const runs = p ? direct(p, "run") : [],
      text = ps
        .map((p) =>
          Array.from(p.getElementsByTagNameNS("*", "t"))
            .map((t) => t.textContent ?? "")
            .join(""),
        )
        .join("\n");
    const ordinary =
      p &&
      Array.from(p.children).every((n) =>
        ["run", "linesegarray"].includes(n.localName),
      ) &&
      runs.every((r) =>
        Array.from(r.children).every(
          (t) => t.localName === "t" && t.children.length === 0,
        ),
      );
    const shapes = new Set(
      runs
        .filter((r) => r.textContent)
        .map((r) => r.getAttribute("charPrIDRef")),
    );
    const reason =
      cell.reason ??
      (ps.length !== 1
        ? "여러 문단·중첩 표 셀 제외"
        : !ordinary
          ? "그림·필드·수식·특수 요소가 있는 셀 제외"
          : shapes.size > 1
            ? "글자 서식이 혼합된 셀 제외"
            : text !== cell.text
              ? "셀 텍스트 좌표를 확인할 수 없습니다"
              : undefined);
    return { ...cell, editable: !reason, reason };
  });
  return { ...table, cells };
}
export function createRhwpTableColumn(port: {
  rpc<T>(method: string, params: Record<string, unknown>): Promise<T>;
  exportBytes(): Promise<Uint8Array>;
  state(): { revision: string; selectionKey?: string };
  update(): Promise<void>;
}) {
  const cache = new Map<string, TableSnapshot>();
  return {
    async read(): Promise<TableSnapshot> {
      await port.update();
      const raw = await port.rpc<RhwpTableSnapshot>("readTable", {});
      const table = inspectRhwpTable(raw, await port.exportBytes());
      await port.update();
      if (
        port.state().revision !== table.revision ||
        port.state().selectionKey !== table.selectionKey
      )
        throw new SaveConflictError("표를 읽는 동안 문서가 변경됐습니다.");
      if (cache.size >= 12) cache.delete(cache.keys().next().value!);
      cache.set(table.tableId, table);
      return structuredClone(table);
    },
    async apply(
      table: TableSnapshot,
      changes: readonly TableCellChange[],
      assertCurrent: () => void,
    ) {
      const original = cache.get(table.tableId);
      if (!original)
        throw new TableEditError("표 미리보기가 만료됐습니다.", "none");
      validateTableChanges(original, changes);
      await port.update();
      assertCurrent();
      if (port.state().revision !== table.revision)
        throw new SaveConflictError("표 미리보기 이후 문서가 변경됐습니다.");
      if (port.state().selectionKey !== table.selectionKey)
        throw new SelectionConflictError();
      try {
        await port.rpc("applyTableChanges", {
          tableId: table.tableId,
          changes,
          expectedRevision: table.revision,
          expectedSelectionKey: table.selectionKey,
        });
        await port.update();
      } catch (cause) {
        if (
          cause instanceof TableEditError ||
          cause instanceof SaveConflictError ||
          cause instanceof SelectionConflictError
        )
          throw cause;
        throw new TableEditError(
          "표 적용 결과를 확인하지 못했습니다. 현재 문서를 확인하고 같은 작업을 반복하지 마세요.",
          "unknown",
          { cause },
        );
      }
    },
  };
}
