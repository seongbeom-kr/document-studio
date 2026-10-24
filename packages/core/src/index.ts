export type DocumentFormat = "hwpx" | "docx";
export interface EditorDocument {
  id: string;
  fileName: string;
  format: DocumentFormat;
  bytes: Uint8Array;
  version?: string;
  recovered?: boolean;
}
export {
  COMMAND_IDS,
  COMMAND_LABELS,
  AGENT_COMMAND_CATALOG,
  COMMAND_INPUT_SCHEMAS,
  validateCommand,
} from "./commands";
export type {
  CommandId,
  EditorCommand,
  ParagraphSettings,
  PageSettings,
  ImageInsert,
} from "./commands";
export { REPORT_PRESETS } from "./presets";
export type { DocumentPreset } from "./presets";
export * from "./office-automation";
export * from "./automation-forms";
export * from "./automation-runner";
export * from "./table-column";
export * from "./quick-actions";
export * from "./paste-clean";
export * from "./mail-merge";
export * from "./image-dimensions";
export * from "./templates";
export * from "./archive";
export * from "./validation";
export * from "./export-snapshot";
export * from "./report-graphics";
export * from "./preset-error";
export * from "./selection-conflict";
export * from "./inspect";
export * from "./initialization";
export * from "./fonts";
import type {
  CommandId,
  EditorCommand,
  ParagraphSettings,
  PageSettings,
} from "./commands";
export interface CommandState {
  supported: boolean;
  enabled: boolean;
  active?: boolean;
  reason?: string;
  /** Engine-specific parameter choices and schema, also exposed to agent clients. */
  valueChoices?: readonly { value: string; label: string }[];
  valueSchema?: Record<string, unknown>;
}
export interface EditorSnapshot {
  /** Actual portable font supply and substitutions; authored font names are preserved. */
  fonts?: import("./fonts").DocumentFontReport;
  ready: boolean;
  /** Host lifecycle, separate from document mutations and command busy state. */
  initialization?: import("./initialization").EngineInitializationState;
  revision: string;
  dirty: boolean;
  pageCount: number;
  zoom: number;
  fontFamily?: string;
  fontSize?: number;
  lineSpacing?: number;
  paragraph?: ParagraphSettings;
  page?: PageSettings;
  textColor?: string;
  highlightColor?: string;
  table?: { rows: number; columns: number };
  selectionCollapsed?: boolean;
  selectionStateScope?: "caret" | "selection";
  selectionKey?: string;
  /** Bounded excerpt, never used as a range identity. */
  selectionText?: string;
  selectionTextLength?: number;
  selectionDescription?: string;
  /** Full native range is checked at the mutation boundary. */
  selectionGuardedCommands?: boolean;
  commands: Partial<Record<CommandId, CommandState>>;
  /** Host UI state added by DocumentEditor; engines do not need to populate these fields. */
  busy?: boolean;
  saving?: boolean;
  /** In-flight SDK operations, including asynchronous engine edits. */
  pendingCommands?: number;
  /** Automation source fields waiting for their separate draft store; not document-byte changes. */
  automationDraftPending?: boolean;
  /** Generated copies have their own lifetime; saving the source does not deliver them. */
  generatedOutputPending?: boolean;
  generatedOutputCount?: number;
  /** Separate local automation storage status. A failed load must still block navigation. */
  automationDraftReady?: boolean;
  automationDraftError?: string;
  /** The adapter commits a preset as one native undo unit, without partial writes. */
  atomicPresets?: boolean;
  /** Replacing a selected range with inserted text is one undo transaction. */
  atomicTextInsertion?: boolean;
  /** Selected-table reads and atomic column edits are available in this runtime. */
  tableColumnEditing?: boolean;
}
export interface DocumentContent {
  revision: string;
  paragraphs: readonly { id: string; text: string }[];
  text: string;
  truncated: boolean;
  scope: "body-and-tables";
}
export interface SearchOptions {
  query: string;
  matchCase?: boolean;
  wholeWord?: boolean;
  maxResults?: number;
}
export interface SearchMatch {
  id: string;
  text: string;
  before: string;
  after: string;
}
export interface SearchResult {
  revision: string;
  matches: readonly SearchMatch[];
  total: number;
  truncated: boolean;
}
export interface ReplaceRequest extends Partial<SearchOptions> {
  matchId?: string;
  replacement: string;
  all?: boolean;
}
export function validateSearch(input: SearchOptions): void {
  if (
    !input ||
    typeof input.query !== "string" ||
    !input.query.length ||
    input.query.length > 1024 ||
    input.query.includes("\0")
  )
    throw new Error("검색어는 1~1,024자로 입력해 주세요.");
  if (
    input.maxResults !== undefined &&
    (!Number.isInteger(input.maxResults) ||
      input.maxResults < 1 ||
      input.maxResults > 500)
  )
    throw new Error("검색 결과 제한은 1~500개입니다.");
  for (const key of ["matchCase", "wholeWord"] as const)
    if (input[key] !== undefined && typeof input[key] !== "boolean")
      throw new Error("검색 옵션이 올바르지 않습니다.");
}
export function validateReplace(input: ReplaceRequest): void {
  if (
    !input ||
    typeof input.replacement !== "string" ||
    input.replacement.length > 1_000_000 ||
    input.replacement.includes("\0")
  )
    throw new Error("바꿀 내용이 올바르지 않습니다.");
  if (input.all !== undefined && typeof input.all !== "boolean")
    throw new Error("전체 치환 옵션은 boolean이어야 합니다.");
  if (input.all)
    validateSearch({
      query: input.query!,
      matchCase: input.matchCase,
      wholeWord: input.wholeWord,
    });
  else if (typeof input.matchId !== "string" || !input.matchId)
    throw new Error("검색 결과 ID가 필요합니다.");
}
export interface ExportSnapshot {
  bytes: Uint8Array;
  revision: string;
  format: DocumentFormat;
}
export interface EditorSession {
  captureQuestionTarget?(): Promise<
    import("./document-question").EngineQuestionTarget
  >;
  clearQuestionTarget?(): void;
  getQuestionRects?(): Promise<import("./document-question").QuestionRect[]>;
  readTable?(): Promise<import("./table-column").TableSnapshot>;
  applyTableChanges?(
    table: import("./table-column").TableSnapshot,
    changes: readonly import("./table-column").TableCellChange[],
    assertCurrent: () => void,
  ): Promise<void>;
  /** Freeze native user input; SDK-owned commands already in flight may finish. */
  setInputBlocked?(blocked: boolean): Promise<void>;
  getSnapshot(): EditorSnapshot;
  subscribe(listener: () => void): () => void;
  execute(
    command: EditorCommand,
    options?: {
      expectedRevision?: string;
      expectedSelectionKey?: string;
      assertCurrent?(): void;
    },
  ): Promise<void>;
  executePreset?(
    commands: readonly EditorCommand[],
    options: {
      expectedRevision: string;
      expectedSelectionKey?: string;
      assertCurrent(): void;
    },
  ): Promise<void>;
  exportDocument(): Promise<ExportSnapshot>;
  markSaved(revision: string): Promise<void>;
  readDocument?(): Promise<DocumentContent>;
  search?(input: SearchOptions): Promise<SearchResult>;
  selectMatch?(id: string, expectedRevision: string): Promise<void>;
  replace?(
    input: ReplaceRequest,
    expectedRevision: string,
  ): Promise<{ count: number }>;
}
export interface StorageWarning {
  code: string;
  message: string;
}
export interface DocumentSaveResult {
  version: string;
  /** The document is committed; these warnings must not trigger a document re-upload. */
  warnings?: readonly StorageWarning[];
}
export function validateSaveResult(value: unknown): DocumentSaveResult {
  const input = value as DocumentSaveResult | undefined;
  if (
    !input ||
    typeof input.version !== "string" ||
    !input.version.trim() ||
    input.version.length > 4096 ||
    /[\x00-\x1f]/.test(input.version)
  )
    throw new Error(
      "저장소가 유효한 저장 version을 반환하지 않았습니다. 저장 상태를 확인해 주세요.",
    );
  if (input.warnings === undefined) return { version: input.version };
  if (
    !Array.isArray(input.warnings) ||
    input.warnings.length > 100 ||
    input.warnings.some(
      (w) =>
        !w ||
        typeof w.code !== "string" ||
        typeof w.message !== "string" ||
        w.code.length > 128 ||
        w.message.length > 4000,
    )
  )
    return {
      version: input.version,
      warnings: [
        {
          code: "storage-warning-invalid",
          message: "문서는 저장됐지만 저장소 경고 형식을 확인하지 못했습니다.",
        },
      ],
    };
  return { version: input.version, warnings: input.warnings };
}
export interface DocumentStorage {
  save(input: {
    document: EditorDocument;
    bytes: Uint8Array;
    expectedVersion?: string;
  }): Promise<DocumentSaveResult>;
}
export { SaveConflictError } from "./save-conflict";
export interface DocumentDraft {
  key: string;
  bytes: Uint8Array;
  baseVersion?: string;
  fileName: string;
  format: DocumentFormat;
  updatedAt: number;
}
export interface DraftStore {
  get(key: string): Promise<DocumentDraft | undefined>;
  put(draft: DocumentDraft): Promise<void>;
  delete(key: string): Promise<void>;
}
export function draftKey(namespace: string, documentId: string): string {
  return JSON.stringify([namespace, documentId]);
}
export function detectFormat(name: string): DocumentFormat {
  const extension = name.split(".").at(-1)?.toLowerCase();
  if (extension === "docx" || extension === "hwpx") return extension;
  throw new Error("첫 버전에서는 HWPX와 DOCX 문서를 열 수 있습니다.");
}
export class SessionStore {
  private listeners = new Set<() => void>();
  private snapshot: EditorSnapshot = {
    ready: false,
    revision: "0",
    dirty: false,
    pageCount: 0,
    zoom: 1,
    commands: {},
  };
  getSnapshot = (): EditorSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  update(next: EditorSnapshot): void {
    if (JSON.stringify(this.snapshot) === JSON.stringify(next)) return;
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}
/** A save acknowledgement belongs to the exported revision, not to later edits. */
export class RevisionState {
  private saved: string;
  private recovered: boolean;
  constructor(initial: string, recovered = false) {
    this.saved = initial;
    this.recovered = recovered;
  }
  dirty(current: string): boolean {
    return this.recovered || this.saved !== current;
  }
  acknowledge(exported: string): void {
    this.saved = exported;
    this.recovered = false;
  }
}

export function browserDraftStore(
  databaseName = "document-studio-drafts",
): DraftStore {
  async function transaction<T>(
    mode: IDBTransactionMode,
    action: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("drafts", { keyPath: "key" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<T>((resolve, reject) => {
        const tx = db.transaction("drafts", mode);
        const request = action(tx.objectStore("drafts"));
        let result: T;
        request.onsuccess = () => {
          result = request.result;
        };
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () =>
          reject(tx.error ?? new Error("초안 저장이 중단됐습니다."));
      });
    } finally {
      db.close();
    }
  }
  return {
    get: (key) => transaction("readonly", (store) => store.get(key)),
    put: async (draft) => {
      await transaction("readwrite", (store) => store.put(draft));
    },
    delete: async (key) => {
      await transaction("readwrite", (store) => store.delete(key));
    },
  };
}

export type {
  EditorController,
  EditorControllerState,
  EditorCloseRequest,
  DocumentCommitReceipt,
  DocumentSavedEvent,
  AutomationDraftStatus,
} from "./editor-controller";
export { createAgentBridge, AutomationOperationError } from "./agent-bridge";
export type {
  AgentTarget,
  AgentWriteTarget,
  AgentSelectionTarget,
  AgentBridgeOptions,
} from "./agent-bridge";
export * from "./generated-output";
export * from "./document-question";
export * from "./agent-tools";
export * from "./agent-guard";
export * from "./agent-session-tools";
export * from "./agent-error";
export * from "./search-result-expired";
export * from "./version";
