import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  type EditorController,
  type DocumentCommitReceipt,
  type DocumentSavedEvent,
  browserDraftStore,
  draftKey,
  validateCommand,
  SaveConflictError,
  SelectionConflictError,
  PresetApplicationError,
  EngineInitializationError,
  INITIALIZATION_STAGE_LABELS,
  type EngineInitializationPhase,
  type EngineInitializationState,
  type CommandId,
  type DocumentDraft,
  type DocumentStorage,
  type DraftStore,
  type EditorCommand,
  type EditorDocument,
  type EditorSession,
  type EditorSnapshot,
  type ExportSnapshot,
  type StorageWarning,
  type DocumentContent,
  type SearchOptions,
  type SearchResult,
  type ReplaceRequest,
  type DocumentPreset,
  validateSearch,
  validateReplace,
  validateDocumentAsync,
  validateSaveResult,
  createTableColumnEditor,
  TableEditError,
  type TableSnapshot,
  type TableCellChange,
  createQuickActionEditor,
  REPORT_PRESETS,
  QuickActionError,
  createMailMergeSession,
  MAIL_MERGE_DRAFT_NAME,
  MailMergeError,
  type MailMergeStatus,
  type GeneratedOutputStorage,
  createDocumentQuestionSession,
  type DocumentQuestionRequest,
  type DocumentQuestionTarget,
} from "@document-studio/core";
import type { EngineDefinition } from "./types";
import { ModalDialog } from "./modal-dialog";
import { EngineErrorBoundary } from "./engine-error-boundary";
import { EditingTools } from "./editing-tools";
import { AutomationSession } from "./automation-session";
import type { AutomationDraftStore } from "./automation-drafts";
import { matchesSavedSource, type SavedSource } from "./save-source";
import { fitPageWidth } from "./fit-page-width";
import {
  EDITOR_TOOL_TABS,
  EditorRegion,
  editorThemeStyle,
  type EditorUIOptions,
  type EditorUISlots,
  type EditorUIContext,
} from "./editor-ui";
import {
  resolveRecovery,
  RecoveryUnavailableError,
  type RecoveryResolution,
} from "./recovery";

const EMPTY: EditorSnapshot = {
  ready: false,
  revision: "0",
  dirty: false,
  zoom: 1,
  pageCount: 0,
  commands: {},
};
const noSubscription = () => () => {};
const emptySnapshot = () => EMPTY;
export type DocumentEditorHandle = EditorController;
export type {
  DocumentCommitReceipt,
  DocumentSavedEvent,
} from "@document-studio/core";
export interface DocumentEditorProps {
  document: EditorDocument;
  engines: readonly EngineDefinition[];
  storage?: DocumentStorage;
  /** Saves generated copies through the host; original document storage remains separate. */
  generatedStorage?: GeneratedOutputStorage;
  /** Called only after the user explicitly submits a question about a verified paragraph. */
  onQuestion?(request: DocumentQuestionRequest): Promise<void>;
  /** Open a confirmed stored copy through the host's navigation and permission checks. */
  onOpenStoredCopy?(
    file: import("@document-studio/core").GeneratedStoredFile,
  ): Promise<void>;
  draftStore?: DraftStore | false;
  draftNamespace?: string;
  /** The host retains authority; readonly views can still export their current document. */
  readOnly?: boolean;
  /** Initial viewing mode; subsequent user zoom choices remain authoritative. */
  initialZoom?: "actual" | "width";
  /** Opt in to storing automation source fields separately from document bytes. Use an owner-scoped draftNamespace. */
  automationDraftStore?: AutomationDraftStore | false;
  /** Embedded mode omits the SDK title/action header and inherits the host's design tokens. */
  appearance?: "standalone" | "embedded";
  ui?: EditorUIOptions;
  /** Customize ordinary chrome; recovery dialogs and safety notices remain SDK-owned. */
  slots?: EditorUISlots;
  onStateChange?(snapshot: EditorSnapshot): void;
  onDirtyChange?(dirty: boolean): void;
  onSaved?(result: DocumentSavedEvent): void | Promise<void>;
  onClose?(): void;
  presets?: readonly DocumentPreset[];
  onCreateDocument?(document: EditorDocument): void | Promise<void>;
  /** Human-readable destination supplied by the host; the host still owns path validation. */
  creationLocation?: string;
}
export function downloadDocument(
  bytes: Uint8Array,
  fileName: string,
  format: string,
): void {
  const copy = new Uint8Array(bytes);
  const url = URL.createObjectURL(
    new Blob([copy.buffer], {
      type:
        format === "hwpx"
          ? "application/hwp+zip"
          : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }),
  );
  const link = window.document.createElement("a");
  link.href = url;
  link.download = fileName;
  window.document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const DocumentEditor = forwardRef<
  DocumentEditorHandle,
  DocumentEditorProps
>(function DocumentEditorView(props, ref) {
  const { document: input, engines, storage, onClose } = props;
  const dialogId = useId();
  const latest = useRef(props);
  const previousReadOnly = useRef(Boolean(props.readOnly));
  const permissionGeneration = useRef(0);
  if (!previousReadOnly.current && props.readOnly)
    permissionGeneration.current++;
  previousReadOnly.current = Boolean(props.readOnly);
  latest.current = props;
  const defaultDrafts = useRef<DraftStore | null>(null);
  defaultDrafts.current ??= browserDraftStore();
  const drafts =
    props.draftStore === false
      ? null
      : (props.draftStore ?? defaultDrafts.current);
  const key = draftKey(props.draftNamespace ?? "document-studio", input.id);
  const [document, setDocument] = useState<EditorDocument | null>(null);
  const [offer, setOffer] = useState<DocumentDraft | null>(null);
  const [corruptRecovery, setCorruptRecovery] = useState("");
  const recoveryContext = useRef<{
    source: EditorDocument;
    store: DraftStore | null;
    key: string;
  } | null>(null);
  const editingSource = useRef<EditorDocument | null>(null);
  const [session, setSession] = useState<EditorSession | null>(null);
  const [error, setError] = useState("");
  const [recoveryUnavailable, setRecoveryUnavailable] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const sessionId = useRef(crypto.randomUUID());
  const engineMountId = useRef(crypto.randomUUID());
  const readyMount = useRef<string | null>(null);
  const engineFailure = useRef<EngineInitializationError | null>(null);
  const [initializationError, setInitializationError] =
    useState<EngineInitializationError | null>(null);
  const [initializationPhase, setInitializationPhase] =
    useState<EngineInitializationPhase>("validating");
  const initializationPhaseRef = useRef(initializationPhase);
  const updateInitializationPhase = (phase: EngineInitializationPhase) => {
    initializationPhaseRef.current = phase;
    setInitializationPhase(phase);
  };
  const [notice, setNotice] = useState("");
  const [saveWarnings, setSaveWarnings] = useState<readonly StorageWarning[]>(
    [],
  );
  const warningsRef = useRef(saveWarnings);
  warningsRef.current = saveWarnings;
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [toolsExpanded, setToolsExpanded] = useState(false);
  const externalTools = Boolean(props.ui?.containers?.tools);
  const overlayTools = toolsExpanded && !externalTools;
  const expandedTools = useRef(false);
  expandedTools.current = overlayTools;
  const toolsToggle = useRef<HTMLButtonElement>(null);
  const toolsReturnFocus = useRef<HTMLElement | null>(null);
  const closeTools = () => {
    setToolsExpanded(false);
    setToolsOpen(false);
    requestAnimationFrame(() => {
      const target = toolsReturnFocus.current?.isConnected
        ? toolsReturnFocus.current
        : toolsToggle.current;
      target?.focus({ preventScroll: true });
      toolsReturnFocus.current = null;
    });
  };
  const [toolsTab, setToolsTab] = useState("문단");
  const [nativeTools, setNativeTools] = useState(false);
  const [fitWidth, setFitWidth] = useState(props.initialZoom === "width");
  const [viewportWidth, setViewportWidth] = useState(0);
  const [conflict, setConflict] = useState(false);
  const [closeDialog, setCloseDialog] = useState(false);
  const [copyPreview, setCopyPreview] = useState<EditorDocument | null>(null);
  const mailMergeRef = useRef<ReturnType<typeof createMailMergeSession> | null>(
    null,
  );
  const [mailStatus, setMailStatus] = useState<MailMergeStatus | null>(null);
  const outputPending = () => {
    const state = mailMergeRef.current?.getSnapshot();
    return Boolean(
      state?.phase === "running" || state?.saving || state?.pendingOutput,
    );
  };
  const [pendingDocument, setPendingDocument] = useState<EditorDocument | null>(
    null,
  );
  const acceptedInput = useRef<EditorDocument | null>(null);
  const savedSource = useRef<SavedSource | null>(null);
  const lastCommit = useRef<
    (Omit<DocumentCommitReceipt, "digest"> & { bytes: Uint8Array }) | null
  >(null);
  const committedRevision = useRef<{
    documentId: string;
    revision: string;
    engineAcknowledged: boolean;
  } | null>(null);
  const transitionPermit = useRef<string | null>(null);
  const acceptedScope = useRef(props.draftNamespace ?? "document-studio");
  const activeDrafts = useRef<DraftStore | null>(null);
  const pendingLoad = useRef<AbortController | null>(null);
  const [sourceBlocked, setSourceBlocked] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);
  const inputLocks = useRef(new Set<symbol>());
  const [inputLockCount, setInputLockCount] = useState(0);
  const modalBlocked = useRef(false);
  const automationPending = useRef(false);
  const automationReady = useRef(true);
  modalBlocked.current = closeDialog || Boolean(offer) || Boolean(copyPreview);
  const mutationBlockReason = () =>
    latest.current.readOnly || inputLocks.current.size > 0
      ? "읽기 전용 문서입니다."
      : modalBlocked.current
        ? "확인창을 닫은 뒤 편집해 주세요."
        : busyRef.current
          ? "저장 중에는 문서 명령을 실행할 수 없습니다. 진행 중인 작업을 완료해 주세요."
          : undefined;
  const assertNewMutation = () => {
    const reason = mutationBlockReason();
    if (reason) throw new Error(reason);
  };
  const inputBlocked =
    !session ||
    busy ||
    overlayTools ||
    inputLockCount > 0 ||
    modalBlocked.current ||
    Boolean(props.readOnly);
  const syncInputBlock = useCallback(async () => {
    const blocked =
      !session ||
      busyRef.current ||
      expandedTools.current ||
      inputLocks.current.size > 0 ||
      modalBlocked.current ||
      Boolean(latest.current.readOnly);
    if (body.current) body.current.inert = blocked;
    await session?.setInputBlocked?.(blocked);
  }, [session]);
  const acquireInputLock = useCallback(async () => {
    if (!mounted.current || !session?.getSnapshot().ready)
      throw new Error("편집기를 준비하는 중입니다.");
    const lock = Symbol();
    const identity = sessionId.current;
    inputLocks.current.add(lock);
    setInputLockCount(inputLocks.current.size);
    const release = async () => {
      if (!inputLocks.current.delete(lock)) return;
      if (mounted.current) setInputLockCount(inputLocks.current.size);
      await syncInputBlock();
    };
    try {
      await syncInputBlock();
      if (
        !mounted.current ||
        sessionId.current !== identity ||
        !inputLocks.current.has(lock)
      )
        throw new Error("편집 화면이 변경됐습니다.");
      return release;
    } catch (cause) {
      await release().catch(() => undefined);
      throw cause;
    }
  }, [session, syncInputBlock]);
  const baseVersion = useRef(input.version);
  const draftExport = useRef<Promise<void> | null>(null);
  const commandTasks = useRef(new Set<Promise<void>>());
  const inFlightSave = useRef<Promise<void> | null>(null);
  const [pendingCommands, setPendingCommands] = useState(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const nativeSnapshot = useSyncExternalStore(
    session?.subscribe ?? noSubscription,
    session?.getSnapshot ?? emptySnapshot,
    emptySnapshot,
  );
  const effectiveSnapshot = (state: EditorSnapshot) =>
    committedRevision.current &&
    committedRevision.current.documentId === document?.id &&
    committedRevision.current.revision === state.revision
      ? { ...state, dirty: false }
      : committedRevision.current?.documentId === document?.id &&
          !committedRevision.current?.engineAcknowledged &&
          state.ready
        ? { ...state, dirty: true }
        : state;
  const readOnlySnapshot = (state: EditorSnapshot) =>
    mutationBlockReason()
      ? {
          ...state,
          commands: Object.fromEntries(
            Object.entries(state.commands).map(([id, command]) => [
              id,
              command &&
                (id === "zoom" &&
                !modalBlocked.current &&
                !inputLocks.current.size &&
                !busyRef.current
                  ? command
                  : {
                      ...command,
                      enabled: false,
                      reason: mutationBlockReason(),
                    }),
            ]),
          ) as EditorSnapshot["commands"],
        }
      : state;
  const initializationState = (ready: boolean): EngineInitializationState =>
    ready
      ? { status: "ready" }
      : engineFailure.current
        ? {
            status: "failed",
            error: {
              code: engineFailure.current.code,
              message: engineFailure.current.message,
              retryable: true,
              diagnostics: engineFailure.current.diagnostics
                ? structuredClone(engineFailure.current.diagnostics)
                : undefined,
            },
          }
        : !document && error && !offer
          ? {
              status: "failed",
              error: {
                code: "engine-initialization-failed",
                message: error,
                retryable: false,
              },
            }
          : { status: "loading", phase: initializationPhaseRef.current };
  const snapshot = {
    ...readOnlySnapshot(effectiveSnapshot(nativeSnapshot)),
    initialization: initializationState(nativeSnapshot.ready),
    busy: busy || pendingCommands > 0,
    saving,
    pendingCommands,
    automationDraftPending: false,
    generatedOutputPending: outputPending(),
    generatedOutputCount: mailStatus?.pendingOutput?.receipt.files.length ?? 0,
  };
  const liveSnapshot = () =>
    readOnlySnapshot({
      ...effectiveSnapshot(session?.getSnapshot() ?? snapshotRef.current),
      initialization: initializationState(
        session?.getSnapshot().ready ?? false,
      ),
      busy: busyRef.current || commandTasks.current.size > 0,
      saving,
      pendingCommands: commandTasks.current.size,
      automationDraftPending: automationPending.current,
      automationDraftReady: automationSession.getSnapshot().ready,
      automationDraftError: automationSession.getSnapshot().error,
      generatedOutputPending: outputPending(),
      generatedOutputCount:
        mailMergeRef.current?.getSnapshot().pendingOutput?.receipt.files
          .length ?? 0,
    });
  const matchesAcceptedSource = (next: EditorDocument) => {
    const previous = acceptedInput.current;
    return Boolean(
      previous &&
        acceptedScope.current ===
          (latest.current.draftNamespace ?? "document-studio") &&
        previous.id === next.id &&
        previous.format === next.format &&
        ((previous.version === next.version && previous.bytes === next.bytes) ||
          matchesSavedSource(
            savedSource.current,
            next,
            sessionId.current,
            acceptedScope.current,
          )),
    );
  };
  const inputMismatch = Boolean(document && !matchesAcceptedSource(input));
  const activeDraftStore = () => {
    if (latest.current.draftStore === false) return null;
    // Only a successfully inspected store may receive writes/cleanup. A prop change
    // must never redirect an export to a key whose recovery record is still unknown.
    return activeDrafts.current;
  };
  const setEditableDocument = (value: EditorDocument | null) => {
    if (editingSource.current !== value) {
      sessionId.current = crypto.randomUUID();
      engineMountId.current = crypto.randomUUID();
      readyMount.current = null;
      engineFailure.current = null;
      setInitializationError(null);
      updateInitializationPhase(value ? "connecting" : "validating");
    }
    editingSource.current = value;
    setDocument(value);
  };
  const acceptSource = (
    source: EditorDocument,
    store: DraftStore | null,
    scope: string,
    resolution: RecoveryResolution,
  ) => {
    mailMergeRef.current?.assertCanLeave();
    acceptedInput.current = source;
    acceptedScope.current = scope;
    activeDrafts.current = store;
    committedRevision.current = null;
    savedSource.current = null;
    transitionPermit.current = null;
    baseVersion.current = source.version;
    setSession(null);
    setPendingDocument(null);
    setSourceBlocked(false);
    setConflict(false);
    setNotice("");
    setSaveWarnings([]);
    setError(resolution.kind === "draft" ? "" : (resolution.warning ?? ""));
    setRecoveryUnavailable(false);
    if (resolution.kind === "source") {
      recoveryContext.current = null;
      setOffer(null);
      setCorruptRecovery("");
      setEditableDocument(source);
    } else {
      recoveryContext.current = {
        source,
        store,
        key: draftKey(scope, source.id),
      };
      setOffer(resolution.draft);
      setCorruptRecovery(
        resolution.kind === "corrupt" ? resolution.warning : "",
      );
      setEditableDocument(null);
    }
  };
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const activeKey = draftKey(acceptedScope.current, document?.id ?? input.id);
  const displayed = document ?? input;
  const automationContext = useMemo(
    () => ({}),
    [
      input.id,
      input.format,
      input.bytes,
      input.version,
      props.draftNamespace,
      sessionId.current,
    ],
  );
  const automationSession = useMemo(
    () =>
      new AutomationSession(
        props.automationDraftStore
          ? {
              store: props.automationDraftStore,
              key: draftKey(
                props.draftNamespace ?? "document-studio",
                displayed.id,
              ),
            }
          : undefined,
      ),
    [
      displayed.id,
      sessionId.current,
      props.draftNamespace,
      props.automationDraftStore,
    ],
  );
  const automationStatus = useSyncExternalStore(
    automationSession.subscribe,
    automationSession.getSnapshot,
    automationSession.getSnapshot,
  );
  automationPending.current = automationStatus.pending;
  automationReady.current = automationStatus.ready;
  snapshot.automationDraftPending = automationStatus.pending;
  snapshot.automationDraftReady = automationStatus.ready;
  snapshot.automationDraftError = automationStatus.error;
  useEffect(() => {
    void automationSession.start().catch(() => undefined);
    return () => automationSession.dispose();
  }, [automationSession]);
  useEffect(() => {
    if (
      !automationStatus.ready ||
      automationStatus.pending ||
      automationStatus.error
    )
      return;
    setSaveWarnings((current) =>
      current.some((warning) => warning.code === "automation-draft-pending")
        ? current.filter(
            (warning) => warning.code !== "automation-draft-pending",
          )
        : current,
    );
  }, [
    automationStatus.ready,
    automationStatus.pending,
    automationStatus.error,
  ]);
  useEffect(() => {
    const previous = acceptedInput.current;
    if (
      matchesAcceptedSource(input) &&
      activeDrafts.current === drafts &&
      (document || offer)
    ) {
      acceptedInput.current = input;
      activeDrafts.current = drafts;
      setSourceBlocked(false);
      setPendingDocument(null);
      return;
    }
    let active = true;
    const abort = new AbortController();
    setSourceBlocked(true);
    void (async () => {
      try {
        if (matchesAcceptedSource(input) && document) {
          // Storage policy changes must not remount the engine or discard its live edits.
          // Inspect the new key before adopting the store; existing drafts require consent.
          const validator =
            engines.find((engine) => engine.formats.includes(input.format))
              ?.validateDocument ?? validateDocumentAsync;
          const resolution = await resolveRecovery(
            input,
            drafts,
            key,
            validator,
            abort.signal,
          );
          if (!active) return;
          setRecoveryUnavailable(false);
          if (resolution.kind === "source") {
            activeDrafts.current = drafts;
            setSourceBlocked(false);
            setPendingDocument(null);
            setError("");
          } else {
            setPendingDocument(input);
            setError(
              "새 초안 저장소에 복구 자료가 있습니다. 현재 편집본을 유지한 채 새 저장소의 초안을 확인해 주세요.",
            );
          }
          return;
        }
        const validate = engines.find((engine) =>
          engine.formats.includes(input.format),
        )?.validateDocument;
        await (validate
          ? validate(input, abort.signal)
          : validateDocumentAsync(input, abort.signal));
        if (!active) return;
        const needsConsent = () => {
          const current = liveSnapshot();
          const different =
            previous &&
            (previous.id !== input.id ||
              previous.format !== input.format ||
              acceptedScope.current !==
                (props.draftNamespace ?? "document-studio"));
          const approved =
            different &&
            !outputPending() &&
            !automationPending.current &&
            automationReady.current &&
            (transitionPermit.current === current.revision || !current.dirty);
          return Boolean(
            previous &&
              (current.ready || current.dirty || busyRef.current) &&
              (!approved || busyRef.current),
          );
        };
        if (needsConsent()) {
          setPendingDocument(input);
          setError(
            "원본 문서가 변경됐습니다. 현재 편집본은 유지됩니다. 초안을 다운로드하거나 새 원본을 열어 주세요.",
          );
          return;
        }
        const validateSource = validate ?? validateDocumentAsync;
        const resolution = await resolveRecovery(
          input,
          drafts,
          key,
          validateSource,
          abort.signal,
        );
        if (!active) return;
        if (needsConsent()) {
          setPendingDocument(input);
          setError(
            "원본 문서가 변경됐습니다. 현재 편집본은 유지됩니다. 초안을 다운로드하거나 새 원본을 열어 주세요.",
          );
          return;
        }
        acceptSource(
          input,
          drafts,
          props.draftNamespace ?? "document-studio",
          resolution,
        );
      } catch (cause) {
        if (active) {
          setRecoveryUnavailable(cause instanceof RecoveryUnavailableError);
          setError(cause instanceof Error ? cause.message : String(cause));
          // Keep the previous session, but it can never save through a new/invalid target.
          setSourceBlocked(true);
        }
      }
    })();
    return () => {
      active = false;
      abort.abort();
      pendingLoad.current?.abort();
    };
  }, [input, drafts, key, loadAttempt]);
  useEffect(() => {
    latest.current.onDirtyChange?.(snapshot.dirty);
  }, [snapshot.dirty]);
  const stateSignature = JSON.stringify(snapshot);
  useEffect(() => {
    latest.current.onStateChange?.(snapshot);
  }, [stateSignature]);
  const reportError = useCallback(
    (cause: Error) => setError(cause.message),
    [],
  );
  const retryInitialization = () => {
    if (
      !engineFailure.current ||
      !document ||
      readyMount.current ||
      inputMismatch ||
      sourceBlocked ||
      busyRef.current
    )
      throw new Error("실패한 편집기 초기화만 다시 시도할 수 있습니다.");
    if (automationSession.getSnapshot().pending)
      throw new Error("자동화 입력을 보관한 뒤 다시 시도해 주세요.");
    engineFailure.current = null;
    engineMountId.current = crypto.randomUUID();
    sessionId.current = crypto.randomUUID();
    setInitializationError(null);
    updateInitializationPhase("connecting");
    setError("");
    setSession(null);
  };
  useLayoutEffect(() => {
    void syncInputBlock().catch(reportError);
  }, [inputBlocked, session, syncInputBlock, reportError]);
  const execute = useCallback(
    async (
      command: EditorCommand,
      options?: { expectedRevision?: string; expectedSelectionKey?: string },
    ) => {
      validateCommand(command);
      if (command.id !== "zoom") assertNewMutation();
      else if (modalBlocked.current || inputLocks.current.size)
        throw new Error("화면 전환 작업을 마친 뒤 확대를 변경해 주세요.");
      if (
        !session ||
        !session.getSnapshot().ready ||
        editingSource.current !== document
      )
        throw new Error("편집기를 준비하는 중입니다.");
      if (busyRef.current)
        throw new Error("저장 중에는 편집 명령을 실행할 수 없습니다.");
      if (
        options?.expectedRevision !== undefined &&
        options.expectedRevision !== session.getSnapshot().revision
      )
        throw new SaveConflictError(
          "편집 revision이 변경됐습니다. 현재 상태를 확인한 뒤 다시 실행해 주세요.",
        );
      const commandState = session.getSnapshot().commands[command.id];
      if (!commandState?.supported || !commandState.enabled)
        throw new Error(
          commandState?.reason ??
            "현재 선택에서는 이 명령을 사용할 수 없습니다.",
        );
      const guarded = options?.expectedSelectionKey !== undefined;
      if (guarded && command.id === "insertImage")
        throw new Error(
          "에이전트의 비동기 그림 삽입은 권한·범위 보장을 지원하지 않습니다. 호스트의 그림 삽입 흐름을 사용해 주세요.",
        );
      if (guarded && !session.getSnapshot().selectionGuardedCommands)
        throw new Error(
          "이 엔진은 선택 범위를 보장하는 명령을 지원하지 않습니다.",
        );
      const identity = sessionId.current;
      const permission = permissionGeneration.current;
      const earlier = [...commandTasks.current];
      if (guarded) {
        busyRef.current = true;
        setBusy(true);
        if (body.current) body.current.inert = true;
      }
      const task = (async () => {
        if (guarded) {
          await syncInputBlock();
          await Promise.all(earlier);
          if (
            !mounted.current ||
            identity !== sessionId.current ||
            permission !== permissionGeneration.current ||
            latest.current.readOnly ||
            !matchesAcceptedSource(latest.current.document)
          )
            throw new SaveConflictError("문서 또는 편집 권한이 변경됐습니다.");
          if (
            options.expectedSelectionKey !== session.getSnapshot().selectionKey
          )
            throw new SelectionConflictError();
        }
        return session.execute(
          command,
          guarded
            ? {
                ...options,
                assertCurrent: () => {
                  if (
                    !mounted.current ||
                    identity !== sessionId.current ||
                    permission !== permissionGeneration.current ||
                    latest.current.readOnly ||
                    !matchesAcceptedSource(latest.current.document)
                  )
                    throw new SaveConflictError(
                      "문서 또는 편집 권한이 변경됐습니다.",
                    );
                },
              }
            : options,
        );
      })();
      commandTasks.current.add(task);
      setPendingCommands(commandTasks.current.size);
      try {
        await task;
      } finally {
        commandTasks.current.delete(task);
        if (mounted.current) setPendingCommands(commandTasks.current.size);
        if (guarded) {
          busyRef.current = false;
          setBusy(false);
          await syncInputBlock().catch(reportError);
        }
      }
    },
    [session, document],
  );
  const run = (command: EditorCommand) => {
    setNotice("");
    void execute(command).catch(reportError);
  };
  useEffect(() => {
    const element = body.current;
    if (!element) return;
    const measure = () => setViewportWidth(element.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [session, document]);
  useEffect(() => {
    if (
      !fitWidth ||
      !snapshot.ready ||
      snapshot.busy ||
      !snapshot.commands.zoom?.enabled
    )
      return;
    const value = fitPageWidth(viewportWidth, snapshot.page?.widthMm);
    if (value === undefined || Math.abs(snapshot.zoom - value) < 0.005) return;
    void execute({ id: "zoom", value }).catch((cause) => {
      setFitWidth(false);
      reportError(cause instanceof Error ? cause : new Error(String(cause)));
    });
  }, [
    fitWidth,
    viewportWidth,
    snapshot.page?.widthMm,
    snapshot.zoom,
    snapshot.ready,
    snapshot.busy,
    execute,
    reportError,
  ]);
  const runSessionTask = useCallback(
    async <T,>(operation: (active: EditorSession) => Promise<T>) => {
      if (!session?.getSnapshot().ready || editingSource.current !== document)
        throw new Error("편집기를 준비하는 중입니다.");
      if (busyRef.current)
        throw new Error("저장 중에는 문서 명령을 실행할 수 없습니다.");
      const task = operation(session);
      const tracked = task.then(() => {});
      // The original promise is returned to the caller; observe this tracking branch too.
      void tracked.catch(() => {});
      commandTasks.current.add(tracked);
      setPendingCommands(commandTasks.current.size);
      try {
        return await task;
      } finally {
        commandTasks.current.delete(tracked);
        if (mounted.current) setPendingCommands(commandTasks.current.size);
      }
    },
    [session, document],
  );
  const readDocument = useCallback(
    () =>
      runSessionTask((active) => {
        if (!active.readDocument)
          throw new Error("이 엔진은 문서 조회를 지원하지 않습니다.");
        return active.readDocument();
      }),
    [runSessionTask],
  );
  const search = useCallback(
    (input: SearchOptions) => {
      validateSearch(input);
      return runSessionTask((active) => {
        if (!active.search)
          throw new Error("이 엔진은 검색을 지원하지 않습니다.");
        return active.search(input);
      });
    },
    [runSessionTask],
  );
  const selectMatch = useCallback(
    (id: string, expectedRevision: string) =>
      runSessionTask((active) => {
        if (!active.selectMatch)
          throw new Error("이 엔진은 검색 위치 선택을 지원하지 않습니다.");
        return active.selectMatch(id, expectedRevision);
      }),
    [runSessionTask],
  );
  const replace = useCallback(
    (input: ReplaceRequest, expectedRevision: string) => {
      assertNewMutation();
      validateReplace(input);
      return runSessionTask((active) => {
        if (!active.replace)
          throw new Error("이 엔진은 치환을 지원하지 않습니다.");
        return active.replace(input, expectedRevision);
      });
    },
    [runSessionTask],
  );
  const readTableNative = useCallback(
    () =>
      runSessionTask((active) => {
        if (!active.readTable)
          throw new TableEditError(
            "이 엔진은 표 열 편집을 지원하지 않습니다.",
            "none",
          );
        return active.readTable();
      }),
    [runSessionTask],
  );
  const applyTableNative = async (
    table: TableSnapshot,
    changes: readonly TableCellChange[],
  ) => {
    assertNewMutation();
    if (!session?.applyTableChanges || busyRef.current)
      throw new TableEditError(
        "표 편집을 준비한 뒤 다시 적용해 주세요.",
        "none",
      );
    const identity = sessionId.current,
      scope = acceptedScope.current,
      permission = permissionGeneration.current;
    const assertCurrent = () => {
      if (
        !mounted.current ||
        identity !== sessionId.current ||
        scope !== acceptedScope.current ||
        permission !== permissionGeneration.current ||
        latest.current.readOnly ||
        editingSource.current !== document ||
        !matchesAcceptedSource(latest.current.document)
      )
        throw new SaveConflictError("문서 또는 편집 권한이 변경됐습니다.");
    };
    assertCurrent();
    busyRef.current = true;
    setBusy(true);
    if (body.current) body.current.inert = true;
    const earlier = [...commandTasks.current];
    const task = (async () => {
      await syncInputBlock();
      await Promise.all(earlier);
      assertCurrent();
      await session.applyTableChanges!(table, changes, assertCurrent);
    })();
    commandTasks.current.add(task);
    setPendingCommands(commandTasks.current.size);
    try {
      await task;
    } finally {
      commandTasks.current.delete(task);
      if (mounted.current) setPendingCommands(commandTasks.current.size);
      busyRef.current = false;
      setBusy(false);
      await syncInputBlock().catch(reportError);
    }
  };
  const tablePort = useRef<Parameters<typeof createTableColumnEditor>[0]>(
    null!,
  );
  tablePort.current = {
    state: () => {
      if (
        !mounted.current ||
        !session?.getSnapshot().ready ||
        editingSource.current !== document ||
        !matchesAcceptedSource(latest.current.document)
      )
        throw new SaveConflictError("표의 문서 세션이 변경됐습니다.");
      return {
        ...liveSnapshot(),
        documentId: displayed.id,
        sessionId: sessionId.current,
      };
    },
    read: readTableNative,
    apply: applyTableNative,
  };
  const tableActions = useRef<ReturnType<
    typeof createTableColumnEditor
  > | null>(null);
  tableActions.current ??= createTableColumnEditor({
    state: () => tablePort.current.state(),
    read: () => tablePort.current.read(),
    apply: (...args) => tablePort.current.apply(...args),
  });
  const tableColumn = tableActions.current;
  const applyPreset = useCallback(
    async (
      preset: DocumentPreset,
      expectedRevision?: string,
      expectedSelectionKey?: string,
    ) => {
      assertNewMutation();
      if (
        !preset ||
        !Array.isArray(preset.commands) ||
        !preset.commands.length ||
        preset.commands.length > 64
      )
        throw new Error("서식 명령 수가 허용 범위를 벗어났습니다.");
      const formatting = new Set([
        "bold",
        "italic",
        "underline",
        "strike",
        "superscript",
        "subscript",
        "clearFormatting",
        "alignLeft",
        "alignCenter",
        "alignRight",
        "alignJustify",
        "fontFamily",
        "fontSize",
        "lineSpacing",
        "textColor",
        "highlightColor",
        "characterSpacing",
        "characterScale",
        "paragraphFormat",
        "bulletList",
        "numberedList",
        "increaseIndent",
        "decreaseIndent",
      ]);
      for (const command of preset.commands as readonly EditorCommand[]) {
        validateCommand(command);
        if (!formatting.has(command.id))
          throw new Error(
            "서식 preset에는 글자·문단 명령만 사용할 수 있습니다.",
          );
        const capability = session?.getSnapshot().commands[command.id];
        if (!capability?.supported || !capability.enabled)
          throw new Error(
            `이 문서에서 지원하지 않는 서식입니다: ${command.id}`,
          );
      }
      if (!session?.getSnapshot().ready || busyRef.current)
        throw new Error("편집 작업을 완료한 뒤 서식을 적용해 주세요.");
      if (
        expectedSelectionKey !== undefined &&
        !session.getSnapshot().selectionGuardedCommands
      )
        throw new Error(
          "이 엔진은 선택 범위를 보장하는 서식을 지원하지 않습니다.",
        );
      const commands: EditorCommand[] = (
        preset.commands as readonly EditorCommand[]
      ).map((command) => structuredClone(command));
      const identity = sessionId.current;
      const scope = acceptedScope.current;
      const permission = permissionGeneration.current;
      const assertContinuation = () => {
        if (
          latest.current.readOnly ||
          permissionGeneration.current !== permission
        )
          throw new Error(
            "편집 권한이 변경돼 후속 서식 명령을 중단했습니다. 현재 권한을 확인하고 다시 실행해 주세요.",
          );
        if (
          !mounted.current ||
          sessionId.current !== identity ||
          editingSource.current !== document ||
          acceptedScope.current !== scope ||
          !matchesAcceptedSource(latest.current.document)
        )
          throw new SaveConflictError(
            "문서 또는 편집 세션이 변경돼 후속 서식 명령을 중단했습니다.",
          );
      };
      assertContinuation();
      busyRef.current = true;
      setBusy(true);
      if (body.current) body.current.inert = true;
      const earlier = [...commandTasks.current];
      const task = (async () => {
        let completed = 0;
        try {
          await syncInputBlock();
          await Promise.all(earlier);
          if (
            expectedSelectionKey !== undefined &&
            expectedSelectionKey !== session.getSnapshot().selectionKey
          )
            throw new SelectionConflictError();
          let revision = expectedRevision ?? session.getSnapshot().revision;
          if (session.executePreset) {
            assertContinuation();
            await session.executePreset(commands, {
              expectedRevision: revision,
              expectedSelectionKey,
              assertCurrent: assertContinuation,
            });
            return;
          }
          for (const command of commands) {
            assertContinuation();
            const capability = session.getSnapshot().commands[command.id];
            if (!capability?.supported || !capability.enabled)
              throw new Error(
                capability?.reason ??
                  `현재 선택에서 사용할 수 없는 서식입니다: ${command.id}`,
              );
            await session.execute(command, { expectedRevision: revision });
            completed++;
            assertContinuation();
            revision = session.getSnapshot().revision;
          }
        } catch (cause) {
          throw new PresetApplicationError(
            completed,
            commands.length,
            cause instanceof Error ? cause : new Error(String(cause)),
          );
        }
      })();
      commandTasks.current.add(task);
      setPendingCommands(commandTasks.current.size);
      try {
        await task;
      } finally {
        commandTasks.current.delete(task);
        if (mounted.current) setPendingCommands(commandTasks.current.size);
        busyRef.current = false;
        setBusy(false);
        await syncInputBlock().catch(reportError);
      }
    },
    [session, document],
  );
  const quickPort = useRef<Parameters<typeof createQuickActionEditor>[0]>(
    null!,
  );
  quickPort.current = {
    state: () => ({ ...liveSnapshot(), ...tablePort.current.state() }),
    presets: () => [
      ...REPORT_PRESETS,
      ...(props.presets ?? []).filter(
        (preset) => !REPORT_PRESETS.some((p) => p.id === preset.id),
      ),
    ],
    apply: async (commands, identity) => {
      if (
        latest.current.readOnly ||
        busyRef.current ||
        !session?.getSnapshot().ready
      )
        throw new QuickActionError(
          "현재 문서는 빠른 작업을 적용할 수 없습니다.",
          "none",
        );
      if (commands.length === 1)
        await execute(commands[0]!, {
          expectedRevision: identity.revision,
          expectedSelectionKey: identity.selectionKey,
        });
      else {
        if (!session.getSnapshot().atomicPresets)
          throw new QuickActionError(
            "일괄 서식을 안전하게 적용할 수 없는 엔진입니다.",
            "none",
          );
        await applyPreset(
          { id: "quick-action", name: "빠른 서식", description: "", commands },
          identity.revision,
          identity.selectionKey,
        );
      }
    },
  };
  const quickActionsRef = useRef<ReturnType<
    typeof createQuickActionEditor
  > | null>(null);
  quickActionsRef.current ??= createQuickActionEditor({
    state: () => quickPort.current.state(),
    presets: () => quickPort.current.presets(),
    apply: (...args) => quickPort.current.apply(...args),
  });
  const quickActions = quickActionsRef.current;
  const exportDocument = useCallback(async () => {
    if (!session?.getSnapshot().ready || editingSource.current !== document)
      throw new Error("편집기를 준비하는 중입니다.");
    const identity = sessionId.current;
    const assertSession = () => {
      if (
        !mounted.current ||
        sessionId.current !== identity ||
        editingSource.current !== document
      )
        throw new SaveConflictError(
          "편집 세션이 변경됐습니다. 현재 문서를 다시 확인해 주세요.",
        );
    };
    while (commandTasks.current.size) {
      await Promise.all([...commandTasks.current]);
      assertSession();
    }
    await draftExport.current;
    assertSession();
    const exported = await session.exportDocument();
    assertSession();
    return exported;
  }, [session, document]);
  const mailPort = useRef<Parameters<typeof createMailMergeSession>[0]>(null!);
  mailPort.current = {
    storage: () => latest.current.generatedStorage,
    state: () => {
      if (!mounted.current || !session?.getSnapshot().ready || !document)
        throw new MailMergeError("편집기를 준비하는 중입니다.");
      return {
        documentId: document.id,
        sessionId: sessionId.current,
        revision: session.getSnapshot().revision,
      };
    },
    assertWritable: () => {
      if (
        mutationBlockReason() ||
        !mounted.current ||
        !matchesAcceptedSource(latest.current.document)
      )
        throw new MailMergeError(
          "문서 생성 권한 또는 편집 상태가 변경됐습니다.",
        );
    },
    onPreview: (request, template) =>
      automationSession.put(
        MAIL_MERGE_DRAFT_NAME,
        {
          input: request.data,
          delimiter: request.delimiter,
          transform: "trim",
          argument: JSON.stringify({
            mapping: request.mapping,
            fileNamePattern: request.fileNamePattern,
            allowEmpty: request.allowEmpty,
            sourceName: template.fileName,
          }),
        },
        { activate: false },
      ),
  };
  mailMergeRef.current ??= createMailMergeSession({
    state: () => mailPort.current.state(),
    assertWritable: () => mailPort.current.assertWritable(),
    storage: () => mailPort.current.storage?.(),
    onPreview: (...args) => mailPort.current.onPreview?.(...args),
  });
  const mailMerge = mailMergeRef.current;
  const [questionTarget, setQuestionTarget] =
    useState<DocumentQuestionTarget | null>(null);
  const [questionText, setQuestionText] = useState("");
  const [questionError, setQuestionError] = useState("");
  const [questionSending, setQuestionSending] = useState(false);
  const questionPort = useRef<
    Parameters<typeof createDocumentQuestionSession>[0]
  >(null!);
  questionPort.current = {
    state: () => ({
      ...liveSnapshot(),
      documentId: document?.id ?? "",
      sessionId: sessionId.current,
      version: baseVersion.current,
    }),
    capture: async () => {
      if (!session?.captureQuestionTarget)
        throw new Error("이 엔진은 단락 질문을 지원하지 않습니다.");
      return session.captureQuestionTarget();
    },
    clear: () => session?.clearQuestionTarget?.(),
    send: async (request) => {
      if (!latest.current.onQuestion)
        throw new Error("호스트의 질문 연결이 필요합니다.");
      await latest.current.onQuestion(request);
    },
  };
  const questions = useRef<ReturnType<
    typeof createDocumentQuestionSession
  > | null>(null);
  questions.current ??= createDocumentQuestionSession({
    state: () => questionPort.current.state(),
    capture: () => questionPort.current.capture(),
    clear: () => questionPort.current.clear(),
    send: (request) => questionPort.current.send(request),
  });
  const openQuestion = () => {
    setQuestionError("");
    void questions
      .current!.capture()
      .then(setQuestionTarget)
      .catch((cause: unknown) =>
        reportError(cause instanceof Error ? cause : new Error(String(cause))),
      );
  };
  const questionStale =
    questionTarget &&
    (questionTarget.documentId !== document?.id ||
      questionTarget.sessionId !== sessionId.current ||
      questionTarget.version !== baseVersion.current ||
      questionTarget.revision !== snapshot.revision ||
      questionTarget.selectionKey !== snapshot.selectionKey);
  const previewCopy = async (previewId: string, row?: number) =>
    setCopyPreview(await mailMerge.previewDocument(previewId, row));
  const openStoredCopy = async (
    file: import("@document-studio/core").GeneratedStoredFile,
  ) => {
    const identity = sessionId.current;
    const open = latest.current.onOpenStoredCopy;
    const scope = acceptedScope.current;
    if (
      !open ||
      !matchesAcceptedSource(latest.current.document) ||
      sourceBlocked
    )
      throw new Error("현재 문서를 준비한 뒤 사본을 다시 선택해 주세요.");
    mailMerge.assertCanLeave();
    if (
      liveSnapshot().dirty ||
      busyRef.current ||
      commandTasks.current.size ||
      inFlightSave.current
    )
      throw new Error("현재 원본의 편집을 저장한 뒤 사본을 열어 주세요.");
    await flushDraft();
    if (
      !mounted.current ||
      identity !== sessionId.current ||
      !matchesAcceptedSource(latest.current.document) ||
      (latest.current.draftNamespace ?? "document-studio") !== scope
    )
      throw new Error(
        "문서 또는 사본 열기 연결이 변경됐습니다. 현재 문서에서 다시 선택해 주세요.",
      );
    mailMerge.assertCanLeave();
    if (
      liveSnapshot().dirty ||
      busyRef.current ||
      commandTasks.current.size ||
      inFlightSave.current
    )
      throw new Error("현재 문서가 변경됐습니다. 저장한 뒤 다시 열어 주세요.");
    const stored = mailMerge
      .getSnapshot()
      .storedFiles?.find(
        (item) =>
          item.id === file.id &&
          item.digest === file.digest &&
          item.path === file.path &&
          item.version === file.version,
      );
    const currentOpen = latest.current.onOpenStoredCopy;
    if (!stored || !currentOpen)
      throw new Error("저장된 사본의 열기 연결을 확인하지 못했습니다.");
    await currentOpen({ ...stored });
  };
  const focusGeneratedOutput = () => {
    setCloseDialog(false);
    setToolsTab("서식·메일머지");
    setToolsOpen(true);
    requestAnimationFrame(() => {
      const root =
        props.ui?.containers?.tools ?? body.current?.closest(".ds-editor");
      const card = root?.querySelector<HTMLElement>(
        '[aria-label="생성 사본 보관"]',
      );
      card?.focus();
      card?.scrollIntoView({ block: "nearest" });
    });
  };
  useEffect(() => {
    setMailStatus(mailMerge.getSnapshot());
    return mailMerge.subscribe(() => setMailStatus(mailMerge.getSnapshot()));
  }, [mailMerge]);
  const registerCurrentMailMergeTemplate = async () => {
    const started = tablePort.current.state(),
      exported = await exportDocument(),
      current = tablePort.current.state();
    if (
      started.documentId !== current.documentId ||
      started.sessionId !== current.sessionId ||
      started.revision !== exported.revision ||
      current.revision !== exported.revision
    )
      throw new MailMergeError("서식을 등록하는 동안 문서가 변경됐습니다.");
    return mailMerge.register({
      id: crypto.randomUUID(),
      fileName: displayed.fileName,
      format: exported.format,
      bytes: exported.bytes,
    });
  };
  const flushDraft = useCallback(async () => {
    mailMergeRef.current?.assertCanLeave();
    if (!session || !document || !session.getSnapshot().ready) {
      // A never-ready mount cannot accept native edits. Existing recovery bytes
      // remain in their store; closing must neither export nor delete them.
      if (readyMount.current || busyRef.current || commandTasks.current.size)
        throw new Error(
          "편집기를 준비하는 중입니다. 문서를 전환할 수 없습니다.",
        );
      const identity = engineMountId.current;
      await automationSession.flush();
      if (
        identity !== engineMountId.current ||
        readyMount.current ||
        busyRef.current ||
        automationSession.getSnapshot().pending
      )
        throw new Error(
          "편집 상태가 변경됐습니다. 다시 확인한 뒤 문서를 전환해 주세요.",
        );
      return;
    }
    if (busyRef.current)
      throw new Error("저장을 완료한 뒤 문서를 전환해 주세요.");
    busyRef.current = true;
    setBusy(true);
    if (body.current) body.current.inert = true;
    const acceptedCommands = Promise.all([...commandTasks.current]);
    void acceptedCommands.catch(() => undefined);
    try {
      await syncInputBlock();
      await automationSession.flush();
      if (automationSession.getSnapshot().pending)
        throw new Error(
          "자동화 입력은 현재 세션에만 있습니다. 입력을 따로 내려받거나 보관한 뒤 문서를 전환해 주세요.",
        );
      await acceptedCommands;
      // Wait for earlier exports/commands, then export again: an autosave may precede the latest input.
      const exported = await exportDocument();
      if (!liveSnapshot().dirty) {
        transitionPermit.current = session.getSnapshot().revision;
        return;
      }
      const store = activeDraftStore();
      if (!store)
        throw new Error(
          "초안 저장소가 비활성화돼 있습니다. 문서를 먼저 저장해 주세요.",
        );
      await store.put({
        key: activeKey,
        bytes: exported.bytes,
        baseVersion: baseVersion.current,
        fileName: document.fileName,
        format: document.format,
        updatedAt: Date.now(),
      });
      transitionPermit.current = session.getSnapshot().revision;
    } catch (cause) {
      const failure = new Error(
        `초안 저장에 실패했습니다. 현재 문서는 유지됩니다: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
      reportError(failure);
      throw failure;
    } finally {
      busyRef.current = false;
      setBusy(false);
      await syncInputBlock().catch(reportError);
    }
  }, [
    session,
    document,
    exportDocument,
    drafts,
    activeKey,
    reportError,
    automationSession,
  ]);
  const performSave = useCallback(
    async (options?: { onlyIfDirty?: boolean; expectedRevision?: string }) => {
      if (latest.current.readOnly) throw new Error("읽기 전용 문서입니다.");
      if (!session || !document || !session.getSnapshot().ready)
        throw new Error("편집기를 준비하는 중입니다.");
      if (busyRef.current)
        throw new Error("진행 중인 작업을 완료한 뒤 다시 저장해 주세요.");
      if (
        conflict ||
        sourceBlocked ||
        editingSource.current !== document ||
        !matchesAcceptedSource(latest.current.document)
      )
        throw new SaveConflictError(
          "저장 대상과 현재 문서가 일치하지 않습니다. 원본 상태를 확인해 주세요.",
        );
      const onSaved = latest.current.onSaved;
      const identity = sessionId.current;
      const scope = acceptedScope.current;
      setSaving(true);
      busyRef.current = true;
      setBusy(true);
      setError("");
      setNotice("");
      if (body.current) body.current.inert = true;
      // Keep failures observable even if a task settles while native input or
      // the separate automation store is being flushed.
      const acceptedCommands = Promise.all([...commandTasks.current]);
      void acceptedCommands.catch(() => undefined);
      try {
        await syncInputBlock();
        // Local automation storage is optional. Its failure cannot undo or prevent a document commit.
        let automationFailure = "";
        try {
          await automationSession.flush();
        } catch (cause) {
          automationFailure =
            cause instanceof Error ? cause.message : String(cause);
        }
        await acceptedCommands;
        // Freeze new input/commands, drain earlier work, then decide whether an upload is necessary.
        while (commandTasks.current.size)
          await Promise.all([...commandTasks.current]);
        await draftExport.current;
        if (
          !mounted.current ||
          sessionId.current !== identity ||
          editingSource.current !== document ||
          !matchesAcceptedSource(latest.current.document) ||
          latest.current.readOnly
        )
          throw new SaveConflictError(
            "저장 대상 또는 편집 세션이 변경됐습니다.",
          );
        const automationWarning = automationFailure
          ? [
              {
                code: "automation-draft-pending",
                message: `자동화 입력을 보관하지 못했습니다. 문서 저장과 별개이며, 전환 전에 입력을 복구하거나 내려받아 주세요: ${automationFailure}`,
              },
            ]
          : [];
        if (options?.onlyIfDirty && !liveSnapshot().dirty) {
          const warnings = [
            ...warningsRef.current.filter(
              (warning) => warning.code !== "automation-draft-pending",
            ),
            ...automationWarning,
          ];
          warningsRef.current = warnings;
          setSaveWarnings(warnings);
          return;
        }
        const exported = await exportDocument();
        if (
          options?.expectedRevision !== undefined &&
          options.expectedRevision !== exported.revision
        )
          throw new SaveConflictError("저장할 편집 revision이 변경됐습니다.");
        if (
          !matchesAcceptedSource(latest.current.document) ||
          latest.current.readOnly
        )
          throw new SaveConflictError(
            "저장 대상이 변경됐습니다. 현재 편집본은 유지됩니다.",
          );
        let version: string;
        let warnings: readonly StorageWarning[] = automationWarning;
        if (storage) {
          let response: unknown;
          try {
            response = await storage.save({
              document,
              bytes: exported.bytes,
              expectedVersion: baseVersion.current,
            });
          } catch (cause) {
            if (cause instanceof SaveConflictError) setConflict(true);
            throw cause;
          }
          const saved = validateSaveResult(response);
          version = saved.version;
          warnings = [...warnings, ...(saved.warnings ?? [])];
        } else {
          downloadDocument(exported.bytes, document.fileName, exported.format);
          // A local download also establishes a new baseline for the host's retained document.
          version = `download:${crypto.randomUUID()}`;
        }
        baseVersion.current = version;
        savedSource.current = {
          documentId: document.id,
          format: document.format,
          version,
          sessionId: identity,
          scope,
          bytes: new Uint8Array(exported.bytes),
        };
        committedRevision.current = {
          documentId: document.id,
          revision: exported.revision,
          engineAcknowledged: false,
        };
        try {
          await session.markSaved(exported.revision);
          committedRevision.current.engineAcknowledged = true;
        } catch (cause) {
          warnings = [
            ...warnings,
            {
              code: "engine-ack-pending",
              message: `문서는 저장됐지만 편집기 저장 표시를 갱신하지 못했습니다: ${cause instanceof Error ? cause.message : String(cause)}`,
            },
          ];
        }
        warningsRef.current = warnings;
        setSaveWarnings(warnings);
        lastCommit.current = {
          documentId: document.id,
          sessionId: identity,
          fileName: document.fileName,
          format: exported.format,
          version,
          savedRevision: exported.revision,
          bytes: new Uint8Array(exported.bytes),
          destination: storage ? "storage" : "download",
          warnings: [...warnings],
          automationDraft: { ...automationSession.getSnapshot() },
        };
        // A failed local cleanup must not turn a confirmed remote save into a save failure.
        if (!liveSnapshot().dirty) {
          try {
            await activeDraftStore()?.delete(activeKey);
          } catch (cause) {
            setError(
              `문서는 저장됐지만 초안 정리에 실패했습니다: ${cause instanceof Error ? cause.message : String(cause)}`,
            );
          }
        }
        setNotice(
          storage ? "문서를 저장했습니다." : "편집한 문서를 다운로드했습니다.",
        );
        try {
          await onSaved?.({
            documentId: document.id,
            fileName: document.fileName,
            bytes: new Uint8Array(exported.bytes),
            format: exported.format,
            revision: exported.revision,
            version,
            warnings,
            automationDraft: { ...automationSession.getSnapshot() },
          });
        } catch (cause) {
          reportError(
            new Error(
              `문서는 저장됐지만 후속 처리를 완료하지 못했습니다: ${cause instanceof Error ? cause.message : String(cause)}`,
            ),
          );
        }
      } catch (cause) {
        reportError(cause instanceof Error ? cause : new Error(String(cause)));
        throw cause;
      } finally {
        setSaving(false);
        busyRef.current = false;
        setBusy(false);
        await syncInputBlock().catch(reportError);
      }
    },
    [
      session,
      document,
      conflict,
      sourceBlocked,
      storage,
      exportDocument,
      drafts,
      activeKey,
      reportError,
      automationSession,
    ],
  );
  const save = useCallback(
    (options?: { onlyIfDirty?: boolean; expectedRevision?: string }) => {
      if (inFlightSave.current) return inFlightSave.current;
      const task = performSave(options);
      inFlightSave.current = task;
      const finished = () => {
        if (inFlightSave.current === task) inFlightSave.current = null;
      };
      void task.then(finished, finished);
      return task;
    },
    [performSave],
  );
  const saveRef = useRef(save);
  saveRef.current = save;
  const requestSave = useCallback(() => {
    void saveRef.current().catch(() => {});
  }, []);
  const requestFind = useCallback(() => {
    setToolsTab("찾기와 바꾸기");
    setToolsOpen(true);
  }, []);
  useImperativeHandle(
    ref,
    () => ({
      getState: () => ({
        ...liveSnapshot(),
        documentId: displayed.id,
        format: displayed.format,
        version: baseVersion.current,
        sessionId: sessionId.current,
        warnings: warningsRef.current.filter(
          (warning) =>
            warning.code !== "automation-draft-pending" ||
            !automationSession.getSnapshot().ready ||
            automationSession.getSnapshot().pending ||
            !!automationSession.getSnapshot().error,
        ),
        automationDraft: { ...automationSession.getSnapshot() },
      }),
      execute,
      acquireInputLock,
      exportDocument,
      flushDraft,
      flushAutomationDraft: () => automationSession.flush(),
      retryInitialization,
      save,
      commit: async (options) => {
        const identity = sessionId.current;
        await save({ expectedRevision: options.expectedRevision });
        const saved = lastCommit.current;
        if (!saved || saved.sessionId !== identity)
          throw new SaveConflictError("저장 후 편집 세션이 변경됐습니다.");
        const hash = await crypto.subtle.digest(
          "SHA-256",
          new Uint8Array(saved.bytes),
        );
        const { bytes: _bytes, ...receipt } = saved;
        return {
          ...receipt,
          digest: `sha256:${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("")}`,
        };
      },
      readDocument,
      readTable: tableColumn.read,
      registerMailMergeTemplate: mailMerge.register,
      registerCurrentMailMergeTemplate,
      listMailMergeTemplates: mailMerge.list,
      removeMailMergeTemplate: mailMerge.remove,
      previewMailMerge: mailMerge.preview,
      generateMailMerge: mailMerge.generate,
      cancelMailMerge: mailMerge.cancel,
      getMailMergeStatus: mailMerge.getSnapshot,
      saveMailMergeResults: mailMerge.saveResults,
      focusGeneratedOutput,
      previewMailMergeDocument: mailMerge.previewDocument,
      captureQuestionTarget: questions.current!.capture,
      askQuestion: questions.current!.send,
      clearQuestionTarget: questions.current!.clear,
      exportMailMerge: mailMerge.results,
      exportMailMergeArchive: mailMerge.archive,
      noteMailMergeDownload: mailMerge.noteDownload,
      acknowledgeMailMergeDelivery: mailMerge.acknowledgeDelivery,
      discardMailMergeResults: mailMerge.discardResults,
      assertCanClose: mailMerge.assertCanLeave,
      listQuickActions: quickActions.list,
      previewQuickAction: quickActions.preview,
      applyQuickAction: quickActions.apply,
      previewTableColumn: tableColumn.preview,
      applyTableColumn: tableColumn.apply,
      search,
      selectMatch,
      replace,
      applyPreset,
    }),
    [
      session,
      execute,
      acquireInputLock,
      exportDocument,
      flushDraft,
      automationSession,
      save,
      readDocument,
      search,
      selectMatch,
      replace,
      applyPreset,
      displayed.id,
      displayed.format,
      busy,
      saving,
      pendingCommands,
      initializationError,
      initializationPhase,
      error,
      sourceBlocked,
      inputMismatch,
      mailMerge,
      quickActions,
      registerCurrentMailMergeTemplate,
    ],
  );
  useEffect(() => {
    if (!session || !document || !drafts) return;
    let active = true;
    const timer = setInterval(() => {
      if (
        !active ||
        busyRef.current ||
        commandTasks.current.size > 0 ||
        draftExport.current ||
        !liveSnapshot().dirty
      )
        return;
      const task = (async () => {
        try {
          const exported = await session.exportDocument();
          if (
            !active ||
            !liveSnapshot().dirty ||
            !matchesAcceptedSource(latest.current.document)
          )
            return;
          await activeDraftStore()?.put({
            key: activeKey,
            bytes: exported.bytes,
            baseVersion: baseVersion.current,
            fileName: document.fileName,
            format: document.format,
            updatedAt: Date.now(),
          });
        } catch (cause) {
          if (active)
            reportError(
              new Error(
                `초안 저장에 실패했습니다: ${cause instanceof Error ? cause.message : String(cause)}`,
              ),
            );
        }
      })();
      draftExport.current = task;
      void task.finally(() => {
        if (draftExport.current === task) draftExport.current = null;
      });
    }, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [session, document, drafts, activeKey, reportError]);
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (
        snapshotRef.current.dirty ||
        automationPending.current ||
        commandTasks.current.size > 0 ||
        busyRef.current ||
        outputPending()
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);
  const downloadDraft = () => {
    void exportDocument()
      .then((result) =>
        downloadDocument(result.bytes, displayed.fileName, result.format),
      )
      .catch(reportError);
  };
  const discardAndClose = () => {
    if (busyRef.current) return;
    busyRef.current = true;
    void (async () => {
      try {
        mailMergeRef.current?.assertCanLeave();
        await automationSession.flush();
        await draftExport.current;
        await activeDraftStore()?.delete(activeKey);
        onClose?.();
      } catch (cause) {
        reportError(cause instanceof Error ? cause : new Error(String(cause)));
      } finally {
        busyRef.current = false;
      }
    })();
  };
  const openPendingDocument = () => {
    if (!pendingDocument || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    void (async () => {
      try {
        mailMergeRef.current?.assertCanLeave();
        const target = pendingDocument;
        // The explicit source replacement must preserve separate inputs just like normal navigation.
        await automationSession.flush();
        if (automationSession.getSnapshot().pending)
          throw new Error(
            "자동화 입력이 아직 보관되지 않았습니다. 입력을 내려받거나 보관한 뒤 문서를 전환해 주세요.",
          );
        const scope = latest.current.draftNamespace ?? "document-studio";
        const targetStore =
          latest.current.draftStore === false
            ? null
            : (latest.current.draftStore ?? defaultDrafts.current);
        const validator =
          engines.find((engine) => engine.formats.includes(target.format))
            ?.validateDocument ?? validateDocumentAsync;
        const abort = new AbortController();
        pendingLoad.current = abort;
        await validator(target, abort.signal);
        const resolution = await resolveRecovery(
          target,
          targetStore,
          draftKey(scope, target.id),
          validator,
          abort.signal,
        );
        if (
          latest.current.document !== target ||
          (latest.current.draftNamespace ?? "document-studio") !== scope ||
          (latest.current.draftStore === false
            ? null
            : (latest.current.draftStore ?? defaultDrafts.current)) !==
            targetStore
        )
          throw new Error(
            "문서 또는 초안 저장소가 변경됐습니다. 현재 편집본은 유지됩니다.",
          );
        const different =
          document &&
          (document.id !== pendingDocument.id ||
            document.format !== pendingDocument.format ||
            acceptedScope.current !== scope ||
            activeDrafts.current !== targetStore);
        await draftExport.current;
        if (different && liveSnapshot().dirty) {
          const currentStore = activeDraftStore();
          if (!currentStore)
            throw new Error("미저장 문서를 먼저 저장해 주세요.");
          const exported = await exportDocument();
          const store = activeDraftStore();
          if (!store || store !== currentStore)
            throw new Error(
              "초안 저장소가 변경됐습니다. 전환을 다시 시도해 주세요.",
            );
          await store.put({
            key: activeKey,
            bytes: exported.bytes,
            baseVersion: baseVersion.current,
            fileName: document.fileName,
            format: document.format,
            updatedAt: Date.now(),
          });
        }
        // For the same ID, an existing recovery draft also needs an explicit recovery/discard decision.
        abort.signal.throwIfAborted();
        acceptSource(target, targetStore, scope, resolution);
      } catch (cause) {
        reportError(cause instanceof Error ? cause : new Error(String(cause)));
      } finally {
        pendingLoad.current = null;
        busyRef.current = false;
        setBusy(false);
      }
    })();
  };
  const enabled = (id: CommandId) =>
    !snapshot.busy &&
    Boolean(
      snapshot.ready &&
        snapshot.commands[id]?.supported &&
        snapshot.commands[id]?.enabled,
    );
  const button = (id: CommandId, label: string, content: string) => (
    <button
      type="button"
      className="ds-tool"
      title={snapshot.commands[id]?.reason ?? label}
      aria-label={label}
      aria-pressed={snapshot.commands[id]?.active ?? false}
      disabled={!enabled(id)}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => run({ id } as EditorCommand)}
    >
      {content}
    </button>
  );
  const engine = engines.find((item) =>
    item.formats.includes(displayed.format),
  );
  const View = engine?.View;
  const mountId = engineMountId.current;
  const reportEngineError = useCallback(
    (cause: Error) => {
      if (engineMountId.current !== mountId) return;
      if (readyMount.current !== mountId) {
        if (engineFailure.current) return;
        const failure =
          cause instanceof EngineInitializationError
            ? cause
            : new EngineInitializationError(
                "편집기를 준비하지 못했습니다. 다시 시도해 주세요.",
                "engine-initialization-failed",
                { cause },
              );
        engineFailure.current = failure;
        setInitializationError(failure);
        setError(failure.message);
      } else reportError(cause);
    },
    [mountId, reportError],
  );
  const uiContext: Omit<EditorUIContext, "defaultContent"> = {
    snapshot,
    readOnly: Boolean(props.readOnly),
    canAskQuestion: Boolean(props.onQuestion && session?.captureQuestionTarget),
    askAboutParagraph: openQuestion,
    toolsOpen,
    nativeTools,
    fitWidth,
    execute,
    openTools(tab = "paragraph") {
      if (!Object.hasOwn(EDITOR_TOOL_TABS, tab))
        throw new TypeError("지원하지 않는 편집 도구입니다.");
      toolsReturnFocus.current =
        window.document.activeElement instanceof HTMLElement
          ? window.document.activeElement
          : null;
      setToolsTab(EDITOR_TOOL_TABS[tab]);
      setToolsOpen(true);
    },
    closeTools,
    setNativeTools,
    setZoom(value) {
      setFitWidth(value === "width");
      if (value !== "width") run({ id: "zoom", value });
    },
  };
  const regionProps = {
    appearance: props.appearance,
    theme: props.ui?.theme,
    context: uiContext,
    onError: reportError,
    owner: dialogId,
    blocked: Boolean(offer) || closeDialog,
  };
  return (
    <section
      className="ds-editor"
      data-appearance={props.appearance ?? "standalone"}
      data-document-studio-owner={dialogId}
      style={editorThemeStyle(props.ui?.theme)}
      aria-label={`${displayed.fileName} 편집기`}
      onKeyDownCapture={(event) => {
        // ModalDialog owns Escape/Tab; the outer tools must not consume them first.
        if (
          event.target instanceof Element &&
          event.target.closest(".ds-dialog")
        )
          return;
        if (event.key === "Escape" && toolsOpen) {
          event.preventDefault();
          event.stopPropagation();
          if (toolsExpanded) setToolsExpanded(false);
          else closeTools();
          return;
        }
        if (
          (event.ctrlKey || event.metaKey) &&
          event.key.toLowerCase() === "f"
        ) {
          event.preventDefault();
          event.stopPropagation();
          requestFind();
          return;
        }
        if (
          !offer &&
          !closeDialog &&
          (event.ctrlKey || event.metaKey) &&
          event.key.toLowerCase() === "s"
        ) {
          event.preventDefault();
          event.stopPropagation();
          if (
            event.target instanceof HTMLInputElement &&
            event.target.type === "number"
          )
            event.target.blur();
          requestSave();
        }
      }}
    >
      {props.appearance !== "embedded" && (
        <header className="ds-document-header">
          <div className="ds-document-heading">
            <span className="ds-format">{displayed.format.toUpperCase()}</span>
            <div>
              <h2>{displayed.fileName}</h2>
              <span className="ds-save-status" role="status">
                {busy
                  ? "저장 중…"
                  : snapshot.dirty
                    ? "저장하지 않은 변경사항"
                    : snapshot.ready
                      ? "문서 변경사항 저장됨"
                      : initializationError
                        ? "문서 준비 실패"
                        : "문서 준비 중"}
              </span>
              {(automationStatus.pending ||
                !automationStatus.ready ||
                automationStatus.error) && (
                <span className="ds-save-status" role="status">
                  {automationStatus.error
                    ? "자동화 입력 보관 실패 · 문서 저장과 별개"
                    : automationStatus.storage === "memory"
                      ? "자동화 입력은 현재 세션에만 유지됨"
                      : "자동화 입력 보관 대기"}
                </span>
              )}
            </div>
          </div>
          <div className="ds-header-actions">
            <button
              type="button"
              className="ds-button"
              disabled={!snapshot.ready || busy}
              onClick={downloadDraft}
            >
              다운로드
            </button>
            <button
              type="button"
              className="ds-button ds-primary"
              disabled={
                !snapshot.ready ||
                busy ||
                conflict ||
                sourceBlocked ||
                props.readOnly ||
                inputMismatch
              }
              onClick={requestSave}
            >
              {storage ? "저장" : "저장하고 다운로드"}
            </button>
            {onClose && (
              <button
                type="button"
                className="ds-button"
                disabled={busy}
                onClick={() => {
                  if (
                    liveSnapshot().dirty ||
                    automationPending.current ||
                    commandTasks.current.size ||
                    outputPending()
                  ) {
                    modalBlocked.current = true;
                    setCloseDialog(true);
                  } else onClose();
                }}
              >
                닫기
              </button>
            )}
          </div>
        </header>
      )}
      <EditorRegion
        {...regionProps}
        name="toolbar"
        target={props.ui?.containers?.toolbar}
        render={props.slots?.toolbar}
      >
        <div className="ds-toolbar" role="toolbar" aria-label="문서 서식">
          <div className="ds-tool-group">
            <button
              className="ds-button"
              disabled={!snapshot.ready || busy}
              aria-expanded={toolsOpen}
              ref={toolsToggle}
              title="문단·글자·표·그림·페이지 설정"
              onClick={() => {
                if (!toolsOpen) setToolsTab("문단");
                if (toolsOpen) closeTools();
                else setToolsOpen(true);
              }}
            >
              문단·표·그림
            </button>
            <button
              type="button"
              className="ds-button"
              disabled={!snapshot.ready || busy}
              onClick={() => {
                setToolsTab("빠른 작업");
                setToolsOpen(true);
              }}
            >
              빠른 작업
            </button>
            {props.onQuestion && (
              <button
                type="button"
                className="ds-button"
                disabled={
                  !snapshot.ready ||
                  busy ||
                  !session?.captureQuestionTarget ||
                  questionSending
                }
                onClick={openQuestion}
              >
                이 단락 질문
              </button>
            )}
            <button
              className="ds-button"
              disabled={!snapshot.ready || busy}
              aria-expanded={nativeTools}
              title="엔진의 삽입·쪽 설정·파일 메뉴"
              onClick={() => setNativeTools(!nativeTools)}
            >
              삽입·쪽 메뉴
            </button>
            <button
              type="button"
              className="ds-button"
              title="문서에서 찾기 · Ctrl+F"
              onClick={() => {
                setToolsTab("찾기와 바꾸기");
                setToolsOpen(true);
              }}
            >
              찾기
            </button>
          </div>
          <div className="ds-tool-group">
            {button("undo", "되돌리기", "↶")}
            {button("redo", "다시 실행", "↷")}
          </div>
          <div className="ds-tool-group">
            <label className="ds-field">
              글꼴
              <select
                aria-label="글꼴"
                disabled={!enabled("fontFamily")}
                value={snapshot.fontFamily ?? ""}
                onChange={(event) =>
                  run({ id: "fontFamily", value: event.target.value })
                }
              >
                <option value="" disabled>
                  선택
                </option>
                {Array.from(
                  new Set(
                    [
                      snapshot.fontFamily,
                      "Arial",
                      "맑은 고딕",
                      "바탕",
                      "Noto Sans KR",
                    ].filter((name): name is string => Boolean(name)),
                  ),
                ).map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className="ds-field ds-number">
              크기
              <input
                aria-label="글자 크기"
                type="number"
                min={1}
                max={200}
                key={`${snapshot.fontSize ?? "mixed"}`}
                defaultValue={snapshot.fontSize}
                disabled={!enabled("fontSize")}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    // Blurring restores editor focus; consume Enter before its default edit action can replace the selection.
                    event.preventDefault();
                    event.stopPropagation();
                    event.currentTarget.blur();
                  }
                }}
                onBlur={(event) => {
                  if (Number(event.target.value) !== snapshot.fontSize)
                    run({ id: "fontSize", value: Number(event.target.value) });
                }}
              />
            </label>
          </div>
          <div className="ds-tool-group">
            {button("bold", "굵게", "B")}
            {button("italic", "기울임", "I")}
            {button("underline", "밑줄", "U")}
          </div>
          <div className="ds-tool-group">
            {button("alignLeft", "왼쪽 정렬", "≡←")}
            {button("alignCenter", "가운데 정렬", "≡")}
            {button("alignRight", "오른쪽 정렬", "→≡")}
            {button("alignJustify", "양쪽 정렬", "☰")}
          </div>
          <label className="ds-field">
            행간
            <select
              aria-label="행간"
              value={snapshot.lineSpacing ?? ""}
              disabled={!enabled("lineSpacing")}
              onChange={(event) =>
                run({ id: "lineSpacing", value: Number(event.target.value) })
              }
            >
              <option value="" disabled>
                사용자 지정
              </option>
              {Array.from(
                new Set(
                  [snapshot.lineSpacing, 1, 1.15, 1.5, 1.6, 2, 2.5, 3].filter(
                    (value): value is number => value !== undefined,
                  ),
                ),
              )
                .sort((a, b) => a - b)
                .map((value) => (
                  <option key={value} value={value}>
                    {Math.round(value * 100)}%
                  </option>
                ))}
            </select>
          </label>
        </div>
      </EditorRegion>
      {error && (
        <div className="ds-notice ds-error" role="alert">
          <span>{error}</span>
          {initializationError && (
            <>
              <button
                type="button"
                className="ds-button"
                onClick={() => {
                  try {
                    retryInitialization();
                  } catch (cause) {
                    reportError(cause as Error);
                  }
                }}
              >
                편집기 다시 시도
              </button>
              <button
                type="button"
                className="ds-button"
                onClick={() =>
                  downloadDocument(
                    displayed.bytes,
                    displayed.fileName,
                    displayed.format,
                  )
                }
              >
                {displayed.recovered ? "복구본 다운로드" : "원본 다운로드"}
              </button>
              <details className="ds-initialization-diagnostics">
                <summary>연결 진단 정보</summary>
                <p>편집 시작 전 준비에 실패했습니다. 입력 파일은 유지됩니다.</p>
                {initializationError.diagnostics && (
                  <p>
                    실패 단계:{" "}
                    {
                      INITIALIZATION_STAGE_LABELS[
                        initializationError.diagnostics.stage
                      ]
                    }{" "}
                    · 경과 시간:{" "}
                    {(initializationError.diagnostics.elapsedMs / 1000).toFixed(
                      1,
                    )}
                    초
                  </p>
                )}
                <pre tabIndex={0} aria-label="편집기 연결 진단">
                  {JSON.stringify(
                    {
                      code: initializationError.code,
                      ...initializationError.diagnostics,
                    },
                    null,
                    2,
                  )}
                </pre>
              </details>
            </>
          )}
          {recoveryUnavailable && (
            <button
              type="button"
              className="ds-button"
              onClick={() => setLoadAttempt((attempt) => attempt + 1)}
            >
              초안 저장소 다시 확인
            </button>
          )}
          <button
            type="button"
            aria-label="오류 메시지 닫기"
            disabled={recoveryUnavailable || Boolean(initializationError)}
            onClick={() => setError("")}
          >
            ×
          </button>
        </div>
      )}
      {notice && (
        <div className="ds-notice" role="status">
          {notice}
        </div>
      )}
      {saveWarnings.length > 0 && (
        <div className="ds-notice ds-warning" role="alert">
          {saveWarnings.map((warning, index) => (
            <p key={`${warning.code}:${index}`}>{warning.message}</p>
          ))}
        </div>
      )}
      {pendingDocument && (
        <div className="ds-notice ds-error">
          <span>현재 편집본을 보존하고 있습니다.</span>
          <button
            type="button"
            className="ds-button"
            onClick={openPendingDocument}
          >
            새 원본 열기
          </button>
        </div>
      )}
      <div className="ds-work-area">
        {questionTarget && (
          <aside className="ds-question-panel" aria-label="선택 단락 질문">
            <strong>{questionTarget.description}에 대해 질문</strong>
            <p>답변과 수정 제안을 받습니다. 문서 적용은 별도로 확인합니다.</p>
            <blockquote>
              {questionTarget.text.slice(0, 500)}
              {questionTarget.text.length > 500 ? "…" : ""}
            </blockquote>
            <label>
              질문
              <textarea
                aria-label="선택 단락 질문 내용"
                rows={3}
                maxLength={4000}
                value={questionText}
                onChange={(event) => setQuestionText(event.target.value)}
                disabled={questionSending}
              />
            </label>
            {questionStale && (
              <p role="alert">
                문서 또는 선택이 바뀌었습니다. 단락을 다시 지정해 주세요.
              </p>
            )}
            {questionError && <p role="alert">{questionError}</p>}
            <div className="ds-question-actions">
              <button
                type="button"
                className="ds-button"
                disabled={questionSending}
                onClick={() => {
                  questions.current!.clear();
                  setQuestionTarget(null);
                }}
              >
                질문 취소
              </button>
              {questionStale && (
                <button
                  type="button"
                  className="ds-button"
                  disabled={questionSending}
                  onClick={openQuestion}
                >
                  현재 단락으로 다시 지정
                </button>
              )}
              <button
                type="button"
                className="ds-button ds-primary"
                disabled={
                  questionSending ||
                  Boolean(questionStale) ||
                  !questionText.trim()
                }
                onClick={() => {
                  setQuestionSending(true);
                  setQuestionError("");
                  void questions
                    .current!.send(questionTarget.targetId, questionText)
                    .then(() => {
                      questions.current!.clear();
                      setQuestionTarget(null);
                      setQuestionText("");
                    })
                    .catch((cause: unknown) =>
                      setQuestionError(
                        cause instanceof Error ? cause.message : String(cause),
                      ),
                    )
                    .finally(() => setQuestionSending(false));
                }}
              >
                {questionSending ? "질문 전송 중…" : "선택 단락 질문 보내기"}
              </button>
            </div>
          </aside>
        )}
        <div
          className="ds-editor-body"
          ref={body}
          aria-busy={busy || snapshot.initialization.status === "loading"}
        >
          {!View ? (
            <p className="ds-loading" role="alert">
              이 형식을 처리할 편집 엔진이 없습니다.
            </p>
          ) : initializationError ? (
            <p className="ds-loading">
              문서를 열지 못했습니다. 위의 다시 시도 버튼으로 편집기를 다시
              연결할 수 있습니다.
            </p>
          ) : document ? (
            <EngineErrorBoundary
              key={engineMountId.current}
              onError={reportEngineError}
            >
              <View
                inputBlocked={inputBlocked}
                document={document}
                onReady={(value) => {
                  if (
                    engineMountId.current !== mountId ||
                    engineFailure.current
                  )
                    return;
                  readyMount.current = mountId;
                  inputLocks.current.clear();
                  setInputLockCount(0);
                  sessionId.current = crypto.randomUUID();
                  setSession(value);
                }}
                onError={reportEngineError}
                onInitializationPhase={(phase) => {
                  if (
                    engineMountId.current === mountId &&
                    !engineFailure.current
                  )
                    updateInitializationPhase(phase);
                }}
                onSaveRequest={requestSave}
                onFindRequest={requestFind}
                advancedTools={nativeTools}
              />
            </EngineErrorBoundary>
          ) : !offer ? (
            <p className="ds-loading">문서를 불러오는 중…</p>
          ) : null}
          {document && !initializationError && !snapshot.ready && (
            <div className="ds-engine-loading" role="status">
              {initializationPhase === "opening"
                ? "문서를 여는 중…"
                : "편집기에 연결하는 중…"}
            </div>
          )}
        </div>
        <EditorRegion
          {...regionProps}
          name="tools"
          target={props.ui?.containers?.tools}
        >
          {toolsOpen && (
            <EditingTools
              format={document?.format}
              saveLocation={props.creationLocation}
              automationSession={automationSession}
              automationStatus={automationStatus}
              creationContext={automationContext}
              initialTab={toolsTab}
              expanded={overlayTools}
              external={externalTools}
              onExpandedChange={externalTools ? undefined : setToolsExpanded}
              onTabChange={setToolsTab}
              documentKey={`${displayed.id}:${sessionId.current}`}
              onClose={closeTools}
              snapshot={snapshot}
              disabled={busy}
              readOnly={props.readOnly}
              execute={execute}
              search={search}
              selectMatch={selectMatch}
              replace={replace}
              applyPreset={applyPreset}
              tableColumn={tableColumn}
              quickActions={quickActions}
              mailMerge={mailMerge}
              previewMailMergeDocument={previewCopy}
              onOpenStoredCopy={
                props.onOpenStoredCopy ? openStoredCopy : undefined
              }
              registerCurrentMailMergeTemplate={
                registerCurrentMailMergeTemplate
              }
              presets={props.presets}
              onError={reportError}
              createDocument={engine?.createDocument}
              onCreateDocument={
                props.readOnly ? undefined : props.onCreateDocument
              }
            />
          )}
        </EditorRegion>
      </div>
      <EditorRegion
        {...regionProps}
        name="statusBar"
        target={props.ui?.containers?.statusBar}
        render={props.slots?.statusBar}
      >
        <footer className="ds-document-footer">
          <span>{snapshot.pageCount ? `${snapshot.pageCount}쪽` : ""}</span>
          <span>선택한 영역에 서식 적용</span>
          {viewportWidth > 0 &&
            viewportWidth < 600 &&
            !fitWidth &&
            snapshot.ready &&
            snapshot.page?.widthMm && (
              <button
                type="button"
                className="ds-button"
                disabled={!enabled("zoom")}
                onClick={() => setFitWidth(true)}
              >
                좁은 화면: 페이지 너비에 맞춤
              </button>
            )}
          <label className="ds-zoom">
            확대
            <select
              aria-label="확대"
              value={fitWidth ? "width" : Math.round(snapshot.zoom * 100)}
              disabled={!enabled("zoom")}
              onChange={(event) => {
                const fit = event.target.value === "width";
                setFitWidth(fit);
                if (!fit)
                  run({ id: "zoom", value: Number(event.target.value) / 100 });
              }}
            >
              <option value="width" disabled={!snapshot.page?.widthMm}>
                페이지 너비에 맞춤
              </option>
              {Array.from(
                new Set([
                  Math.round(snapshot.zoom * 100),
                  50,
                  75,
                  100,
                  125,
                  150,
                  200,
                ]),
              )
                .sort((a, b) => a - b)
                .map((value) => (
                  <option key={value} value={value}>
                    {value}%
                  </option>
                ))}
            </select>
          </label>
        </footer>
      </EditorRegion>
      {offer && (
        <ModalDialog labelledBy={`${dialogId}-recovery`}>
          <h3 id={`${dialogId}-recovery`}>
            {corruptRecovery
              ? "복구 초안이 손상됐습니다"
              : "저장하지 않은 초안이 있습니다"}
          </h3>
          <p>
            {corruptRecovery
              ? "정상 원본은 확인됐습니다. 복구 자료를 다운로드하거나 손상된 초안을 버리고 원본을 열 수 있습니다."
              : offer.baseVersion !== input.version
                ? "초안 작성 뒤 원본 버전이 달라졌습니다. 초안을 복구하면 원본과 충돌할 수 있습니다."
                : "이전 편집을 이어서 진행할 수 있습니다."}
          </p>
          <div className="ds-dialog-actions">
            <button
              className="ds-button"
              onClick={() => {
                const context = recoveryContext.current;
                if (!context) return;
                void (async () => {
                  if (activeDraftStore() !== context.store)
                    throw new Error(
                      "초안 저장소가 변경됐습니다. 복구 상태를 다시 확인해 주세요.",
                    );
                  await context.store?.delete(context.key);
                  if (recoveryContext.current !== context) return;
                  setOffer(null);
                  setCorruptRecovery("");
                  setError("");
                  setEditableDocument(context.source);
                })().catch(reportError);
              }}
            >
              {corruptRecovery ? "손상된 초안 버리고 원본 열기" : "원본 열기"}
            </button>
            <button
              className="ds-button ds-primary"
              disabled={Boolean(corruptRecovery)}
              onClick={() => {
                const context = recoveryContext.current;
                if (!context || activeDraftStore() !== context.store) return;
                baseVersion.current = offer.baseVersion;
                setEditableDocument({
                  ...context.source,
                  bytes: offer.bytes,
                  version: offer.baseVersion,
                  recovered: true,
                });
                setOffer(null);
                if (offer.baseVersion !== context.source.version) {
                  setConflict(true);
                  setError(
                    "복구한 초안의 원본 버전이 다릅니다. 다운로드 후 최신 원본을 확인해 주세요.",
                  );
                }
              }}
            >
              초안 복구
            </button>
            {corruptRecovery && (
              <button
                className="ds-button"
                onClick={() =>
                  downloadDocument(
                    offer.bytes,
                    `복구자료-${offer.fileName}`,
                    offer.format,
                  )
                }
              >
                복구 자료 다운로드
              </button>
            )}
          </div>
        </ModalDialog>
      )}
      {copyPreview && (
        <ModalDialog
          labelledBy={`${dialogId}-copy-preview`}
          onCancel={() => setCopyPreview(null)}
        >
          <h3 id={`${dialogId}-copy-preview`}>대표 사본 페이지 미리보기</h3>
          <p>
            {copyPreview.fileName} · 긴 값의 줄바꿈과 표 넘침을 확인하세요. 이
            미리보기는 사본 생성·저장이 아닙니다.
          </p>
          <button
            type="button"
            className="ds-button"
            onClick={() => setCopyPreview(null)}
          >
            페이지 미리보기 닫기
          </button>
          <div className="ds-copy-page-preview">
            <DocumentEditor
              document={copyPreview}
              engines={props.engines}
              readOnly
              initialZoom="width"
              draftStore={false}
              automationDraftStore={false}
              appearance="embedded"
              slots={{ toolbar: () => null }}
            />
          </div>
        </ModalDialog>
      )}
      {closeDialog && (
        <ModalDialog
          labelledBy={`${dialogId}-close`}
          onCancel={() => setCloseDialog(false)}
        >
          <h3 id={`${dialogId}-close`}>편집을 마칠까요?</h3>
          <p>
            {snapshot.dirty
              ? "현재 문서에 저장하지 않은 변경사항이 있습니다."
              : outputPending()
                ? "생성 사본은 원본 저장에 포함되지 않습니다. 보관 여부를 확인해 주세요."
                : "아직 보관하지 않은 자동화 입력이 있습니다."}
          </p>
          {outputPending() && (
            <button
              type="button"
              className="ds-button"
              onClick={focusGeneratedOutput}
            >
              생성 사본 보관 화면으로 이동
            </button>
          )}
          {automationStatus.pending &&
            automationStatus.storage === "memory" && (
              <p role="alert">
                자동화 원본 입력은 문서 저장에 포함되지 않습니다. 입력을 따로
                내려받거나 계속 편집하세요. 변경을 버리고 닫으면 자동화 입력도
                사라집니다.
              </p>
            )}
          <div className="ds-dialog-actions">
            {automationStatus.pending && (
              <button
                className="ds-button"
                onClick={() => {
                  const url = URL.createObjectURL(
                    new Blob(
                      [JSON.stringify(automationSession.snapshot(), null, 2)],
                      { type: "application/json" },
                    ),
                  );
                  const link = window.document.createElement("a");
                  link.href = url;
                  link.download = `${displayed.fileName}-자동화입력.json`;
                  link.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                }}
              >
                자동화 입력 내려받기
              </button>
            )}
            <button className="ds-button" onClick={() => setCloseDialog(false)}>
              계속 편집
            </button>
            <button className="ds-button" onClick={downloadDraft}>
              초안 다운로드
            </button>
            <button
              className="ds-button ds-primary"
              disabled={outputPending()}
              onClick={discardAndClose}
            >
              변경 버리고 닫기
            </button>
          </div>
        </ModalDialog>
      )}
    </section>
  );
});
