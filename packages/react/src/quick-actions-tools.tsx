import { useId, useRef, useState, useSyncExternalStore } from "react";
import {
  officeClock,
  OFFICE_DATE_ACTIONS,
  describeQuickCommands,
  QUICK_ACTION_DRAFT_NAME,
  type OfficeDateRequest,
  type QuickActionPreview,
  type QuickActionRequest,
  type EditorSnapshot,
  type createQuickActionEditor,
} from "@document-studio/core";
import type { AutomationSession } from "./automation-session";
import { downloadAutomationDraft } from "./automation-drafts";
import {
  readQuickActionSettings,
  type QuickActionSettings,
} from "./quick-action-draft";

const ACTIONS = [
  ["date", "날짜·기간"],
  ["preset", "서식"],
  ["cleanPaste", "원고 정리"],
] as const;
const PRIMARY_DATES = new Set<OfficeDateRequest["period"]>([
  "today",
  "thisWeek",
  "nextWeek",
]);

function previewTarget(preview: QuickActionPreview): string {
  if (!preview.selection) return preview.target;
  const { mode, excerpt } = preview.selection;
  if (preview.request.kind === "preset") {
    return mode === "insert"
      ? "현재 문단에 서식 적용"
      : `선택한 범위에 서식 적용${excerpt ? ` · “${excerpt}”` : ""}`;
  }
  return mode === "insert"
    ? "커서 위치에 삽입"
    : `선택한 내용 교체${excerpt ? ` · “${excerpt}”` : ""}`;
}

export function QuickActionTools({
  actions,
  snapshot,
  disabled,
  readOnly,
  session,
}: {
  actions: ReturnType<typeof createQuickActionEditor>;
  snapshot: EditorSnapshot;
  disabled: boolean;
  readOnly?: boolean;
  session: AutomationSession;
}) {
  const [clock] = useState(() => officeClock());
  const status = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  );
  const draft = session.get(QUICK_ACTION_DRAFT_NAME);
  const defaults: QuickActionSettings = {
    baseDate: clock.baseDate,
    timeZone: clock.timeZone,
    week: "workweek",
    format: "official",
  };
  let settings = defaults;
  let settingsError = "";
  try {
    settings = readQuickActionSettings(draft.argument, defaults);
  } catch {
    settingsError =
      "보관한 날짜 설정을 읽지 못했습니다. 입력을 내려받은 뒤 날짜 설정을 초기화해 주세요.";
  }
  const { baseDate, week, format, timeZone } = settings;
  const pasteText = draft.input;
  const [kind, setKind] = useState<QuickActionRequest["kind"]>("date");
  const [moreDates, setMoreDates] = useState(false);
  const moreDatesId = useId();
  const [preview, setPreview] = useState<QuickActionPreview | null>(null);
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  const running = useRef(false);
  const previewTrigger = useRef<HTMLButtonElement>(null);
  const moreDatesButton = useRef<HTMLButtonElement>(null);
  const edit = (input: string, next = settings) => {
    session.put(
      QUICK_ACTION_DRAFT_NAME,
      {
        input,
        argument: JSON.stringify(next),
        transform: "trim",
        delimiter: "auto",
      },
      { activate: false },
    );
    setPreview(null);
    setNotice("");
  };
  const stale =
    !!preview &&
    (preview.revision !== snapshot.revision ||
      preview.selectionKey !== snapshot.selectionKey);
  const choose = (request: QuickActionRequest, trigger: HTMLButtonElement) => {
    setNotice("");
    try {
      setPreview(actions.preview(request));
      previewTrigger.current = trigger;
    } catch (error) {
      setPreview(null);
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };
  const enabled =
    snapshot.ready && !disabled && !pending && status.ready && !settingsError;
  const canApply = enabled && !readOnly && !stale;
  const apply = async (button: HTMLButtonElement) => {
    if (!preview || !canApply || running.current) return;
    running.current = true;
    setPending(true);
    setNotice("");
    try {
      const result = await actions.apply({
        previewId: preview.previewId,
        operationId: `quick-ui:${preview.previewId}`,
      });
      setNotice(
        result.undoSteps
          ? "적용했습니다. 한 번 되돌릴 수 있으며 파일 저장은 별도입니다."
          : "추가로 변경된 내용이 없습니다.",
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      const owner = button.ownerDocument;
      const trigger = previewTrigger.current;
      if (owner.activeElement === button && trigger) {
        owner.defaultView?.requestAnimationFrame(() => {
          if (
            !trigger.isConnected ||
            (owner.activeElement !== button &&
              owner.activeElement !== owner.body)
          )
            return;
          const target = trigger.closest("[hidden]")
            ? moreDatesButton.current
            : trigger;
          target?.focus();
        });
      }
      setPreview(null);
      running.current = false;
      setPending(false);
    }
  };

  const dateButton = (action: (typeof OFFICE_DATE_ACTIONS)[number]) => (
    <button
      key={action.id}
      type="button"
      className="ds-button"
      onClick={(event) =>
        choose(
          { kind: "date", baseDate, period: action.id, week, format },
          event.currentTarget,
        )
      }
    >
      {action.label}
    </button>
  );
  const presetDetails =
    preview?.request.kind === "preset"
      ? describeQuickCommands(preview.commands)
      : [];
  const cleanup = preview?.cleanup;
  let resultText = "";
  if (cleanup) {
    const firstLine = cleanup.after.trim().split(/\r?\n/, 1)[0] ?? "";
    const excerpt = Array.from(firstLine).slice(0, 72).join("");
    resultText = `바뀌는 줄 ${cleanup.changes.length}개 · ${excerpt}`;
  } else if (preview) {
    const [firstChange, ...remainingChanges] = presetDetails;
    const moreChanges =
      remainingChanges.length > 0 ? `외 ${remainingChanges.length}개 변경` : "";
    resultText =
      preview.text ??
      [preview.label, firstChange, moreChanges].filter(Boolean).join(" · ");
  }
  const target = preview ? previewTarget(preview) : "";
  const draftNotice =
    settingsError ||
    status.error ||
    (!status.ready ? "보관한 입력을 불러오는 중입니다." : "");

  return (
    <section className="ds-quick-actions" aria-label="빠른 작업">
      <div className="ds-quick-kinds" role="group" aria-label="빠른 작업 종류">
        {ACTIONS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            className="ds-button"
            aria-pressed={kind === value}
            disabled={pending}
            onClick={() => {
              if (kind === value) return;
              setKind(value);
              setMoreDates(false);
              setPreview(null);
              setNotice("");
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="ds-quick-body" key={kind}>
        {kind === "date" && (
          <fieldset disabled={!enabled}>
            <legend className="ds-sr-only">날짜와 기간</legend>
            <div className="ds-quick-buttons">
              {OFFICE_DATE_ACTIONS.filter((action) =>
                PRIMARY_DATES.has(action.id),
              ).map(dateButton)}
              <button
                ref={moreDatesButton}
                type="button"
                className="ds-button"
                aria-expanded={moreDates}
                aria-controls={moreDatesId}
                onClick={() => setMoreDates(!moreDates)}
              >
                더보기
              </button>
            </div>
            <div
              id={moreDatesId}
              hidden={!moreDates}
              className="ds-quick-options"
            >
              <div className="ds-quick-buttons">
                {OFFICE_DATE_ACTIONS.filter(
                  (action) => !PRIMARY_DATES.has(action.id),
                ).map(dateButton)}
              </div>
              <div className="ds-tools-row">
                <label>
                  기준일
                  <input
                    type="date"
                    aria-label="빠른 작업 기준일"
                    value={baseDate}
                    onChange={(event) =>
                      edit(pasteText, {
                        ...settings,
                        baseDate: event.target.value,
                      })
                    }
                  />
                </label>
                <button
                  type="button"
                  className="ds-button"
                  onClick={() =>
                    edit(pasteText, {
                      ...settings,
                      baseDate: officeClock(timeZone).baseDate,
                    })
                  }
                >
                  오늘로 갱신
                </button>
                <label>
                  주간 범위
                  <select
                    aria-label="빠른 작업 주간 범위"
                    value={week}
                    onChange={(event) =>
                      edit(pasteText, {
                        ...settings,
                        week: event.target.value as typeof week,
                      })
                    }
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
                    onChange={(event) =>
                      edit(pasteText, {
                        ...settings,
                        format: event.target.value as typeof format,
                      })
                    }
                  >
                    <option value="official">공문 날짜·요일</option>
                    <option value="iso">YYYY-MM-DD</option>
                    <option value="compact">YYYYMMDD</option>
                  </select>
                </label>
              </div>
              <p className="ds-muted">
                기준 시간대: {timeZone}. 주간 범위에 공휴일도 포함됩니다.
              </p>
            </div>
          </fieldset>
        )}
        {kind === "preset" && (
          <fieldset disabled={!enabled}>
            <legend className="ds-sr-only">자주 쓰는 서식</legend>
            <div className="ds-quick-buttons">
              {actions.list().presets.map((preset) => (
                <button
                  type="button"
                  className="ds-button"
                  key={preset.id}
                  title={preset.description}
                  onClick={(event) =>
                    choose(
                      { kind: "preset", presetId: preset.id },
                      event.currentTarget,
                    )
                  }
                >
                  {preset.name}
                </button>
              ))}
            </div>
          </fieldset>
        )}
        {kind === "cleanPaste" && (
          <fieldset disabled={!enabled}>
            <legend className="ds-sr-only">붙여넣기 원고 정리</legend>
            <label>
              원고
              <textarea
                aria-label="정리할 붙여넣기 원고"
                rows={4}
                maxLength={10000}
                value={pasteText}
                onChange={(event) => edit(event.target.value)}
              />
            </label>
            <p className="ds-muted">
              불필요한 공백과 인용 흔적을 확인합니다. 정리한 원고는 일반
              텍스트로 삽입합니다.
            </p>
            <button
              type="button"
              className="ds-button"
              disabled={!pasteText.trim()}
              onClick={(event) =>
                choose(
                  { kind: "cleanPaste", text: pasteText },
                  event.currentTarget,
                )
              }
            >
              원고 정리 미리보기
            </button>
          </fieldset>
        )}
        {presetDetails.length > 0 && (
          <ul className="ds-quick-detail" aria-label="적용할 서식">
            {presetDetails.map((text, index) => (
              <li key={index}>{text}</li>
            ))}
          </ul>
        )}
        {cleanup && (
          <div className="ds-quick-detail">
            <strong>정리된 원고</strong>
            <pre>{cleanup.after}</pre>
            <details>
              <summary>바뀌는 줄 {cleanup.changes.length}개</summary>
              {cleanup.changes.map((change) => (
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
          </div>
        )}
        {draftNotice && (
          <p className="ds-muted">
            {draftNotice}
            {!status.ready &&
              status.error &&
              " 업무 자동화에서 복구 상태를 확인할 수 있습니다."}
          </p>
        )}
        <details className="ds-quick-options">
          <summary>입력 관리</summary>
          <p className="ds-muted">
            {status.storage === "memory"
              ? "원고와 날짜 설정은 편집 중에만 유지됩니다. 필요하면 문서를 닫기 전에 내려받아 주세요."
              : "원고와 날짜 설정을 보관합니다."}
          </p>
          <button
            type="button"
            className="ds-button"
            onClick={() =>
              downloadAutomationDraft(
                session.hasRecovery()
                  ? session.recoveryData()
                  : session.snapshot(),
              )
            }
          >
            빠른 작업 입력 내려받기
          </button>
          {settingsError && (
            <button
              type="button"
              className="ds-button"
              disabled={!status.ready}
              onClick={() => edit(pasteText, defaults)}
            >
              날짜 설정 초기화
            </button>
          )}
        </details>
      </div>
      <span className="ds-sr-only" aria-live="polite">
        {preview && `미리보기: ${resultText}. ${target}`}
      </span>
      {preview && (
        <div className="ds-quick-preview" aria-label="빠른 작업 미리보기">
          <div className="ds-quick-result">
            <strong
              className={
                preview.request.kind === "date"
                  ? undefined
                  : "ds-quick-truncate"
              }
            >
              {resultText}
            </strong>
            <span
              className="ds-quick-truncate"
              title={`${target} · ${preview.target}`}
            >
              {target}
            </span>
          </div>
          <button
            type="button"
            className="ds-button ds-primary"
            disabled={!pending && !canApply}
            aria-disabled={pending || undefined}
            onClick={(event) => void apply(event.currentTarget)}
          >
            {pending ? "적용 중…" : "적용"}
          </button>
          {stale && !pending && (
            <p role="status">
              문서 또는 선택 범위가 바뀌었습니다. 작업을 다시 선택해 주세요.
            </p>
          )}
        </div>
      )}
      <p
        className="ds-quick-notice"
        role="status"
        aria-live="polite"
        title={notice || draftNotice || undefined}
      >
        {notice || draftNotice}
      </p>
    </section>
  );
}
