import type {
  EditorSnapshot,
  EditorCommand,
  ExportSnapshot,
  StorageWarning,
  DocumentContent,
  SearchOptions,
  SearchResult,
  ReplaceRequest,
  DocumentPreset,
} from "./index";

export interface AutomationDraftStatus {
  ready: boolean;
  pending: boolean;
  storage: "memory" | "local";
  error: string;
}

export type EditorControllerState = EditorSnapshot & {
  documentId: string;
  format: string;
  version?: string;
  /** Opaque identity of the mounted editing session. Changes even on same-version reloads. */
  sessionId: string;
  warnings?: readonly StorageWarning[];
  automationDraft: AutomationDraftStatus;
};

export interface EditorController {
  readTable?(): Promise<
    import("./table-column").TableSnapshot &
      import("./table-column").TableEditIdentity
  >;
  previewTableColumn?(
    request: import("./table-column").TableColumnRequest,
  ): Promise<import("./table-column").TableColumnPreview>;
  applyTableColumn?(request: {
    previewId: string;
    operationId: string;
  }): Promise<import("./table-column").TableColumnReceipt>;
  getState(): EditorControllerState;
  execute(
    command: EditorCommand,
    options?: { expectedRevision?: string; expectedSelectionKey?: string },
  ): Promise<void>;
  exportDocument(): Promise<ExportSnapshot>;
  /** Await before unmounting or replacing a document. Rejects if the latest draft cannot be persisted. */
  flushDraft(): Promise<void>;
  /** Retry automation storage independently, without exporting or uploading document bytes. */
  flushAutomationDraft(): Promise<void>;
  /** Retry only a failed initial engine boot; never replace a ready editing session. */
  retryInitialization?(): void;
  /** Drain pending commands before checking dirty; clean sessions can skip uploading. */
  save(options?: { onlyIfDirty?: boolean }): Promise<void>;
  /** Confirmed document save, separate from local input persistence and host refresh warnings. */
  commit?(options: {
    expectedRevision: string;
  }): Promise<DocumentCommitReceipt>;
  /** Await native input freeze before saving and navigating. Release on failure or after the transition. */
  acquireInputLock(): Promise<() => Promise<void>>;
  readDocument(): Promise<DocumentContent>;
  search(input: SearchOptions): Promise<SearchResult>;
  selectMatch(id: string, expectedRevision: string): Promise<void>;
  replace(
    input: ReplaceRequest,
    expectedRevision: string,
  ): Promise<{ count: number }>;
  applyPreset(
    preset: DocumentPreset,
    expectedRevision?: string,
    expectedSelectionKey?: string,
  ): Promise<void>;
}
export interface DocumentCommitReceipt {
  documentId: string;
  sessionId: string;
  fileName: string;
  format: string;
  version: string;
  savedRevision: string;
  digest: string;
  destination: "storage" | "download";
  warnings: readonly StorageWarning[];
  automationDraft: AutomationDraftStatus;
}
export interface DocumentSavedEvent extends ExportSnapshot {
  documentId: string;
  fileName: string;
  version: string;
  warnings?: readonly StorageWarning[];
  /** Local automation fields are separate from the committed document. */
  automationDraft?: AutomationDraftStatus;
}
