import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { SearchSession, type SearchToken } from "./search-session";
import { reconcilePropertyDraft, type PropertyDraft } from "./property-draft";
import { ReportAutomation } from "./report-automation";
import { downloadAutomationDraft } from "./automation-drafts";
import type {
  AutomationSession,
  AutomationDraftStatus,
} from "./automation-session";
import { NumericField } from "./numeric-field";
import { TableColumnTools } from "./table-column-tools";
import { QuickActionTools } from "./quick-actions-tools";
import { MailMergeTools } from "./mail-merge-tools";
import {
  COMMAND_LABELS,
  REPORT_PRESETS,
  imageDimensions,
  fitImage,
  type CommandId,
  type EditorCommand,
  type EditorSnapshot,
  type DocumentPreset,
  type SearchOptions,
  type SearchResult,
  type ReplaceRequest,
  type ParagraphSettings,
  type PageSettings,
  type DocumentTemplate,
  type EditorDocument,
} from "@document-studio/core";
interface Props {
  previewMailMergeDocument?(previewId: string, row?: number): Promise<void>;
  onOpenStoredCopy?(
    file: import("@document-studio/core").GeneratedStoredFile,
  ): Promise<void>;
  quickActions?: ReturnType<
    typeof import("@document-studio/core").createQuickActionEditor
  >;
  mailMerge?: ReturnType<
    typeof import("@document-studio/core").createMailMergeSession
  >;
  registerCurrentMailMergeTemplate?: () => Promise<
    import("@document-studio/core").MailMergeTemplateInfo
  >;
  tableColumn?: ReturnType<
    typeof import("@document-studio/core").createTableColumnEditor
  >;
  creationContext?: unknown;
  format?: string;
  saveLocation?: string;
  automationSession?: AutomationSession;
  automationStatus?: AutomationDraftStatus;
  snapshot: EditorSnapshot;
  disabled: boolean;
  readOnly?: boolean;
  execute(command: EditorCommand): Promise<void>;
  search(input: SearchOptions): Promise<SearchResult>;
  selectMatch(id: string, revision: string): Promise<void>;
  replace(input: ReplaceRequest, revision: string): Promise<{ count: number }>;
  applyPreset(preset: DocumentPreset, revision?: string): Promise<void>;
  presets?: readonly DocumentPreset[];
  onError(error: Error): void;
  createDocument?(template: DocumentTemplate): Promise<EditorDocument>;
  onCreateDocument?(document: EditorDocument): void | Promise<void>;
  initialTab?: string;
  onTabChange?(tab: string): void;
  documentKey?: string;
  onClose?(): void;
  expanded?: boolean;
  /** The host supplies panel geometry; do not impose the SDK dock width/expansion. */
  external?: boolean;
  onExpandedChange?(expanded: boolean): void;
}
const TABS = [
  "글자",
  "문단",
  "표",
  "그림",
  "페이지",
  "찾기와 바꾸기",
  "보고서 서식",
  "업무 자동화",
  "빠른 작업",
  "서식·메일머지",
] as const;
export function EditingTools(props: Props) {
  const { snapshot, execute, onError, disabled } = props;
  const [toolSize, setToolSize] = useState(() => {
    try {
      const size = Number(sessionStorage.getItem("document-studio:tool-size"));
      return size >= 24 && size <= 48 ? size : 34;
    } catch {
      return 34;
    }
  });
  const [localTab, setLocalTab] = useState<(typeof TABS)[number]>("문단");
  const tab = props.onTabChange
    ? (props.initialTab as (typeof TABS)[number])
    : localTab;
  const setTab = (value: (typeof TABS)[number]) => {
    setLocalTab(value);
    props.onTabChange?.(value);
  };
  const toolsElement = useRef<HTMLDivElement>(null);
  const contentElement = useRef<HTMLDivElement>(null);
  const expanded = useRef(Boolean(props.expanded));
  expanded.current = Boolean(props.expanded);
  useEffect(() => {
    if (
      !["업무 자동화", "빠른 작업", "서식·메일머지"].includes(tab) ||
      !props.onExpandedChange
    )
      return;
    const area = toolsElement.current?.closest(".ds-work-area");
    if (!area) return;
    const ensureInputSpace = () => {
      // Measure the form body after the host's header, target and tabs consume space.
      // Observe the host area only: returning to the dock is an explicit user choice
      // and must not immediately trigger another automatic expansion.
      const height = contentElement.current?.getBoundingClientRect().height;
      if (!expanded.current && height !== undefined && height < 360) {
        expanded.current = true;
        props.onExpandedChange?.(true);
      }
    };
    ensureInputSpace();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(ensureInputSpace);
    observer.observe(area);
    return () => observer.disconnect();
  }, [tab, props.documentKey, props.onExpandedChange]);
  const statusId = useId();
  const tabId = useId();
  const tabButtons = useRef(new Map<string, HTMLButtonElement>());
  const selection = `${props.documentKey ?? ""}:${snapshot.selectionKey ?? JSON.stringify(snapshot.paragraph ?? {})}`;
  const currentParagraph = snapshot.paragraph ?? {};
  const [paragraphDraft, setParagraphDraft] = useState<
    PropertyDraft<ParagraphSettings>
  >({ selection, base: currentParagraph, edits: {} });
  const reconciled = reconcilePropertyDraft(
    paragraphDraft,
    currentParagraph,
    selection,
  );
  if (reconciled !== paragraphDraft) setParagraphDraft(reconciled);
  const paragraph = { ...currentParagraph, ...reconciled.edits };
  const changeParagraph = (patch: ParagraphSettings) => {
    const edits = Object.fromEntries(
      Object.entries({ ...reconciled.edits, ...patch }).filter(
        ([key, value]) =>
          JSON.stringify(value) !==
          JSON.stringify(currentParagraph[key as keyof ParagraphSettings]),
      ),
    ) as Partial<ParagraphSettings>;
    setParagraphDraft({ ...reconciled, edits });
  };
  const fallbackPage: PageSettings = {
    widthMm: NaN,
    heightMm: NaN,
    topMm: NaN,
    bottomMm: NaN,
    leftMm: NaN,
    rightMm: NaN,
    orientation: "portrait",
    scope: "document",
  };
  const currentPage = snapshot.page ?? fallbackPage;
  const [pageDraft, setPageDraft] = useState<PropertyDraft<PageSettings>>({
    selection,
    base: currentPage,
    edits: {},
  });
  const livePage = reconcilePropertyDraft(pageDraft, currentPage, selection);
  if (livePage !== pageDraft) setPageDraft(livePage);
  const page: PageSettings = { ...currentPage, ...livePage.edits };
  const setPage = (value: PageSettings) => {
    const edits = Object.fromEntries(
      Object.entries(value).filter(
        ([key, next]) =>
          JSON.stringify(page[key as keyof PageSettings]) !==
          JSON.stringify(next),
      ),
    ) as Partial<PageSettings>;
    const pending = Object.fromEntries(
      Object.entries({ ...livePage.edits, ...edits }).filter(
        ([key, value]) =>
          JSON.stringify(value) !==
          JSON.stringify(currentPage[key as keyof PageSettings]),
      ),
    ) as Partial<PageSettings>;
    setPageDraft({ ...livePage, edits: pending });
  };
  const [rows, setRows] = useState(2),
    [columns, setColumns] = useState(2);
  const [color, setColor] = useState("#000000"),
    [fill, setFill] = useState("#e8eef4");
  const [highlight, setHighlight] = useState("#ffff00");
  const highlightChoices = snapshot.commands.highlightColor?.valueChoices;
  const highlightAllowed =
    !highlightChoices ||
    highlightChoices.some((choice) => choice.value === highlight);
  const [spacing, setSpacing] = useState(0),
    [scale, setScale] = useState(100);
  const [query, setQuery] = useState(""),
    [replacement, setReplacement] = useState("");
  const [matchCase, setMatchCase] = useState(false),
    [wholeWord, setWholeWord] = useState(false);
  const guard = useRef(new SearchSession());
  const searchIdentity = JSON.stringify([
    props.documentKey ?? "",
    query,
    matchCase,
    wholeWord,
  ]);
  const searchContext = JSON.stringify([searchIdentity, snapshot.revision]);
  guard.current.updateContext(searchContext);
  const latestSearchIdentity = useRef(searchIdentity);
  latestSearchIdentity.current = searchIdentity;
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      guard.current.invalidate();
    };
  }, []);
  const [storedResults, setResults] = useState<{
    token: SearchToken;
    result: SearchResult;
  } | null>(null);
  const [storedSelection, setSelected] = useState<{
    token: SearchToken;
    id: string;
  } | null>(null);
  const [pendingSearch, setPendingSearch] = useState<{
    token: SearchToken;
    phase: "search" | "select";
  } | null>(null);
  const results =
    storedResults &&
    guard.current.current(storedResults.token) &&
    storedResults.result.revision === snapshot.revision
      ? storedResults.result
      : null;
  const selected =
    storedSelection &&
    guard.current.current(storedSelection.token) &&
    results?.matches.some((match) => match.id === storedSelection.id)
      ? storedSelection.id
      : "";
  const searching =
    pendingSearch?.phase === "search" &&
    guard.current.current(pendingSearch.token);
  const selecting =
    pendingSearch?.phase === "select" &&
    guard.current.current(pendingSearch.token);
  const [message, setMessage] = useState("");
  const [image, setImage] = useState<File | null>(null),
    [imageWidth, setImageWidth] = useState(40),
    [imageHeight, setImageHeight] = useState(30),
    [imageAlt, setImageAlt] = useState("");
  const [imageBytes, setImageBytes] = useState<Uint8Array | null>(null);
  const [naturalImage, setNaturalImage] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [keepAspect, setKeepAspect] = useState(true);
  const [imageLoading, setImageLoading] = useState(false);
  const imageGeneration = useRef(0);
  const imageInput = useRef<HTMLInputElement>(null);
  const bodyWidth = snapshot.page
    ? snapshot.page.widthMm - snapshot.page.leftMm - snapshot.page.rightMm
    : NaN;
  const availableImageWidth =
    Number.isFinite(bodyWidth) && bodyWidth > 0 ? bodyWidth : 160;
  useEffect(() => {
    imageGeneration.current++;
    if (imageInput.current) imageInput.current.value = "";
    setImage(null);
    setImageBytes(null);
    setNaturalImage(null);
    setImageLoading(false);
    return () => {
      imageGeneration.current++;
    };
  }, [props.documentKey]);
  const readImage = async (file: File | undefined) => {
    const generation = ++imageGeneration.current;
    setImage(null);
    setImageBytes(null);
    setNaturalImage(null);
    if (!file) {
      setImageLoading(false);
      return;
    }
    setImageLoading(true);
    try {
      if (file.size > 8 * 1024 * 1024)
        throw new Error("그림 크기 제한은 8 MiB입니다.");
      const bytes = new Uint8Array(await file.arrayBuffer());
      imageDimensions(bytes, file.type);
      const bitmap = await createImageBitmap(file);
      const size = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      if (generation !== imageGeneration.current) return;
      const fitted = fitImage(size, availableImageWidth);
      setImage(file);
      setImageBytes(bytes);
      setNaturalImage(size);
      setKeepAspect(true);
      setImageWidth(fitted.widthMm);
      setImageHeight(fitted.heightMm);
    } catch (error) {
      if (generation === imageGeneration.current)
        onError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      if (generation === imageGeneration.current) setImageLoading(false);
    }
  };
  const changeImageWidth = (width: number) => {
    setImageWidth(width);
    if (keepAspect && naturalImage)
      setImageHeight((width * naturalImage.height) / naturalImage.width);
  };
  const changeImageHeight = (height: number) => {
    setImageHeight(height);
    if (keepAspect && naturalImage)
      setImageWidth((height * naturalImage.width) / naturalImage.height);
  };
  const enabled = (id: CommandId) =>
    !disabled &&
    Boolean(snapshot.commands[id]?.supported && snapshot.commands[id]?.enabled);
  const reasonFor = (id: CommandId) =>
    snapshot.commands[id]?.reason ??
    (!snapshot.commands[id]?.supported
      ? "이 문서 형식에서는 지원하지 않는 도구입니다."
      : "현재 선택에서는 사용할 수 없습니다.");
  const perform = (task: () => Promise<unknown>) => {
    setMessage("");
    void task().catch((cause) =>
      onError(cause instanceof Error ? cause : new Error(String(cause))),
    );
  };
  const run = (command: EditorCommand) => perform(() => execute(command));
  const tool = (id: CommandId) => (
    <button
      type="button"
      className="ds-button"
      key={id}
      disabled={!enabled(id)}
      title={!enabled(id) ? reasonFor(id) : COMMAND_LABELS[id]}
      aria-describedby={!enabled(id) ? statusId : undefined}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => run({ id } as EditorCommand)}
    >
      {COMMAND_LABELS[id]}
    </button>
  );
  const numeric = (
    label: string,
    value: number | undefined,
    onChange: (value: number) => void,
    min: number,
    max: number,
    step = 0.1,
  ) => (
    <NumericField
      label={label}
      value={value}
      onChange={onChange}
      min={min}
      max={max}
      step={step}
    />
  );
  const search = async () => {
    const token = guard.current.beginSearch();
    setResults(null);
    setSelected(null);
    setPendingSearch({ token, phase: "search" });
    try {
      const found = await props.search({ query, matchCase, wholeWord });
      if (
        !alive.current ||
        !guard.current.current(token) ||
        found.revision !== snapshot.revision
      )
        return;
      setResults({ token, result: found });
      setMessage(
        `${found.total}개 찾음${found.truncated ? " · 일부 결과만 표시" : ""}`,
      );
    } catch (cause) {
      if (alive.current && guard.current.current(token)) throw cause;
    } finally {
      if (alive.current && guard.current.current(token)) setPendingSearch(null);
    }
  };
  const selectResult = async (id: string) => {
    if (
      !results ||
      !storedResults ||
      !guard.current.current(storedResults.token) ||
      !results.matches.some((match) => match.id === id)
    )
      return;
    const token = guard.current.beginSelection();
    setSelected(null);
    setPendingSearch({ token, phase: "select" });
    try {
      await props.selectMatch(id, results.revision);
      if (alive.current && guard.current.current(token))
        setSelected({ token, id });
    } catch (cause) {
      if (alive.current && guard.current.current(token)) throw cause;
    } finally {
      if (alive.current && guard.current.current(token)) setPendingSearch(null);
    }
  };
  const changeSearchConditions = (change: () => void) => {
    guard.current.invalidate();
    setResults(null);
    setSelected(null);
    setPendingSearch(null);
    setMessage("");
    change();
  };
  return (
    <div
      ref={toolsElement}
      className="ds-editing-tools"
      data-document-properties
      role="region"
      aria-label="추가 편집 도구"
      data-expanded={Boolean(props.expanded)}
      style={{ "--ds-tools-size": `${toolSize}%` } as CSSProperties}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        if (props.expanded) props.onExpandedChange?.(false);
        else props.onClose?.();
      }}
    >
      <div className="ds-tools-header">
        <strong>문서 도구</strong>
        {props.onExpandedChange && (
          <button
            type="button"
            className="ds-button"
            aria-expanded={props.expanded}
            onClick={() => props.onExpandedChange?.(!props.expanded)}
          >
            {props.expanded ? "문서와 함께 보기" : "도구 크게 보기"}
          </button>
        )}
        {props.onClose && (
          <button
            type="button"
            className="ds-tool"
            aria-label="편집 도구 닫기"
            onClick={props.onClose}
          >
            ×
          </button>
        )}
      </div>
      <div className="ds-tools-target" aria-label="현재 적용 대상">
        적용 대상:{" "}
        {snapshot.selectionText
          ? `“${snapshot.selectionText}”`
          : (snapshot.selectionDescription ??
            (snapshot.selectionCollapsed
              ? "현재 커서 위치"
              : "현재 선택한 영역"))}
        <span>
          {snapshot.selectionCollapsed
            ? " · 삽입"
            : " · 텍스트 삽입 시 선택 내용 교체"}
        </span>
      </div>
      {!props.expanded && !props.external && (
        <label className="ds-tools-resize">
          도구 영역 크기
          <input
            type="range"
            aria-label="도구 영역 크기"
            min={24}
            max={48}
            step={2}
            value={toolSize}
            onChange={(event) => {
              const size = Number(event.target.value);
              setToolSize(size);
              try {
                sessionStorage.setItem(
                  "document-studio:tool-size",
                  String(size),
                );
              } catch {
                /* Optional layout preference. */
              }
            }}
          />
        </label>
      )}
      <div className="ds-tools-tabs" role="tablist" aria-label="편집 도구 종류">
        {TABS.map((name) => (
          <button
            type="button"
            key={name}
            role="tab"
            id={`${tabId}-tab-${TABS.indexOf(name)}`}
            aria-controls={`${tabId}-panel-${TABS.indexOf(name)}`}
            aria-selected={tab === name}
            tabIndex={tab === name ? 0 : -1}
            ref={(button) => {
              if (button) tabButtons.current.set(name, button);
              else tabButtons.current.delete(name);
            }}
            onKeyDown={(event) => {
              const index = TABS.indexOf(name);
              const next =
                event.key === "ArrowRight"
                  ? (index + 1) % TABS.length
                  : event.key === "ArrowLeft"
                    ? (index + TABS.length - 1) % TABS.length
                    : event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? TABS.length - 1
                        : -1;
              if (next < 0) return;
              event.preventDefault();
              setTab(TABS[next]!);
              tabButtons.current.get(TABS[next]!)?.focus();
            }}
            className={tab === name ? "active" : ""}
            onClick={() => setTab(name)}
          >
            {name === "서식·메일머지" ? "문서 일괄 생성" : name}
          </button>
        ))}
      </div>
      {TABS.filter((name) => name !== tab).map((name) => (
        <div
          key={name}
          id={`${tabId}-panel-${TABS.indexOf(name)}`}
          role="tabpanel"
          aria-labelledby={`${tabId}-tab-${TABS.indexOf(name)}`}
          hidden
        />
      ))}
      <div
        className="ds-tools-content"
        ref={contentElement}
        id={`${tabId}-panel-${TABS.indexOf(tab)}`}
        role="tabpanel"
        aria-labelledby={`${tabId}-tab-${TABS.indexOf(tab)}`}
      >
        {tab === "표" && !snapshot.table ? (
          <p id={statusId} className="ds-tools-hint">
            표 안의 셀을 먼저 선택하세요. 표를 새로 만드는 작업은 바로 사용할 수
            있습니다.
          </p>
        ) : (
          <details className="ds-tools-hint">
            <summary>서식 적용 도움말</summary>
            <p id={statusId}>
              지원하지 않는 도구와 현재 선택에서 사용할 수 없는 도구는 해당
              항목의 설명을 확인하세요.
            </p>
          </details>
        )}
        {tab === "서식·메일머지" &&
        props.mailMerge &&
        props.registerCurrentMailMergeTemplate &&
        props.automationSession &&
        props.automationStatus ? (
          <MailMergeTools
            format={props.format}
            previewDocument={props.previewMailMergeDocument}
            onOpenStoredCopy={props.onOpenStoredCopy}
            key={props.documentKey}
            actions={props.mailMerge}
            registerCurrent={props.registerCurrentMailMergeTemplate}
            session={props.automationSession}
            draftStatus={props.automationStatus}
            snapshot={snapshot}
            disabled={disabled}
            readOnly={props.readOnly}
          />
        ) : tab === "빠른 작업" &&
          props.quickActions &&
          props.automationSession ? (
          <QuickActionTools
            key={props.documentKey}
            session={props.automationSession}
            actions={props.quickActions}
            snapshot={snapshot}
            disabled={disabled}
            readOnly={props.readOnly}
          />
        ) : tab === "업무 자동화" &&
          props.automationStatus &&
          !props.automationStatus.ready ? (
          <div className="ds-tools-panel" role="status">
            {props.automationStatus.error ||
              "보관한 자동화 입력을 불러오는 중…"}
            {props.automationStatus.error && (
              <>
                {props.automationSession?.hasRecovery() && (
                  <button
                    type="button"
                    className="ds-button"
                    onClick={() => {
                      try {
                        downloadAutomationDraft(
                          props.automationSession?.recoveryData(),
                        );
                      } catch (cause) {
                        onError(
                          cause instanceof Error
                            ? cause
                            : new Error(String(cause)),
                        );
                      }
                    }}
                  >
                    원본 보관자료 내려받기
                  </button>
                )}
                {props.automationSession?.canRepair() && (
                  <>
                    <p>
                      길이를 초과한 입력도 자르지 않고 모든 기능을 함께
                      불러옵니다. 한도를 맞추기 전에는 기존 보관 자료를 변경하지
                      않습니다.
                    </p>
                    <button
                      type="button"
                      className="ds-button"
                      disabled={disabled}
                      title={
                        disabled
                          ? "편집 가능한 상태에서 복구하세요."
                          : undefined
                      }
                      onClick={() => {
                        try {
                          props.automationSession?.repairStoredDraft();
                        } catch (cause) {
                          onError(
                            cause instanceof Error
                              ? cause
                              : new Error(String(cause)),
                          );
                        }
                      }}
                    >
                      보관자료를 편집해 복구
                    </button>
                  </>
                )}
                <button
                  type="button"
                  className="ds-button"
                  onClick={() => {
                    void props.automationSession
                      ?.start()
                      .catch(() => undefined);
                  }}
                >
                  다시 불러오기
                </button>
                <button
                  type="button"
                  className="ds-button"
                  onClick={() => {
                    void props.automationSession
                      ?.discardStoredDraft()
                      .catch(onError);
                  }}
                >
                  손상된 자동화 초안 버리고 시작
                </button>
              </>
            )}
          </div>
        ) : tab === "업무 자동화" ? (
          <ReportAutomation
            format={props.format}
            saveLocation={props.saveLocation}
            key={props.documentKey}
            session={props.automationSession}
            draftStatus={props.automationStatus}
            creationContext={props.creationContext}
            execute={execute}
            createDocument={props.createDocument}
            onCreateDocument={props.onCreateDocument}
            onError={onError}
            disabled={disabled}
          />
        ) : (
          <fieldset className="ds-tools-panel" disabled={disabled}>
            <legend>{tab}</legend>
            {tab === "글자" && (
              <>
                <p className="ds-tools-hint">
                  현재 글자색: {snapshot.textColor ?? "혼합 또는 미확인"} ·
                  강조색: {snapshot.highlightColor ?? "혼합 또는 미확인"}. 아래
                  값은 선택 영역에 적용할 새 값입니다.
                </p>
                <div className="ds-tools-row">
                  {(
                    [
                      "strike",
                      "superscript",
                      "subscript",
                      "clearFormatting",
                    ] as const
                  ).map(tool)}
                </div>
                <div className="ds-tools-row">
                  <label className="ds-field">
                    글자색
                    <input
                      type="color"
                      aria-label="서식 색상"
                      value={color}
                      onChange={(e) => setColor(e.target.value)}
                    />
                  </label>
                  <button
                    className="ds-button"
                    disabled={!enabled("textColor")}
                    title={
                      !enabled("textColor") ? reasonFor("textColor") : undefined
                    }
                    aria-describedby={
                      !enabled("textColor") ? statusId : undefined
                    }
                    onClick={() => run({ id: "textColor", value: color })}
                  >
                    글자색 적용
                  </button>
                  <label className="ds-field">
                    강조색
                    {highlightChoices ? (
                      <select
                        aria-label="강조색"
                        value={highlightAllowed ? highlight : ""}
                        onChange={(event) => setHighlight(event.target.value)}
                      >
                        {!highlightAllowed && (
                          <option value="" disabled>
                            강조색 선택
                          </option>
                        )}
                        {highlightChoices.map((choice) => (
                          <option key={choice.value} value={choice.value}>
                            {choice.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="color"
                        aria-label="강조색"
                        value={highlight}
                        onChange={(event) => setHighlight(event.target.value)}
                      />
                    )}
                  </label>
                  <button
                    className="ds-button"
                    disabled={!enabled("highlightColor") || !highlightAllowed}
                    title={
                      !enabled("highlightColor")
                        ? reasonFor("highlightColor")
                        : undefined
                    }
                    aria-describedby={
                      !enabled("highlightColor") ? statusId : undefined
                    }
                    onClick={() =>
                      run({ id: "highlightColor", value: highlight })
                    }
                  >
                    강조색 적용
                  </button>
                  {numeric("자간 (pt)", spacing, setSpacing, -20, 100)}
                  <button
                    className="ds-button"
                    disabled={!enabled("characterSpacing")}
                    title={
                      !enabled("characterSpacing")
                        ? reasonFor("characterSpacing")
                        : undefined
                    }
                    aria-describedby={
                      !enabled("characterSpacing") ? statusId : undefined
                    }
                    onClick={() =>
                      run({ id: "characterSpacing", value: spacing })
                    }
                  >
                    자간 적용
                  </button>
                  {numeric("장평 (%)", scale, setScale, 50, 200, 1)}
                  <button
                    className="ds-button"
                    disabled={!enabled("characterScale")}
                    title={
                      !enabled("characterScale")
                        ? reasonFor("characterScale")
                        : undefined
                    }
                    aria-describedby={
                      !enabled("characterScale") ? statusId : undefined
                    }
                    onClick={() => run({ id: "characterScale", value: scale })}
                  >
                    장평 적용
                  </button>
                </div>
              </>
            )}
            {tab === "문단" && (
              <>
                <div className="ds-tools-row">
                  {(
                    [
                      "bulletList",
                      "numberedList",
                      "increaseIndent",
                      "decreaseIndent",
                      "pageBreak",
                      "lineBreak",
                      "showParagraphMarks",
                    ] as const
                  ).map(tool)}
                  <button
                    className="ds-button"
                    onClick={() =>
                      setParagraphDraft({
                        selection,
                        base: currentParagraph,
                        edits: {},
                      })
                    }
                  >
                    현재 문단 값 읽기
                  </button>
                </div>
                <p className="ds-tools-hint">
                  {snapshot.selectionStateScope === "caret"
                    ? "현재 커서 문단의 값입니다. 여러 문단의 혼합 값 조회는 지원되지 않으며 적용은 선택 영역에 수행됩니다."
                    : "현재 선택의 값입니다. 빈 값은 혼합되었거나 아직 확인되지 않은 속성입니다."}{" "}
                  바꾼 항목만 적용됩니다.
                </p>
                <div className="ds-tools-row">
                  {(
                    [
                      ["문단 앞 (pt)", "beforePt", 0, 720],
                      ["문단 뒤 (pt)", "afterPt", 0, 720],
                      ["왼쪽 들여쓰기 (mm)", "leftMm", 0, 300],
                      ["오른쪽 들여쓰기 (mm)", "rightMm", 0, 300],
                      ["첫 줄 들여쓰기 (mm)", "firstLineMm", -300, 300],
                    ] as const
                  ).map(([label, key, min, max]) => (
                    <div key={key}>
                      {numeric(
                        label,
                        paragraph[key],
                        (value) => changeParagraph({ [key]: value }),
                        min,
                        max,
                      )}
                    </div>
                  ))}
                  <label className="ds-field">
                    행간 종류
                    <select
                      aria-label="행간 종류"
                      value={paragraph.lineSpacing?.rule ?? ""}
                      onChange={(e) =>
                        changeParagraph({
                          lineSpacing: {
                            rule: e.target.value as
                              | "multiple"
                              | "exact"
                              | "atLeast",
                            value: e.target.value === "multiple" ? 1.6 : 18,
                          },
                        })
                      }
                    >
                      <option value="" disabled>
                        혼합 또는 미확인
                      </option>
                      <option value="multiple">배수</option>
                      <option value="exact">고정 (pt)</option>
                      <option value="atLeast">최소 (pt)</option>
                    </select>
                  </label>
                  {numeric(
                    "행간 값",
                    paragraph.lineSpacing?.value,
                    (value) =>
                      changeParagraph({
                        lineSpacing: {
                          rule: paragraph.lineSpacing?.rule ?? "multiple",
                          value,
                        },
                      }),
                    paragraph.lineSpacing?.rule === "multiple" ? 0.5 : 1,
                    paragraph.lineSpacing?.rule === "multiple" ? 5 : 200,
                  )}
                </div>
                <div className="ds-tools-row">
                  {(
                    [
                      ["다음 문단과 함께", "keepNext"],
                      ["문단 나누지 않음", "keepLines"],
                      ["외톨이줄 보호", "widowControl"],
                      ["문단 앞에서 쪽 나눔", "pageBreakBefore"],
                    ] as const
                  ).map(([label, key]) => (
                    <label className="ds-check" key={key}>
                      <input
                        type="checkbox"
                        checked={paragraph[key] ?? false}
                        aria-checked={
                          paragraph[key] === undefined
                            ? "mixed"
                            : paragraph[key]
                        }
                        onChange={(e) =>
                          changeParagraph({ [key]: e.target.checked })
                        }
                      />
                      {label}
                    </label>
                  ))}
                  <button
                    className="ds-button ds-primary"
                    disabled={
                      !enabled("paragraphFormat") ||
                      !Object.keys(reconciled.edits).length
                    }
                    onClick={() =>
                      run({ id: "paragraphFormat", value: reconciled.edits })
                    }
                  >
                    문단 설정 적용
                  </button>
                </div>
              </>
            )}
            {tab === "표" && (
              <>
                {props.tableColumn && (
                  <TableColumnTools
                    key={props.documentKey}
                    actions={props.tableColumn}
                    snapshot={snapshot}
                    disabled={disabled}
                    readOnly={props.readOnly}
                  />
                )}
                <div className="ds-tools-row">
                  {numeric("표 행 수", rows, setRows, 1, 100, 1)}
                  {numeric("표 열 수", columns, setColumns, 1, 50, 1)}
                  <button
                    className="ds-button"
                    disabled={!enabled("insertTable")}
                    title={
                      !enabled("insertTable")
                        ? reasonFor("insertTable")
                        : undefined
                    }
                    aria-describedby={
                      !enabled("insertTable") ? statusId : undefined
                    }
                    onClick={() =>
                      run({ id: "insertTable", value: { rows, columns } })
                    }
                  >
                    표 삽입
                  </button>
                  <button
                    className="ds-button"
                    disabled={!enabled("splitCell")}
                    title={
                      !enabled("splitCell") ? reasonFor("splitCell") : undefined
                    }
                    aria-describedby={
                      !enabled("splitCell") ? statusId : undefined
                    }
                    onClick={() =>
                      run({ id: "splitCell", value: { rows, columns } })
                    }
                  >
                    셀 분할
                  </button>
                  {snapshot.table && (
                    <span>
                      {snapshot.table.rows}행 × {snapshot.table.columns}열
                    </span>
                  )}
                </div>
                <div className="ds-tools-row">
                  {(
                    [
                      "insertRowAbove",
                      "insertRowBelow",
                      "insertColumnLeft",
                      "insertColumnRight",
                      "deleteRow",
                      "deleteColumn",
                      "deleteTable",
                      "mergeCells",
                    ] as const
                  ).map(tool)}
                </div>
                <div className="ds-tools-row">
                  <label className="ds-field">
                    셀 배경
                    <input
                      type="color"
                      aria-label="셀 배경색"
                      value={fill}
                      onChange={(e) => setFill(e.target.value)}
                    />
                  </label>
                  <button
                    className="ds-button"
                    disabled={!enabled("cellFill")}
                    title={
                      !enabled("cellFill") ? reasonFor("cellFill") : undefined
                    }
                    aria-describedby={
                      !enabled("cellFill") ? statusId : undefined
                    }
                    onClick={() => run({ id: "cellFill", value: fill })}
                  >
                    셀 배경 적용
                  </button>
                  <label className="ds-field">
                    셀 세로 정렬
                    <select
                      aria-label="셀 세로 정렬"
                      disabled={!enabled("cellVerticalAlign")}
                      title={
                        !enabled("cellVerticalAlign")
                          ? reasonFor("cellVerticalAlign")
                          : undefined
                      }
                      aria-describedby={
                        !enabled("cellVerticalAlign") ? statusId : undefined
                      }
                      defaultValue="top"
                      onChange={(e) =>
                        run({
                          id: "cellVerticalAlign",
                          value: e.target.value as "top" | "center" | "bottom",
                        })
                      }
                    >
                      <option value="top">위</option>
                      <option value="center">가운데</option>
                      <option value="bottom">아래</option>
                    </select>
                  </label>
                  <button
                    className="ds-button"
                    disabled={!enabled("tableBorders")}
                    title={
                      !enabled("tableBorders")
                        ? reasonFor("tableBorders")
                        : undefined
                    }
                    aria-describedby={
                      !enabled("tableBorders") ? statusId : undefined
                    }
                    onClick={() =>
                      run({
                        id: "tableBorders",
                        value: { scope: "all", color: "#000000", widthPt: 0.5 },
                      })
                    }
                  >
                    셀 테두리 적용
                  </button>
                  <button
                    className="ds-button"
                    disabled={!enabled("tableBorders")}
                    title={
                      !enabled("tableBorders")
                        ? reasonFor("tableBorders")
                        : undefined
                    }
                    aria-describedby={
                      !enabled("tableBorders") ? statusId : undefined
                    }
                    onClick={() =>
                      run({
                        id: "tableBorders",
                        value: {
                          scope: "none",
                          color: "#000000",
                          widthPt: 0.5,
                        },
                      })
                    }
                  >
                    셀 테두리 제거
                  </button>
                </div>
              </>
            )}
            {tab === "그림" && (
              <div className="ds-tools-row">
                <label className="ds-field">
                  그림 파일
                  <input
                    aria-label="삽입할 그림"
                    ref={imageInput}
                    type="file"
                    accept="image/png,image/jpeg,image/gif"
                    onChange={(e) => {
                      void readImage(e.target.files?.[0]);
                    }}
                  />
                </label>
                {numeric(
                  "그림 너비 (mm)",
                  imageWidth,
                  changeImageWidth,
                  1,
                  500,
                )}
                {numeric(
                  "그림 높이 (mm)",
                  imageHeight,
                  changeImageHeight,
                  1,
                  500,
                )}
                <label className="ds-check">
                  <input
                    type="checkbox"
                    aria-label="원본 비율 유지"
                    checked={keepAspect}
                    onChange={(e) => {
                      setKeepAspect(e.target.checked);
                      if (e.target.checked && naturalImage)
                        setImageHeight(
                          (imageWidth * naturalImage.height) /
                            naturalImage.width,
                        );
                    }}
                  />
                  원본 비율 유지
                </label>
                <button
                  className="ds-button"
                  disabled={!naturalImage}
                  onClick={() => {
                    if (naturalImage) {
                      const size = fitImage(naturalImage, availableImageWidth);
                      setImageWidth(size.widthMm);
                      setImageHeight(size.heightMm);
                      setKeepAspect(true);
                    }
                  }}
                >
                  문서 폭 안에 맞춤
                </button>
                <p className="ds-property-hint">
                  {imageLoading
                    ? "그림 크기를 확인하고 있습니다."
                    : naturalImage
                      ? `원본 ${naturalImage.width} × ${naturalImage.height}px · 문서 본문 폭 ${Math.round(availableImageWidth * 100) / 100}mm`
                      : "그림을 선택하면 원본 비율과 본문 폭에 맞춰 크기를 정합니다."}
                </p>
                <p className="ds-property-hint">
                  {snapshot.selectionCollapsed === false
                    ? "선택한 텍스트 위치에 넣습니다. 선택 내용이 바뀔 수 있으므로 삽입 위치를 먼저 확인하세요."
                    : snapshot.table
                      ? "현재 표의 커서가 있는 셀에 넣습니다."
                      : "글자처럼 같은 줄에 배치합니다. 별도 줄에 넣으려면 문서에서 Enter로 새 문단을 만든 뒤 삽입하세요."}
                </p>
                <label className="ds-field">
                  대체 텍스트
                  <input
                    aria-label="그림 대체 텍스트"
                    value={imageAlt}
                    onChange={(e) => setImageAlt(e.target.value)}
                  />
                </label>
                <button
                  className="ds-button ds-primary"
                  disabled={
                    !image ||
                    !imageBytes ||
                    imageLoading ||
                    !enabled("insertImage") ||
                    !Number.isFinite(imageWidth) ||
                    !Number.isFinite(imageHeight) ||
                    imageWidth < 1 ||
                    imageHeight < 1 ||
                    imageWidth > 500 ||
                    imageHeight > 500
                  }
                  onClick={() =>
                    perform(async () => {
                      if (!image || !imageBytes) return;
                      if (image.size > 8 * 1024 * 1024)
                        throw new Error("그림 크기 제한은 8 MiB입니다.");
                      await execute({
                        id: "insertImage",
                        value: {
                          bytes: imageBytes,
                          mimeType: image.type as
                            | "image/png"
                            | "image/jpeg"
                            | "image/gif",
                          widthMm: imageWidth,
                          heightMm: imageHeight,
                          alt: imageAlt,
                        },
                      });
                    })
                  }
                >
                  그림 삽입
                </button>
              </div>
            )}
            {tab === "페이지" && (
              <>
                <div className="ds-tools-row">
                  <button
                    className="ds-button"
                    onClick={() =>
                      setPageDraft({ selection, base: currentPage, edits: {} })
                    }
                  >
                    현재 페이지 값 읽기
                  </button>
                  <label className="ds-field">
                    용지 방향
                    <select
                      aria-label="용지 방향"
                      value={page.orientation}
                      onChange={(e) =>
                        setPage({
                          ...page,
                          orientation: e.target.value as
                            | "portrait"
                            | "landscape",
                          widthMm: page.heightMm,
                          heightMm: page.widthMm,
                        })
                      }
                    >
                      <option value="portrait">세로</option>
                      <option value="landscape">가로</option>
                    </select>
                  </label>
                  <label className="ds-field">
                    적용 범위
                    <select
                      aria-label="페이지 적용 범위"
                      value={page.scope ?? "document"}
                      onChange={(e) =>
                        setPage({
                          ...page,
                          scope: e.target.value as "document" | "section",
                        })
                      }
                    >
                      <option value="document">문서 전체</option>
                      <option value="section">현재 구역</option>
                    </select>
                  </label>
                  {(
                    [
                      ["용지 너비 (mm)", "widthMm", 50, 1000],
                      ["용지 높이 (mm)", "heightMm", 50, 1000],
                      ["위 여백 (mm)", "topMm", 0, 400],
                      ["아래 여백 (mm)", "bottomMm", 0, 400],
                      ["왼쪽 여백 (mm)", "leftMm", 0, 400],
                      ["오른쪽 여백 (mm)", "rightMm", 0, 400],
                    ] as const
                  ).map(([label, key, min, max]) => (
                    <div key={key}>
                      {numeric(
                        label,
                        page[key],
                        (value) => setPage({ ...page, [key]: value }),
                        min,
                        max,
                      )}
                    </div>
                  ))}
                  <button
                    className="ds-button ds-primary"
                    disabled={
                      !enabled("pageSetup") ||
                      !Object.keys(livePage.edits).length
                    }
                    title={
                      !enabled("pageSetup") ? reasonFor("pageSetup") : undefined
                    }
                    aria-describedby={
                      !enabled("pageSetup") ? statusId : undefined
                    }
                    onClick={() => run({ id: "pageSetup", value: page })}
                  >
                    페이지 설정 적용
                  </button>
                  <p className="ds-property-hint">
                    {Object.keys(livePage.edits).length
                      ? `변경한 항목 ${Object.keys(livePage.edits).length}개를 포함해 적용합니다.`
                      : "값을 변경하면 적용할 수 있습니다. 표시만 반올림하며 변경하지 않은 원래 수치는 유지합니다."}
                  </p>
                </div>
              </>
            )}
            {tab === "찾기와 바꾸기" && (
              <>
                <div className="ds-tools-row">
                  <label className="ds-field">
                    찾을 내용
                    <input
                      aria-label="찾을 내용"
                      autoFocus
                      value={query}
                      onChange={(e) =>
                        changeSearchConditions(() => setQuery(e.target.value))
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          perform(search);
                        }
                      }}
                    />
                  </label>
                  <label className="ds-field">
                    바꿀 내용
                    <input
                      aria-label="바꿀 내용"
                      value={replacement}
                      onChange={(e) => setReplacement(e.target.value)}
                    />
                  </label>
                  <label className="ds-check">
                    <input
                      type="checkbox"
                      checked={matchCase}
                      onChange={(e) =>
                        changeSearchConditions(() =>
                          setMatchCase(e.target.checked),
                        )
                      }
                    />
                    대소문자 구분
                  </label>
                  <label className="ds-check">
                    <input
                      type="checkbox"
                      checked={wholeWord}
                      onChange={(e) =>
                        changeSearchConditions(() =>
                          setWholeWord(e.target.checked),
                        )
                      }
                    />
                    단어 단위
                  </label>
                  <button
                    className="ds-button"
                    disabled={!query || searching}
                    onClick={() => perform(search)}
                  >
                    {searching ? "찾는 중…" : "찾기"}
                  </button>
                  <button
                    className="ds-button"
                    disabled={
                      props.readOnly ||
                      !snapshot.ready ||
                      !selected ||
                      selecting ||
                      searching ||
                      results?.revision !== snapshot.revision
                    }
                    onClick={() =>
                      perform(async () => {
                        if (
                          !results ||
                          !storedResults ||
                          !selected ||
                          !guard.current.current(storedResults.token)
                        )
                          return;
                        const identity = searchIdentity;
                        const result = await props.replace(
                          { matchId: selected, replacement },
                          results!.revision,
                        );
                        if (
                          !alive.current ||
                          latestSearchIdentity.current !== identity
                        )
                          return;
                        setResults(null);
                        setSelected(null);
                        setMessage(`${result.count}개 바꿈`);
                      })
                    }
                  >
                    선택 결과 바꾸기
                  </button>
                  <button
                    className="ds-button"
                    disabled={
                      !query || props.readOnly || !snapshot.ready || searching
                    }
                    onClick={() =>
                      perform(async () => {
                        const identity = searchIdentity;
                        const result = await props.replace(
                          {
                            query,
                            replacement,
                            matchCase,
                            wholeWord,
                            all: true,
                          },
                          snapshot.revision,
                        );
                        if (
                          !alive.current ||
                          latestSearchIdentity.current !== identity
                        )
                          return;
                        setResults(null);
                        setSelected(null);
                        setMessage(`${result.count}개 바꿈`);
                      })
                    }
                  >
                    모두 바꾸기
                  </button>
                </div>
                {results && (
                  <div className="ds-search-results">
                    {results.matches.map((match) => (
                      <button
                        type="button"
                        className={`ds-search-match ${selected === match.id ? "active" : ""}`}
                        key={match.id}
                        disabled={results.revision !== snapshot.revision}
                        onClick={() =>
                          perform(async () => {
                            await selectResult(match.id);
                          })
                        }
                      >
                        {match.before}
                        <strong>{match.text}</strong>
                        {match.after}
                      </button>
                    ))}
                  </div>
                )}
                {(searching || selecting) && (
                  <p role="status" className="ds-tools-message">
                    {searching
                      ? "검색 중입니다."
                      : "검색 위치를 선택하고 있습니다."}
                  </p>
                )}
              </>
            )}
            {tab === "보고서 서식" && (
              <div className="ds-tools-row">
                <p className="ds-property-hint">
                  {snapshot.atomicPresets
                    ? "서식 묶음은 한 작업으로 적용됩니다. 되돌리기 한 번으로 이전 서식을 복구하고 다시 실행 한 번으로 재적용할 수 있습니다. 엔진이 적용을 거절하면 변경을 취소합니다. 연결 오류가 나면 문서 상태를 먼저 확인하세요."
                    : "이 엔진은 서식을 순서대로 적용합니다. 일부 적용 후 중단되면 적용된 단계만큼 되돌리기가 필요합니다."}
                </p>
                {(props.presets ?? REPORT_PRESETS).map((preset) => (
                  <button
                    className="ds-button ds-preset"
                    key={preset.id}
                    disabled={preset.commands.some(
                      (command) => !enabled(command.id),
                    )}
                    onClick={() =>
                      perform(async () => {
                        await props.applyPreset(preset, snapshot.revision);
                        setMessage(`${preset.name} 적용 완료`);
                      })
                    }
                  >
                    <strong>{preset.name}</strong>
                    <small>{preset.description}</small>
                  </button>
                ))}
              </div>
            )}
            {message && (
              <span className="ds-tools-message" role="status">
                직전 작업: {message}
              </span>
            )}
          </fieldset>
        )}
      </div>
    </div>
  );
}
