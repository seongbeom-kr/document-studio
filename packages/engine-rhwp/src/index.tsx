import { useEffect, useLayoutEffect, useRef } from "react";
import { createStudio, type RhwpEditor } from "@rhwp/editor";
import { unzipSync, strFromU8 } from "fflate";
import {
  COMMAND_IDS,
  SessionStore,
  RevisionState,
  type CommandId,
  type EditorCommand,
  type EditorSession,
  type DocumentContent,
  type SearchResult,
  SaveConflictError,
  SearchResultExpiredError,
  SelectionConflictError,
  TableEditError,
  TableReadError,
  isTableReadErrorCode,
  EngineInitializationError,
  type EngineInitializationStage,
  type EngineInitializationDiagnostics,
  captureExportSnapshot,
  validateSearch,
  validateReplace,
  validateCommand,
} from "@document-studio/core";
import type { EngineDefinition, EngineViewProps } from "@document-studio/react";
import { receiveResponse } from "./transport";
import { createRhwpTableColumn } from "./table-column";
import { exportVerifiedHwp, type ReportedHwpExport } from "./hwp-export";
import { readRhwpFrameState } from "./frame-diagnostics";

const NATIVE: Partial<Record<CommandId, string>> = {
  selectAll: "edit:select-all",
  undo: "edit:undo",
  redo: "edit:redo",
  bold: "format:bold",
  italic: "format:italic",
  underline: "format:underline",
  alignLeft: "format:align-left",
  alignCenter: "format:align-center",
  alignRight: "format:align-right",
  alignJustify: "format:align-justify",
  fontFamily: "ext:document-studio:font-family",
  fontSize: "ext:document-studio:font-size",
  lineSpacing: "format:line-spacing",
  zoom: "ext:document-studio:zoom",
  strike: "format:strikethrough",
  superscript: "format:superscript",
  subscript: "format:subscript",
  bulletList: "format:toggle-bullet",
  numberedList: "format:toggle-numbering",
  textColor: "ext:document-studio:text-color",
  highlightColor: "ext:document-studio:highlight-color",
  characterSpacing: "ext:document-studio:character-spacing",
  characterScale: "ext:document-studio:character-scale",
  paragraphFormat: "ext:document-studio:paragraph",
  pageSetup: "ext:document-studio:page",
  insertTable: "ext:document-studio:table",
  splitCell: "ext:document-studio:split-cell",
  cellFill: "ext:document-studio:cell-fill",
  cellVerticalAlign: "ext:document-studio:cell-align",
  tableBorders: "ext:document-studio:table-borders",
  insertImage: "ext:document-studio:image",
  insertText: "ext:document-studio:text",
  pageBreak: "page:break",
  lineBreak: "ext:document-studio:line-break",
  insertRowAbove: "table:insert-row-above",
  insertRowBelow: "table:insert-row-below",
  insertColumnLeft: "table:insert-col-left",
  insertColumnRight: "table:insert-col-right",
  deleteRow: "table:delete-row",
  deleteColumn: "table:delete-col",
  deleteTable: "table:delete",
  mergeCells: "table:cell-merge",
};
interface NativeState {
  fonts?: import("@document-studio/core").DocumentFontReport;
  revision: number;
  selectionKey?: string;
  tableColumnEditing?: boolean;
  atomicTextInsertion?: boolean;
  selectionGuardedCommands?: boolean;
  selectionDescription?: string;
  selectionText?: string;
  selectionTextLength?: number;
  pageCount: number;
  character: {
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    fontFamily?: string;
    fontSize?: number;
  };
  paragraph: {
    alignment?: string;
    lineSpacing?: number;
    lineSpacingType?: string;
    marginLeft?: number;
    marginRight?: number;
    indent?: number;
    spacingBefore?: number;
    spacingAfter?: number;
  };
  page?: {
    width: number;
    height: number;
    marginTop: number;
    marginBottom: number;
    marginLeft: number;
    marginRight: number;
    landscape: boolean;
  };
  table?: { rowCount: number; colCount: number };
  context: {
    isDirty: boolean;
    isEditable: boolean;
    canUndo: boolean;
    canRedo: boolean;
    zoom: number;
    hasSelection: boolean;
  };
}
export interface RhwpOptions {
  studioUrl: string;
  /** Self-hosted shared font assets; defaults to ../fonts/ next to the Studio directory. */
  fontBaseUrl?: string;
  /** Whole engine boot, including iframe load and document loading (default 30s; 1–120s). */
  initializationTimeoutMs?: number;
}
function formatFields(native: NativeState) {
  return {
    fonts: native.fonts,
    pageCount: native.pageCount,
    zoom: native.context.zoom,
    fontFamily: native.character.fontFamily,
    fontSize: (native.character.fontSize ?? 1000) / 100,
    lineSpacing:
      native.paragraph.lineSpacingType === "Percent"
        ? (native.paragraph.lineSpacing ?? 160) / 100
        : undefined,
    selectionCollapsed: !native.context.hasSelection,
    selectionStateScope: "caret" as const,
    selectionKey: native.selectionKey,
    tableColumnEditing: native.tableColumnEditing === true,
    atomicTextInsertion: native.atomicTextInsertion === true,
    selectionDescription: native.selectionDescription,
    selectionText: native.selectionText,
    selectionTextLength: native.selectionTextLength,
    selectionGuardedCommands: native.selectionGuardedCommands === true,
    paragraph: {
      beforePt: (native.paragraph.spacingBefore ?? 0) * 0.75,
      afterPt: (native.paragraph.spacingAfter ?? 0) * 0.75,
      leftMm: ((native.paragraph.marginLeft ?? 0) * 25.4) / 96,
      rightMm: ((native.paragraph.marginRight ?? 0) * 25.4) / 96,
      firstLineMm: ((native.paragraph.indent ?? 0) * 25.4) / 96,
      lineSpacing: {
        rule: (native.paragraph.lineSpacingType === "Fixed"
          ? "exact"
          : native.paragraph.lineSpacingType === "Minimum"
            ? "atLeast"
            : "multiple") as "exact" | "atLeast" | "multiple",
        value: (native.paragraph.lineSpacing ?? 160) / 100,
      },
    },
    page: native.page
      ? {
          widthMm: (native.page.width * 25.4) / 7200,
          heightMm: (native.page.height * 25.4) / 7200,
          topMm: (native.page.marginTop * 25.4) / 7200,
          bottomMm: (native.page.marginBottom * 25.4) / 7200,
          leftMm: (native.page.marginLeft * 25.4) / 7200,
          rightMm: (native.page.marginRight * 25.4) / 7200,
          orientation: native.page.landscape
            ? ("landscape" as const)
            : ("portrait" as const),
        }
      : undefined,
    table: native.table
      ? { rows: native.table.rowCount, columns: native.table.colCount }
      : undefined,
  };
}
function activeFormat(native: NativeState, id: CommandId) {
  if (id === "bold" || id === "italic" || id === "underline")
    return native.character[id];
  if (id.startsWith("align"))
    return (
      native.paragraph.alignment?.toLowerCase() === id.slice(5).toLowerCase()
    );
  return undefined;
}
const engineCache = new Map<string, EngineDefinition>();
export function rhwpEngine(options: RhwpOptions): EngineDefinition {
  const initializationTimeoutMs = options.initializationTimeoutMs ?? 30000;
  if (
    !Number.isSafeInteger(initializationTimeoutMs) ||
    initializationTimeoutMs < 1000 ||
    initializationTimeoutMs > 120000
  )
    throw new RangeError(
      "initializationTimeoutMs must be an integer from 1000 to 120000.",
    );
  const studioUrl = new URL(
    options.studioUrl,
    globalThis.location?.href ?? "http://localhost/",
  );
  if (options.fontBaseUrl)
    studioUrl.searchParams.set(
      "fontBaseUrl",
      new URL(options.fontBaseUrl, studioUrl).href,
    );
  const cacheKey = JSON.stringify([studioUrl.href, initializationTimeoutMs]);
  const cached = engineCache.get(cacheKey);
  if (cached) return cached;
  // Only immutable configuration is captured; sessions remain local to each mounted view.
  options = { ...options };
  options.studioUrl = studioUrl.href;
  function RhwpView({
    document,
    onReady,
    onError,
    onSaveRequest,
    onFindRequest,
    onInitializationPhase,
    onInitializationDiagnostics,
    advancedTools,
    inputBlocked = false,
  }: EngineViewProps) {
    const formatLabel = document.format.toUpperCase();
    const container = useRef<HTMLDivElement>(null);
    const callbacks = useRef({
      onReady,
      onError,
      onSaveRequest,
      onFindRequest,
      onInitializationPhase,
      onInitializationDiagnostics,
    });
    const editorRef = useRef<RhwpEditor | null>(null);
    const blockedRef = useRef(inputBlocked);
    blockedRef.current = inputBlocked;
    const blocking = useRef<Promise<void>>(Promise.resolve());
    const setNativeBlocked = async (blocked: boolean) => {
      const editor = editorRef.current;
      if (!editor) return;
      const task = blocking.current
        .catch(() => undefined)
        .then(async () => {
          if (editorRef.current !== editor) return;
          const result = await editor.commands.execute(
            "ext:document-studio:input-block",
            { blocked },
          );
          if (!result.ok)
            throw new Error(
              result.message ?? "HWPX 입력 잠금을 적용하지 못했습니다.",
            );
        });
      blocking.current = task;
      await task;
    };
    useLayoutEffect(() => {
      void setNativeBlocked(inputBlocked).catch(onError);
    }, [inputBlocked]);
    const advancedRef = useRef(advancedTools);
    advancedRef.current = advancedTools;
    useEffect(() => {
      void editorRef.current?.chrome
        .set({ menu: Boolean(advancedTools), toolbar: false })
        .catch(onError);
    }, [advancedTools, onError]);
    callbacks.current = {
      onReady,
      onError,
      onSaveRequest,
      onFindRequest,
      onInitializationPhase,
      onInitializationDiagnostics,
    };
    useEffect(() => {
      let active = true;
      const startedAt = performance.now();
      const attemptId = crypto.randomUUID();
      let frameReadyVia: "load" | "runtime" | undefined;
      let bootFrame: HTMLIFrameElement | undefined;
      let stage: EngineInitializationStage = "iframe-loading";
      let transport: EngineInitializationDiagnostics["transport"];
      const steps: EngineInitializationDiagnostics["steps"] = [];
      const observations: NonNullable<
        EngineInitializationDiagnostics["observations"]
      > = [];
      const observeFrame = (input: {
        event?: unknown;
        width?: unknown;
        height?: unknown;
        visibility?: unknown;
      }) => {
        if (
          !active ||
          typeof input.event !== "string" ||
          ![
            "frame-attached",
            "frame-timeout",
            "script-start",
            "dom-ready",
            "window-loaded",
            "asset-error",
            "script-error",
            "promise-error",
            "viewport-changed",
            "page-hidden",
            "visibility-changed",
          ].includes(input.event)
        )
          return;
        const dimension = (value: unknown) =>
          typeof value === "number" &&
          Number.isFinite(value) &&
          value >= 0 &&
          value < 100_000
            ? Math.round(value)
            : undefined;
        if (observations.length >= 32) observations.splice(16, 1);
        observations.push({
          event: input.event,
          elapsedMs: Math.max(0, Math.round(performance.now() - startedAt)),
          width: dimension(input.width),
          height: dimension(input.height),
          visibility:
            input.visibility === "visible" || input.visibility === "hidden"
              ? input.visibility
              : undefined,
        });
        callbacks.current.onInitializationDiagnostics?.(diagnostics());
      };
      const recordStage = (
        next: EngineInitializationStage,
        mode?: EngineInitializationDiagnostics["transport"],
      ) => {
        if (!active) return;
        stage = next;
        transport = mode ?? transport;
        if (steps.at(-1)?.stage !== next)
          steps.push({
            stage: next,
            elapsedMs: Math.max(0, Math.round(performance.now() - startedAt)),
          });
        callbacks.current.onInitializationDiagnostics?.(diagnostics());
      };
      const diagnostics = (): EngineInitializationDiagnostics => ({
        attemptId,
        frameUrl: studioUrl.origin + studioUrl.pathname,
        frameReadyVia,
        frame: bootFrame ? readRhwpFrameState(bootFrame, studioUrl) : undefined,
        stage,
        transport,
        elapsedMs: Math.max(0, Math.round(performance.now() - startedAt)),
        steps: steps.map((step) => ({ ...step })),
        observations: observations.map((entry) => ({ ...entry })),
      });
      const abort = new AbortController();
      let initializationTimer: ReturnType<typeof setTimeout> | undefined;
      let diagnosticTimer: ReturnType<typeof setInterval> | undefined;
      let editor: RhwpEditor | null = null;
      let timer: ReturnType<typeof setInterval> | undefined;
      let polling = false;
      let documentChanged: ((state: NativeState) => void) | undefined;
      const pending = new Map<
        string,
        {
          resolve: (state: NativeState) => void;
          reject: (error: Error) => void;
          timer: ReturnType<typeof setTimeout>;
        }
      >();
      const calls = new Map<
        string,
        {
          resolve(value: unknown): void;
          reject(error: Error): void;
          timer: ReturnType<typeof setTimeout>;
        }
      >();
      const studioUrl = new URL(options.studioUrl, window.location.href);
      studioUrl.searchParams.set("documentStudioBootId", attemptId);
      // The host owns open/save and document identity; upstream embed mode disables native file replacement entry points.
      studioUrl.searchParams.set("chrome", "embed");
      studioUrl.searchParams.set(
        "documentStudioInputBlocked",
        String(blockedRef.current),
      );
      studioUrl.searchParams.set(
        "documentStudioOrigin",
        window.location.origin,
      );
      const onMessage = (event: MessageEvent) => {
        if (
          event.origin !== studioUrl.origin ||
          event.source !== editor?.element.contentWindow
        )
          return;
        if (event.data?.type === "document-studio:save") {
          callbacks.current.onSaveRequest();
          return;
        }
        if (event.data?.type === "document-studio:find") {
          callbacks.current.onFindRequest?.();
          return;
        }
        if (event.data?.type === "document-studio:rpc") {
          const task = calls.get(event.data.requestId);
          if (!task) return;
          clearTimeout(task.timer);
          calls.delete(event.data.requestId);
          if (event.data.error)
            task.reject(
              isTableReadErrorCode(event.data.code)
                ? new TableReadError(event.data.error, event.data.code)
                : event.data.code === "search-result-expired"
                  ? new SearchResultExpiredError()
                  : event.data.effect &&
                      ["none", "rolled-back", "unknown"].includes(
                        event.data.effect,
                      )
                    ? new TableEditError(event.data.error, event.data.effect)
                    : event.data.conflict
                      ? new SaveConflictError(event.data.error)
                      : new Error(event.data.error),
            );
          else task.resolve(event.data.result);
          return;
        }
        if (event.data?.type === "document-studio:changed") {
          const state = event.data.state;
          if (
            Number.isSafeInteger(state?.revision) &&
            state.revision >= 0 &&
            typeof state.context?.isDirty === "boolean" &&
            state.character &&
            state.paragraph
          )
            documentChanged?.(state);
          return;
        }
        if (event.data?.type !== "document-studio:rhwp-state") return;
        const task = pending.get(event.data.requestId);
        if (!task) return;
        clearTimeout(task.timer);
        pending.delete(event.data.requestId);
        task.resolve(event.data.state);
      };
      window.addEventListener("message", onMessage);
      const rpc = async <T,>(
        method: string,
        params: Record<string, unknown>,
      ): Promise<T> => {
        const requestId = crypto.randomUUID();
        const response = new Promise<T>((resolve, reject) => {
          const timer = setTimeout(() => {
            calls.delete(requestId);
            reject(new Error("HWPX 명령 응답이 지연됐습니다."));
          }, 15000);
          calls.set(requestId, {
            resolve: (value) => resolve(value as T),
            reject,
            timer,
          });
        });
        return receiveResponse(
          response,
          async () => {
            const result = await editor!.commands.execute(
              "ext:document-studio:rpc",
              { method, params, requestId },
            );
            if (!result.ok) throw new Error(result.message ?? result.reason);
          },
          (cause) => {
            const task = calls.get(requestId);
            if (task) {
              clearTimeout(task.timer);
              calls.delete(requestId);
              task.reject(cause);
            }
          },
        );
      };
      const readState = async (): Promise<NativeState> => {
        if (!editor) throw new Error("편집기를 준비하지 못했습니다.");
        const requestId = crypto.randomUUID();
        const response = new Promise<NativeState>((resolve, reject) => {
          const timeout = setTimeout(() => {
            pending.delete(requestId);
            reject(new Error("HWPX 편집기 상태 응답이 지연됐습니다."));
          }, 5000);
          pending.set(requestId, { resolve, reject, timer: timeout });
        });
        return receiveResponse(
          response,
          async () => {
            const result = await editor!.commands.execute(
              "ext:document-studio:state",
              { requestId },
            );
            if (!result.ok)
              throw new Error(
                `HWPX 상태 확장을 연결하지 못했습니다: ${result.reason}`,
              );
          },
          (cause) => {
            const task = pending.get(requestId);
            if (task) {
              clearTimeout(task.timer);
              pending.delete(requestId);
              task.reject(cause);
            }
          },
        );
      };
      const dispose = (
        reason: Error = new DOMException(
          "편집기가 종료됐습니다.",
          "AbortError",
        ),
      ) => {
        if (!active) return;
        active = false;
        clearTimeout(initializationTimer);
        clearInterval(diagnosticTimer);
        clearInterval(timer);
        window.removeEventListener("message", onMessage);
        abort.abort(reason);
        for (const task of pending.values()) {
          clearTimeout(task.timer);
          task.reject(reason);
        }
        pending.clear();
        for (const task of calls.values()) {
          clearTimeout(task.timer);
          task.reject(reason);
        }
        calls.clear();
        if (editorRef.current === editor) editorRef.current = null;
        editor?.destroy();
        bootFrame = undefined;
      };
      const failInitialization = (cause: unknown) => {
        if (!active) return;
        const failure =
          cause instanceof EngineInitializationError
            ? cause
            : new EngineInitializationError(
                "HWPX 편집기를 준비하지 못했습니다. 다시 시도해 주세요.",
                "engine-initialization-failed",
                { cause, diagnostics: diagnostics() },
              );
        dispose(failure);
        callbacks.current.onError(failure);
      };
      initializationTimer = setTimeout(() => {
        observeFrame({ event: "frame-timeout" });
        failInitialization(
          new EngineInitializationError(
            "HWPX 편집기 연결 시간이 초과됐습니다. 다시 시도해 주세요.",
            "engine-initialization-timeout",
            { diagnostics: diagnostics() },
          ),
        );
      }, initializationTimeoutMs);
      diagnosticTimer = setInterval(() => {
        if (active)
          callbacks.current.onInitializationDiagnostics?.(diagnostics());
      }, 1000);
      void (async () => {
        try {
          // StrictMode disposes its first effect before the next microtask. Do not
          // create an iframe for that cancelled initializer while its handshake waits.
          await Promise.resolve();
          if (!active || !container.current) return;
          callbacks.current.onInitializationPhase?.("connecting");
          // The pinned bundled upstream patch makes cancellation effective even
          // before createStudio returns an editor handle.
          const studioOptions = {
            studioUrl: studioUrl.href,
            chrome: { menu: false, toolbar: false, statusbar: false },
            signal: abort.signal,
            onInitializationStage: recordStage,
            onFrameObservation: observeFrame,
            onFrameCreated: (frame: HTMLIFrameElement) => {
              bootFrame = frame;
            },
            onFrameReady: (via: "load" | "runtime") => {
              frameReadyVia = via;
            },
          };
          const created = await createStudio(container.current!, studioOptions);
          if (!active) {
            created.destroy();
            return;
          }
          editor = created;
          editorRef.current = created;
          await created.chrome.set({
            menu: Boolean(advancedRef.current),
            toolbar: false,
          });
          editor.element.title = `${formatLabel} 문서 편집 영역`;
          abort.signal.throwIfAborted();
          callbacks.current.onInitializationPhase?.("opening");
          recordStage("document-opening");
          await editor.loadFile(document.bytes, document.fileName);
          abort.signal.throwIfAborted();
          recordStage("state-connecting");
          for (let attempt = 0; attempt < 100; attempt++) {
            if (!active) return;
            if (await editor.commands.isEnabled("ext:document-studio:state"))
              break;
            await new Promise<void>((resolve) => {
              const finish = () => {
                clearTimeout(wait);
                abort.signal.removeEventListener("abort", finish);
                resolve();
              };
              const wait = setTimeout(finish, 20);
              abort.signal.addEventListener("abort", finish, { once: true });
              if (abort.signal.aborted) finish();
            });
          }
          abort.signal.throwIfAborted();
          // The native Studio fits any iframe narrower than 1024px as a mobile view.
          // Embedded desktop panels need the same 100% opening scale as DOCX.
          // Apply this once per opened document; later user zoom choices are retained.
          const initialZoom = await editor.commands.execute(
            "ext:document-studio:zoom",
            {
              value: 1,
            },
          );
          if (!initialZoom.ok)
            throw new Error(
              initialZoom.message ?? "HWPX 초기 배율을 설정하지 못했습니다.",
            );
          const store = new SessionStore();
          await setNativeBlocked(blockedRef.current);
          const initial = await readState();
          const revisions = new RevisionState(
            String(initial.revision),
            Boolean(document.recovered),
          );
          let recoveryPending = Boolean(document.recovered);
          documentChanged = (native) => {
            if (!active) return;
            const previous = store.getSnapshot();
            if (!previous.ready || native.revision < Number(previous.revision))
              return;
            const revision = String(native.revision);
            const commands = Object.fromEntries(
              COMMAND_IDS.map((id) => {
                const command = previous.commands[id] ?? {
                  supported: false,
                  enabled: false,
                };
                return [
                  id,
                  {
                    ...command,
                    active: activeFormat(native, id),
                    enabled:
                      id === "undo"
                        ? command.supported && native.context.canUndo
                        : id === "redo"
                          ? command.supported && native.context.canRedo
                          : command.enabled,
                  },
                ];
              }),
            );
            store.update({
              ...previous,
              ...formatFields(native),
              commands,
              revision,
              dirty:
                revisions.dirty(revision) &&
                (native.context.isDirty || recoveryPending),
            });
          };
          const update = async () => {
            const native = await readState();
            const listed = await editor!.commands.list();
            if (
              !active ||
              native.revision < Number(store.getSnapshot().revision)
            )
              return;
            const commands = Object.fromEntries(
              COMMAND_IDS.map((id) => {
                const command = listed.find((item) => item.id === NATIVE[id]);
                return [
                  id,
                  {
                    supported: Boolean(command),
                    enabled: Boolean(command?.enabled),
                    reason: !command
                      ? "이 문서 형식에서는 지원하지 않는 도구입니다."
                      : !command.enabled
                        ? (id.startsWith("cell") ||
                            /Row|Column|Cell|Table|tableBorders/.test(id)) &&
                          !native.table
                          ? "표 안의 셀을 먼저 선택하세요."
                          : "현재 선택에서는 사용할 수 없습니다."
                        : undefined,
                    active: activeFormat(native, id),
                  },
                ];
              }),
            );
            const revision = String(native.revision);
            store.update({
              ready: true,
              atomicPresets: true,
              revision,
              dirty:
                revisions.dirty(revision) &&
                (native.context.isDirty || recoveryPending),
              ...formatFields(native),
              commands,
            });
          };
          const session: EditorSession = {
            async captureQuestionTarget() {
              const value = await rpc<
                import("@document-studio/core").EngineQuestionTarget
              >("captureQuestionTarget", {});
              await update();
              return value;
            },
            clearQuestionTarget() {
              void rpc("clearQuestionTarget", {}).catch(
                callbacks.current.onError,
              );
            },
            async getQuestionRects() {
              const rects = await rpc<
                import("@document-studio/core").QuestionRect[]
              >("getQuestionRects", {});
              const frame = editor!.element;
              const bounds = frame.getBoundingClientRect();
              const sx = frame.offsetWidth
                ? bounds.width / frame.offsetWidth
                : 1;
              const sy = frame.offsetHeight
                ? bounds.height / frame.offsetHeight
                : 1;
              return rects.map((rect) => ({
                left: bounds.left + rect.left * sx,
                top: bounds.top + rect.top * sy,
                right: bounds.left + rect.right * sx,
                bottom: bounds.top + rect.bottom * sy,
              }));
            },
            setInputBlocked: setNativeBlocked,
            getSnapshot: store.getSnapshot,
            subscribe: store.subscribe,
            async executePreset(commands, options) {
              for (const command of commands) validateCommand(command);
              await update();
              const plan = commands.map((command) => ({
                commandId: NATIVE[command.id],
                parameters:
                  "value" in command
                    ? {
                        value:
                          command.id === "lineSpacing"
                            ? command.value * 100
                            : command.value,
                      }
                    : undefined,
              }));
              options.assertCurrent();
              const result = await editor!.commands.execute(
                "ext:document-studio:preset",
                {
                  commands: plan,
                  expectedRevision: options.expectedRevision,
                  expectedSelectionKey: options.expectedSelectionKey,
                },
              );
              await update();
              if (
                !result.ok &&
                result.message === new SelectionConflictError().message
              )
                throw new SelectionConflictError();
              if (!result.ok)
                throw new Error(
                  result.message ??
                    "서식 묶음을 적용하지 못했습니다. 적용 전 상태로 복구했습니다.",
                );
            },
            async execute(command: EditorCommand, options) {
              validateCommand(command);
              if (!NATIVE[command.id])
                throw new Error("이 형식에서 지원하지 않는 명령입니다.");
              let value = "value" in command ? command.value : undefined;
              if (command.id === "insertImage") {
                const bitmap = await createImageBitmap(
                  new Blob([new Uint8Array(command.value.bytes).buffer], {
                    type: command.value.mimeType,
                  }),
                );
                value = {
                  ...command.value,
                  bytes: Array.from(command.value.bytes),
                  naturalWidth: bitmap.width,
                  naturalHeight: bitmap.height,
                } as unknown as typeof value;
                bitmap.close();
              }
              if (
                command.id === "lineSpacing" &&
                (!Number.isFinite(command.value) ||
                  command.value < 0.5 ||
                  command.value > 5)
              )
                throw new Error("행간은 0.5~5배로 입력해 주세요.");
              options?.assertCurrent?.();
              const result = await editor!.commands.execute(
                "ext:document-studio:execute",
                {
                  commandId: NATIVE[command.id],
                  parameters:
                    "value" in command
                      ? {
                          value:
                            command.id === "lineSpacing"
                              ? command.value * 100
                              : value,
                        }
                      : undefined,
                  expectedRevision: options?.expectedRevision,
                  expectedSelectionKey: options?.expectedSelectionKey,
                },
              );
              if (
                !result.ok &&
                result.message === new SelectionConflictError().message
              )
                throw new SelectionConflictError();
              if (!result.ok)
                throw new Error(
                  result.message ??
                    `명령을 적용하지 못했습니다: ${result.reason}`,
                );
              await update();
            },
            ...(() => {
              const table = createRhwpTableColumn({
                rpc,
                exportBytes: () => editor!.exportHwpx(),
                state: store.getSnapshot,
                update,
              });
              return { readTable: table.read, applyTableChanges: table.apply };
            })(),
            async readDocument() {
              await update();
              const revision = store.getSnapshot().revision;
              const bytes = await editor!.exportHwpx();
              await update();
              if (store.getSnapshot().revision !== revision)
                throw new SaveConflictError(
                  "문서를 읽는 동안 revision이 변경됐습니다. 다시 조회해 주세요.",
                );
              const zip = unzipSync(bytes);
              const paragraphs: { id: string; text: string }[] = [];
              for (const name of Object.keys(zip)
                .filter((name) => /^Contents\/section\d+\.xml$/.test(name))
                .sort(
                  (a, b) =>
                    Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]),
                )) {
                const xml = new DOMParser().parseFromString(
                  strFromU8(zip[name]!),
                  "application/xml",
                );
                if (xml.querySelector("parsererror"))
                  throw new Error("문서 내용을 읽지 못했습니다.");
                const nodes = Array.from(xml.getElementsByTagNameNS("*", "p"));
                for (const [index, node] of nodes.entries()) {
                  const texts = Array.from(
                    node.getElementsByTagNameNS("*", "t"),
                  ).filter((text) => {
                    let parent = text.parentElement;
                    while (parent && parent !== node) {
                      if (parent.localName === "p") return false;
                      parent = parent.parentElement;
                    }
                    return parent === node;
                  });
                  paragraphs.push({
                    id: `${name}:${index}`,
                    text: texts
                      .map((text) => {
                        const read = (node: Node): string => {
                          if (node.nodeType === Node.TEXT_NODE)
                            return node.textContent ?? "";
                          const name = (node as Element).localName;
                          if (name === "lineBreak") return "\n";
                          if (name === "tab") return "\t";
                          if (name === "nbSpace") return "\u00a0";
                          if (name === "fwSpace") return "\u3000";
                          return Array.from(node.childNodes).map(read).join("");
                        };
                        return read(text);
                      })
                      .join(""),
                  });
                }
              }
              const selected = paragraphs.slice(0, 10000);
              return {
                revision,
                paragraphs: selected,
                text: selected.map((p) => p.text).join("\n"),
                truncated: paragraphs.length > selected.length,
                scope: "body-and-tables",
              };
            },
            async search(input) {
              validateSearch(input);
              return rpc<SearchResult>("search", { ...input });
            },
            async selectMatch(id, expectedRevision) {
              await rpc("select", { id, expectedRevision });
              await update();
            },
            async replace(input, expectedRevision) {
              validateReplace(input);
              const result = await rpc<{ count: number }>("replace", {
                ...input,
                expectedRevision,
              });
              await update();
              return result;
            },
            async exportDocument() {
              await update();
              return captureExportSnapshot(
                document.format,
                () => store.getSnapshot().revision,
                () =>
                  document.format === "hwp"
                    ? exportVerifiedHwp(editor!, () =>
                        rpc<ReportedHwpExport>("exportHwp", {}),
                      )
                    : editor!.exportHwpx(),
                update,
              );
            },
            async exportInspection() {
              await update();
              return captureExportSnapshot(
                "hwpx",
                () => store.getSnapshot().revision,
                () => editor!.exportHwpx(),
                update,
              );
            },
            async markSaved(revision) {
              revisions.acknowledge(revision);
              recoveryPending = false;
              if (store.getSnapshot().revision === revision)
                await editor!.notifySaved(document.fileName);
              await update();
            },
          };
          await update();
          if (!active) return;
          clearTimeout(initializationTimer);
          clearInterval(diagnosticTimer);
          callbacks.current.onInitializationDiagnostics?.(diagnostics());
          callbacks.current.onReady(session);
          timer = setInterval(() => {
            if (
              polling ||
              !active ||
              window.document.visibilityState === "hidden"
            )
              return;
            polling = true;
            void update()
              .catch((cause) => {
                if (active)
                  callbacks.current.onError(
                    cause instanceof Error ? cause : new Error(String(cause)),
                  );
              })
              .finally(() => {
                polling = false;
              });
          }, 400);
        } catch (cause) {
          failInitialization(cause);
        }
      })();
      return () => dispose();
    }, [document]);
    return <div ref={container} className="ds-rhwp-surface" />;
  }
  const definition: EngineDefinition = {
    id: "rhwp",
    formats: ["hwpx", "hwp"],
    View: RhwpView,
    validateDocument: async (document, signal) => {
      const { runValidationWorker } = await import("@document-studio/core");
      return runValidationWorker(
        new Worker(new URL("./validation-worker.ts", import.meta.url), {
          type: "module",
        }),
        {
          bytes: document.bytes,
          format: document.format,
          studioUrl: new URL(options.studioUrl, window.location.href).href,
        },
        signal,
      );
    },
    createDocument: async (template) =>
      (await import("./templates")).createHwpxDocument(
        template,
        options.studioUrl,
      ),
  };
  engineCache.set(cacheKey, definition);
  return definition;
}
