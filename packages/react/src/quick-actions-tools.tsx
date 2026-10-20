import { useRef, useState } from "react";
import {
  officeClock,
  OFFICE_DATE_ACTIONS,
  describeQuickCommands,
  type OfficeDateRequest,
  type QuickActionPreview,
  type EditorSnapshot,
  type createQuickActionEditor,
} from "@document-studio/core";

export function QuickActionTools({
  actions,
  snapshot,
  disabled,
  readOnly,
}: {
  actions: ReturnType<typeof createQuickActionEditor>;
  snapshot: EditorSnapshot;
  disabled: boolean;
  readOnly?: boolean;
}) {
  const [clock] = useState(() => officeClock());
  const [baseDate, setBaseDate] = useState(clock.baseDate),
    [week, setWeek] = useState<OfficeDateRequest["week"]>("workweek"),
    [format, setFormat] = useState<OfficeDateRequest["format"]>("official");
  const [preview, setPreview] = useState<QuickActionPreview | null>(null),
    [notice, setNotice] = useState(""),
    [pending, setPending] = useState(false);
  const running = useRef(false);
  const [pasteText, setPasteText] = useState("");
  const stale =
    !!preview &&
    (preview.revision !== snapshot.revision ||
      preview.selectionKey !== snapshot.selectionKey);
  const choose = (task: () => QuickActionPreview) => {
    setNotice("");
    try {
      setPreview(task());
    } catch (error) {
      setPreview(null);
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };
  const enabled = snapshot.ready && !disabled && !pending;
  return (
    <section className="ds-quick-actions ds-tools-panel" aria-label="빠른 작업">
      <p>작업을 선택하면 적용 대상과 결과를 먼저 보여줍니다.</p>
      <fieldset disabled={!enabled}>
        <legend>날짜와 기간</legend>
        <div className="ds-tools-row">
          <label>
            기준일
            <input
              type="date"
              aria-label="빠른 작업 기준일"
              value={baseDate}
              onChange={(e) => {
                setBaseDate(e.target.value);
                setPreview(null);
              }}
            />
          </label>
          <button
            type="button"
            className="ds-button"
            onClick={() => {
              setBaseDate(officeClock(clock.timeZone).baseDate);
              setPreview(null);
            }}
          >
            오늘로 갱신
          </button>
          <label>
            주간 범위
            <select
              aria-label="빠른 작업 주간 범위"
              value={week}
              onChange={(e) => {
                setWeek(e.target.value as typeof week);
                setPreview(null);
              }}
            >
              <option value="workweek">월~금</option>
              <option value="calendar">월~일</option>
            </select>
          </label>
          <label>
            날짜 표시
            <select
              aria-label="빠른 작업 날짜 표시"
              value={format}
              onChange={(e) => {
                setFormat(e.target.value as typeof format);
                setPreview(null);
              }}
            >
              <option value="official">공문 날짜·요일</option>
              <option value="iso">YYYY-MM-DD</option>
              <option value="compact">YYYYMMDD</option>
            </select>
          </label>
        </div>
        <p className="ds-muted">
          오늘의 기준 시간대: {clock.timeZone}. 주간 범위는 공휴일을 따로
          제외하지 않습니다.
        </p>
        <div className="ds-quick-buttons">
          {OFFICE_DATE_ACTIONS.map((action) => (
            <button
              key={action.id}
              type="button"
              className="ds-button"
              onClick={() =>
                choose(() =>
                  actions.preview({
                    kind: "date",
                    baseDate,
                    period: action.id,
                    week,
                    format,
                  }),
                )
              }
            >
              {action.label}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset disabled={!enabled}>
        <legend>자주 쓰는 서식</legend>
        <div className="ds-quick-buttons">
          {actions.list().presets.map((preset) => (
            <button
              type="button"
              className="ds-button"
              key={preset.id}
              title={preset.description}
              onClick={() =>
                choose(() =>
                  actions.preview({ kind: "preset", presetId: preset.id }),
                )
              }
            >
              {preset.name}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset disabled={!enabled}>
        <legend>붙여넣기 원고 정리</legend>
        <label>
          원고
          <textarea
            aria-label="정리할 붙여넣기 원고"
            rows={4}
            maxLength={10000}
            value={pasteText}
            onChange={(event) => {
              setPasteText(event.target.value);
              setPreview(null);
            }}
          />
        </label>
        <p className="ds-muted">
          보이지 않는 공백과 AI 인용 흔적을 확인합니다. 정리한 원고는 일반
          텍스트로 삽입하며 기존 선택 내용은 대체됩니다.
        </p>
        <button
          type="button"
          className="ds-button"
          disabled={!pasteText.trim()}
          onClick={() =>
            choose(() =>
              actions.preview({ kind: "cleanPaste", text: pasteText }),
            )
          }
        >
          원고 정리 미리보기
        </button>
      </fieldset>
      {preview && (
        <div className="ds-quick-preview" aria-label="빠른 작업 미리보기">
          <strong>{preview.label}</strong>
          <p>{preview.description}</p>
          <p>적용 대상: {preview.target}</p>
          {preview.cleanup && (
            <details open>
              <summary>바뀌는 줄 {preview.cleanup.changes.length}개</summary>
              {preview.cleanup.changes.map((change) => (
                <div key={change.line}>
                  <strong>{change.line}행</strong>
                  <p>
                    변경 전: <code>{change.before}</code>
                  </p>
                  <p>
                    변경 후: <code>{change.after}</code>
                  </p>
                </div>
              ))}
            </details>
          )}
          {preview.selection && (
            <p>
              {preview.selection.mode === "insert"
                ? "커서 위치에 삽입"
                : `선택한 내용 교체${preview.selection.length !== undefined ? ` · ${preview.selection.length}자` : ""}`}
              {preview.selection.excerpt
                ? `: “${preview.selection.excerpt}”`
                : ""}
            </p>
          )}
          {preview.text !== undefined ? (
            <output>{preview.text}</output>
          ) : (
            <ul>
              {describeQuickCommands(preview.commands).map((text, i) => (
                <li key={i}>{text}</li>
              ))}
            </ul>
          )}
          {preview.text !== undefined && (
            <p>커서 위치에 입력합니다. 선택한 텍스트가 있으면 대체합니다.</p>
          )}
          {stale && (
            <p role="status">
              문서 또는 선택 범위가 바뀌었습니다. 작업을 다시 선택해 주세요.
            </p>
          )}
          <button
            type="button"
            className="ds-button"
            disabled={!enabled || readOnly || stale}
            onClick={() => {
              if (running.current) return;
              running.current = true;
              setPending(true);
              setNotice("");
              void actions
                .apply({
                  previewId: preview.previewId,
                  operationId: `quick-ui:${preview.previewId}`,
                })
                .then(
                  (result) => {
                    setPreview(null);
                    setNotice(
                      result.undoSteps
                        ? "적용했습니다. 한 번 되돌릴 수 있으며 파일 저장은 별도입니다."
                        : "추가로 변경된 내용이 없습니다.",
                    );
                  },
                  (error) => {
                    setPreview(null);
                    setNotice(
                      error instanceof Error ? error.message : String(error),
                    );
                  },
                )
                .finally(() => {
                  running.current = false;
                  setPending(false);
                });
            }}
          >
            확인한 빠른 작업 적용
          </button>
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
