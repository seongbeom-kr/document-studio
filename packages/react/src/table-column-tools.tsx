import { useRef, useState } from "react";
import {
  TableEditError,
  type EditorSnapshot,
  type TableColumnPreview,
  type TableColumnRequest,
  type TableColumnOperation,
  type TableSnapshot,
  type createTableColumnEditor,
} from "@document-studio/core";

type Actions = ReturnType<typeof createTableColumnEditor>;
export function TableColumnTools({
  actions,
  snapshot,
  disabled,
  readOnly,
}: {
  actions: Actions;
  snapshot: EditorSnapshot;
  disabled: boolean;
  readOnly?: boolean;
}) {
  const [table, setTable] = useState<TableSnapshot | null>(null),
    [column, setColumn] = useState(1),
    [kind, setKind] = useState<TableColumnRequest["columnKind"]>("unknown"),
    [header, setHeader] = useState(true);
  const [operation, setOperation] =
      useState<TableColumnOperation["kind"]>("commas"),
    [find, setFind] = useState(""),
    [replacement, setReplacement] = useState(""),
    [affix, setAffix] = useState("");
  const [preview, setPreview] = useState<TableColumnPreview | null>(null),
    [pending, setPending] = useState(false),
    [notice, setNotice] = useState("");
  const applying = useRef(false);
  // The parent keys this component by the editing session; late responses must not update another session.
  const sequence = useRef(0);
  const stale =
    !!table &&
    (table.revision !== snapshot.revision ||
      table.selectionKey !== snapshot.selectionKey);
  const invalidate = () => {
    sequence.current++;
    setPreview(null);
    setNotice("");
  };
  const run = async (task: () => Promise<void>) => {
    if (applying.current) return;
    applying.current = true;
    setPending(true);
    setNotice("");
    try {
      await task();
    } catch (error) {
      const effect = error instanceof TableEditError ? error.effect : undefined;
      setNotice(
        (error instanceof Error ? error.message : String(error)) +
          (effect === "rolled-back"
            ? " 변경은 모두 되돌렸습니다."
            : effect === "unknown"
              ? " 일부 적용됐을 수 있습니다. 문서를 확인한 뒤 되돌리기 또는 새 미리보기를 사용하세요."
              : ""),
      );
      setPreview(null);
    } finally {
      applying.current = false;
      setPending(false);
    }
  };
  return (
    <section className="ds-table-column" aria-label="표 열 일괄 편집">
      <strong>표 열 일괄 편집</strong>
      {pending && <p role="status">표 작업을 처리 중입니다.</p>}
      <p>한 열의 값만 바꿉니다. 변경될 셀과 제외 사유를 먼저 확인하세요.</p>
      {!snapshot.table && (
        <p className="ds-muted">표 안의 셀을 먼저 선택하세요.</p>
      )}
      {snapshot.ready && snapshot.table && !snapshot.tableColumnEditing && (
        <p className="ds-muted">
          현재 편집 엔진은 표 열 일괄 편집을 지원하지 않습니다.
        </p>
      )}
      <button
        type="button"
        className="ds-button"
        disabled={
          disabled || pending || !snapshot.table || !snapshot.tableColumnEditing
        }
        onClick={() =>
          void run(async () => {
            const value = await actions.read();
            setTable(value);
            setColumn(value.selectedColumn);
            setKind("unknown");
            setPreview(null);
            sequence.current++;
          })
        }
      >
        선택한 표 읽기
      </button>
      {table && (
        <>
          <p>
            <strong>{table.label}</strong>
          </p>
          {stale && (
            <p role="status">
              문서 또는 선택 범위가 바뀌었습니다. 표를 다시 읽어 주세요.
            </p>
          )}
          <div className="ds-tools-row">
            <label>
              대상 열
              <select
                aria-label="대상 열"
                value={column}
                disabled={pending}
                onChange={(e) => {
                  setColumn(Number(e.target.value));
                  invalidate();
                }}
              >
                {Array.from({ length: table.columns }, (_, i) => (
                  <option key={i} value={i + 1}>
                    {i + 1}열
                    {header
                      ? ` · ${table.cells.find((c) => c.row === 1 && c.column === i + 1)?.text ?? "제목 없음"}`
                      : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              열의 자료 종류
              <select
                aria-label="열의 자료 종류"
                value={kind}
                disabled={pending}
                onChange={(e) => {
                  setKind(e.target.value as typeof kind);
                  invalidate();
                }}
              >
                <option value="unknown">미확인</option>
                <option value="number">숫자 (금액·수량)</option>
                <option value="text">일반 문자열</option>
                <option value="identifier">식별자 (보호)</option>
                <option value="date">날짜 (보호)</option>
              </select>
            </label>
          </div>
          <label className="ds-check">
            <input
              type="checkbox"
              checked={header}
              disabled={pending}
              onChange={(e) => {
                setHeader(e.target.checked);
                invalidate();
              }}
            />
            첫 행은 제목으로 제외
          </label>
          <div className="ds-tools-row">
            <label>
              처리
              <select
                aria-label="열 처리 방식"
                disabled={pending}
                value={operation}
                onChange={(e) => {
                  setOperation(e.target.value as typeof operation);
                  invalidate();
                }}
              >
                <option value="commas">숫자 쉼표</option>
                <option value="replace">문자열 치환</option>
                <option value="prefix">앞에 문구 붙이기</option>
                <option value="suffix">뒤에 문구 붙이기</option>
                <option value="trim">앞뒤 공백 제거</option>
                <option value="collapseSpaces">연속 공백 정리</option>
              </select>
            </label>
          </div>
          {operation === "replace" && (
            <div className="ds-tools-row">
              <label>
                찾을 문자열
                <input
                  aria-label="열에서 찾을 문자열"
                  value={find}
                  disabled={pending}
                  onChange={(e) => {
                    setFind(e.target.value);
                    invalidate();
                  }}
                />
              </label>
              <label>
                바꿀 문자열
                <input
                  aria-label="열에서 바꿀 문자열"
                  value={replacement}
                  disabled={pending}
                  onChange={(e) => {
                    setReplacement(e.target.value);
                    invalidate();
                  }}
                />
              </label>
            </div>
          )}
          {(operation === "prefix" || operation === "suffix") && (
            <label>
              붙일 문구
              <input
                aria-label="열에 붙일 문구"
                value={affix}
                disabled={pending}
                onChange={(e) => {
                  setAffix(e.target.value);
                  invalidate();
                }}
              />
            </label>
          )}
          <p className="ds-muted">
            날짜·식별자 헤더, 앞자리 0, 긴 숫자 번호는 보호합니다. 치환은
            대소문자를 구분하며 입력한 문자열 그대로 찾습니다.
          </p>
          <button
            type="button"
            className="ds-button"
            disabled={disabled || pending || stale}
            onClick={() =>
              void run(async () => {
                const ticket = ++sequence.current;
                const value = await actions.preview({
                  column,
                  columnKind: kind,
                  headerRows: header ? 1 : 0,
                  operation:
                    operation === "replace"
                      ? { kind: "replace", find, replacement }
                      : operation === "prefix" || operation === "suffix"
                        ? { kind: operation, text: affix }
                        : { kind: operation },
                });
                if (ticket === sequence.current) setPreview(value);
              })
            }
          >
            열 변경 미리보기
          </button>
        </>
      )}
      {preview && !stale && (
        <div className="ds-table-preview">
          <p>
            <strong>
              {preview.tableLabel} · {preview.column}열
              {preview.header ? ` (${preview.header})` : ""}
            </strong>
          </p>
          <p role="status">
            변경 {preview.changes.length}개 · 제외 {preview.excluded.length}개 ·
            그대로 {preview.unchanged}개
          </p>
          {!!preview.changes.length && (
            <table aria-label="바뀔 셀">
              <thead>
                <tr>
                  <th>위치</th>
                  <th>변경 전</th>
                  <th>변경 후</th>
                </tr>
              </thead>
              <tbody>
                {preview.changes.map((c) => (
                  <tr key={c.cellId}>
                    <th>
                      {c.row}행 {c.column}열
                    </th>
                    <td>{c.before}</td>
                    <td>{c.after || "(빈 값)"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!!preview.excluded.length && (
            <details open>
              <summary>제외된 셀 {preview.excluded.length}개</summary>
              <table aria-label="제외된 셀">
                <thead>
                  <tr>
                    <th>위치</th>
                    <th>값</th>
                    <th>이유</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.excluded.map((c) => (
                    <tr key={c.cellId}>
                      <th>
                        {c.row}행 {c.column}열
                      </th>
                      <td>{c.value}</td>
                      <td>{c.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
          <button
            type="button"
            className="ds-button"
            disabled={
              disabled || pending || readOnly || !preview.changes.length
            }
            onClick={() =>
              void run(async () => {
                const result = await actions.apply({
                  previewId: preview.previewId,
                  operationId: `table-ui:${preview.previewId}`,
                });
                setPreview(null);
                setTable(null);
                setNotice(
                  `${result.changedCells}개 셀을 적용했습니다. 한 번의 되돌리기로 취소할 수 있습니다. 파일 저장은 별도입니다.`,
                );
              })
            }
          >
            확인한 {preview.changes.length}개 셀 적용
          </button>
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
