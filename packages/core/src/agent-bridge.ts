import {
  AGENT_COMMAND_CATALOG,
  OFFICE_AUTOMATION_FORMS,
  AUTOMATION_ACTIONS,
  previewAutomation,
  validateTemplate,
  SaveConflictError,
  SelectionConflictError,
  inspectExport,
  type EditorCommand,
  type SearchOptions,
  type ReplaceRequest,
  type DocumentPreset,
  type AutomationRequest,
  type AutomationPreview,
  type DocumentTemplate,
  type EditorDocument,
  TABLE_COLUMN_SCHEMA,
  type TableColumnRequest,
  type QuickActionRequest,
  MAIL_MERGE_SCHEMA,
  type MailMergeRequest,
} from "./index";
import type {
  EditorController,
  DocumentCommitReceipt,
} from "./editor-controller";
import { AgentGuardError, AgentReadinessError } from "./agent-guard";

export interface AgentTarget {
  documentId: string;
  expectedSessionId?: string;
  expectedVersion?: string;
}
export interface AgentWriteTarget extends AgentTarget {
  expectedSessionId: string;
  expectedRevision: string;
}
export interface AgentSelectionTarget extends AgentWriteTarget {
  /** Exact opaque range returned by getState/select, including both endpoints. */
  expectedSelectionKey: string;
}

export interface AgentBridgeOptions {
  /** Pure document generation only. Saving/uploading remains a separate host operation. */
  createDocument?(template: DocumentTemplate): Promise<EditorDocument>;
}
export class AutomationOperationError extends Error {
  constructor(
    message: string,
    readonly effect: "none" | "unknown",
    readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AutomationOperationError";
  }
}

/** The host supplies transport/auth. Mutations require the identity returned by getState/search. */
export function createAgentBridge(
  getEditor: () => EditorController | null,
  options: AgentBridgeOptions = {},
) {
  const commits = new Map<
    string,
    { fingerprint: string; task: Promise<DocumentCommitReceipt> }
  >();
  const tableOperations = new Map<
    string,
    {
      fingerprint: string;
      task: ReturnType<NonNullable<EditorController["applyTableColumn"]>>;
    }
  >();
  const quickOperations = new Map<
    string,
    {
      fingerprint: string;
      task: ReturnType<NonNullable<EditorController["applyQuickAction"]>>;
    }
  >();
  const mailOperations = new Map<
    string,
    {
      fingerprint: string;
      task: ReturnType<NonNullable<EditorController["generateMailMerge"]>>;
    }
  >();
  const previews = new Map<
    string,
    {
      documentId: string;
      sessionId: string;
      version?: string;
      revision: string;
      result: AutomationPreview;
      characters: number;
    }
  >();
  const applied = new Map<
    string,
    {
      fingerprint: string;
      task: Promise<{
        applied: true;
        committed: false;
        documentId: string;
        sessionId: string;
        version?: string;
        revision: string;
        dirty: boolean;
        warnings: string[];
      }>;
    }
  >();
  const editor = () => {
    const handle = getEditor();
    if (!handle) throw new Error("열린 편집기가 없습니다.");
    return handle;
  };
  const identify = (request: AgentTarget, write = false) => {
    const handle = editor();
    if (typeof request.documentId !== "string" || !request.documentId)
      throw new Error("documentId가 필요합니다.");
    if (
      write &&
      (typeof request.expectedSessionId !== "string" ||
        !request.expectedSessionId)
    )
      throw new Error(
        "expectedSessionId가 필요합니다. 현재 편집 상태를 다시 조회해 주세요.",
      );
    const state = handle.getState();
    if (state.documentId !== request.documentId)
      throw new AgentGuardError("documentId");
    if (
      request.expectedSessionId !== undefined &&
      request.expectedSessionId !== state.sessionId
    )
      throw new AgentGuardError("sessionId");
    if (
      request.expectedVersion !== undefined &&
      request.expectedVersion !== state.version
    )
      throw new AgentGuardError("version");
    if (write) {
      const revision = (request as AgentWriteTarget).expectedRevision;
      if (typeof revision !== "string")
        throw new Error("expectedRevision이 필요합니다.");
      if (revision !== state.revision) throw new AgentGuardError("revision");
    }
    return { handle, state };
  };
  const target = (request: AgentTarget, write = false) => {
    const started = identify(request, write);
    if (!started.state.ready)
      throw new AgentReadinessError(started.state.initialization);
    return started;
  };
  const complete = (
    started: ReturnType<typeof target>,
    effect: "none" | "unknown" = "unknown",
  ) => {
    const current = editor().getState();
    for (const field of ["documentId", "sessionId", "version"] as const)
      if (current[field] !== started.state[field])
        throw new AgentGuardError(field, effect);
    // A completed read must not confirm content from an editor that is no longer ready.
    // Mutation/commit receipts retain their own authoritative outcome.
    if (effect === "none" && !current.ready)
      throw new AgentReadinessError(current.initialization);
    return {
      documentId: current.documentId,
      sessionId: current.sessionId,
      version: current.version,
      revision: current.revision,
      dirty: current.dirty,
    };
  };
  const selectionTarget = (request: AgentSelectionTarget) => {
    const started = target(request, true);
    if (
      typeof request.expectedSelectionKey !== "string" ||
      !request.expectedSelectionKey
    )
      throw new Error(
        "expectedSelectionKey가 필요합니다. 적용 대상을 다시 선택해 주세요.",
      );
    if (request.expectedSelectionKey !== started.state.selectionKey)
      throw new SelectionConflictError("none");
    return started;
  };
  const cachedPreview = (
    id: string,
    state: ReturnType<EditorController["getState"]>,
  ) => {
    const cached = previews.get(id);
    if (!cached)
      throw new Error(
        "미리보기가 없거나 만료됐습니다. 다시 미리보기해 주세요.",
      );
    if (
      cached.documentId !== state.documentId ||
      cached.sessionId !== state.sessionId ||
      cached.version !== state.version ||
      cached.revision !== state.revision
    )
      throw new SaveConflictError(
        "미리보기 이후 문서 상태가 변경됐습니다. 다시 미리보기해 주세요.",
      );
    return cached.result;
  };
  return {
    listMailMergeActions: () => ({
      inputSchema: structuredClone(MAIL_MERGE_SCHEMA),
      supported: Boolean(
        getEditor()?.getState().ready &&
          getEditor()?.previewMailMerge &&
          getEditor()?.generateMailMerge,
      ),
      workflow:
        "registerCurrentMailMergeTemplate or a user-uploaded template → listMailMergeTemplates → previewMailMerge → inspect files/empty values/issues → generateMailMerge → saveMailMergeResults({documentId, expectedSessionId, batchOperationId: generated.operationId}). Saving requires a host generatedStorage adapter. Inspect complete, remaining, stored paths and getMailMergeStatus; generation and source commit do not save copies. Retry saving only pending files after partial failure.",
    }),
    registerCurrentMailMergeTemplate: async (request: AgentTarget) => {
      const started = target(request);
      if (!started.handle.registerCurrentMailMergeTemplate)
        throw new Error("서식 등록을 지원하지 않습니다.");
      const result = await started.handle.registerCurrentMailMergeTemplate();
      complete(started);
      return result;
    },
    listMailMergeTemplates: (request: AgentTarget) => {
      const started = target(request);
      if (!started.handle.listMailMergeTemplates)
        throw new Error("메일머지를 지원하지 않습니다.");
      return started.handle.listMailMergeTemplates();
    },
    removeMailMergeTemplate: (
      request: AgentTarget & { expectedSessionId: string; templateId: string },
    ) => {
      if (
        typeof request.expectedSessionId !== "string" ||
        !request.expectedSessionId
      )
        throw new Error("현재 편집 세션 ID가 필요합니다.");
      const started = target(request);
      if (!started.handle.removeMailMergeTemplate)
        throw new Error("서식 등록 해제를 지원하지 않습니다.");
      return started.handle.removeMailMergeTemplate(request.templateId);
    },
    previewMailMerge: (
      request: AgentTarget & { mergeRequest: MailMergeRequest },
    ) => {
      const started = target(request);
      if (!started.handle.previewMailMerge)
        throw new Error("메일머지를 지원하지 않습니다.");
      return started.handle.previewMailMerge(request.mergeRequest);
    },
    generateMailMerge: async (
      request: AgentWriteTarget & { previewId: string; operationId: string },
    ) => {
      if (
        typeof request.operationId !== "string" ||
        !/^[a-zA-Z0-9._:-]{1,128}$/.test(request.operationId)
      )
        throw new Error("유효한 operationId가 필요합니다.");
      identify(request);
      const fingerprint = JSON.stringify([
          request.documentId,
          request.expectedSessionId,
          request.expectedRevision,
          request.expectedVersion,
          request.previewId,
        ]),
        previous = mailOperations.get(request.operationId);
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          throw new Error("다른 생성 요청에 사용한 작업 ID입니다.");
        return structuredClone(await previous.task);
      }
      const started = target(request, true);
      if (!started.handle.generateMailMerge)
        throw new Error("메일머지를 지원하지 않습니다.");
      if (mailOperations.size >= 64)
        throw new Error("생성 작업 기록 한도에 도달했습니다.");
      const task = started.handle.generateMailMerge({
        previewId: request.previewId,
        operationId: request.operationId,
      });
      mailOperations.set(request.operationId, { fingerprint, task });
      return structuredClone(await task);
    },
    getMailMergeStatus: (request: AgentTarget) => {
      const started = target(request);
      if (!started.handle.getMailMergeStatus)
        throw new Error("메일머지를 지원하지 않습니다.");
      return started.handle.getMailMergeStatus();
    },
    saveMailMergeResults: (
      request: AgentTarget & {
        expectedSessionId: string;
        batchOperationId: string;
      },
    ) => {
      if (
        !request.expectedSessionId ||
        typeof request.batchOperationId !== "string" ||
        !request.batchOperationId
      )
        throw new Error("편집 세션과 생성 작업 ID가 필요합니다.");
      const started = target(request);
      if (!started.handle.saveMailMergeResults)
        throw new Error("사본 저장소가 연결되지 않았습니다.");
      return started.handle.saveMailMergeResults(request.batchOperationId);
    },
    cancelMailMerge: (request: AgentTarget & { operationId: string }) => {
      const started = target(request);
      if (!started.handle.cancelMailMerge)
        throw new Error("메일머지를 지원하지 않습니다.");
      started.handle.cancelMailMerge(request.operationId);
      return { cancelRequested: true };
    },
    listQuickActions: () => {
      const method = editor().listQuickActions;
      if (!method) throw new Error("빠른 작업을 지원하지 않습니다.");
      return method();
    },
    previewQuickAction: (
      request: AgentTarget & { action: QuickActionRequest },
    ) => {
      const started = target(request);
      if (!started.handle.previewQuickAction)
        throw new Error("빠른 작업을 지원하지 않습니다.");
      return started.handle.previewQuickAction(request.action);
    },
    applyQuickAction: async (
      request: AgentSelectionTarget & {
        previewId: string;
        operationId: string;
      },
    ) => {
      if (
        typeof request.operationId !== "string" ||
        !/^[a-zA-Z0-9._:-]{1,128}$/.test(request.operationId)
      )
        throw new Error("유효한 operationId가 필요합니다.");
      identify(request);
      const fingerprint = JSON.stringify([
        request.documentId,
        request.expectedSessionId,
        request.expectedRevision,
        request.expectedSelectionKey,
        request.expectedVersion,
        request.previewId,
      ]);
      const previous = quickOperations.get(request.operationId);
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          throw new Error("다른 빠른 작업 요청에 사용한 ID입니다.");
        return structuredClone(await previous.task);
      }
      const { handle } = selectionTarget(request);
      if (!handle.applyQuickAction)
        throw new Error("빠른 작업을 지원하지 않습니다.");
      if (quickOperations.size >= 128)
        throw new Error("빠른 작업 기록 한도에 도달했습니다.");
      const task = handle.applyQuickAction({
        previewId: request.previewId,
        operationId: request.operationId,
      });
      quickOperations.set(request.operationId, { fingerprint, task });
      return structuredClone(await task);
    },
    listTableColumnActions: () => ({
      supported: Boolean(
        getEditor()?.getState().tableColumnEditing &&
          getEditor()?.readTable &&
          getEditor()?.previewTableColumn &&
          getEditor()?.applyTableColumn,
      ),
      previewInputSchema: structuredClone(TABLE_COLUMN_SCHEMA),
      preconditions: [
        "Select a cell in a supported body table before readTable. Use search then select if the caret is outside the table.",
      ],
      readErrors: [
        "table-selection-required",
        "table-cell-required",
        "table-structure-unsupported",
        "table-limit-exceeded",
      ],
      workflow:
        "readTable → previewTableColumn({documentId, columnRequest}) → inspect changes/excluded → applyTableColumn({documentId, expectedSessionId, expectedRevision, expectedSelectionKey, previewId, operationId}). Save separately with commit.",
      description:
        "현재 표의 한 열만 처리합니다. 쉼표와 대소문자를 구분하는 문자 그대로 치환을 지원합니다. 식별자·날짜·복잡한 셀은 미리보기에 제외 이유를 표시합니다.",
    }),
    readTable: async (request: AgentTarget) => {
      const started = target(request);
      if (!started.handle.readTable)
        throw new Error("표 열 편집을 지원하지 않습니다.");
      const result = await started.handle.readTable();
      complete(started, "none");
      return result;
    },
    previewTableColumn: async (
      request: AgentTarget & { columnRequest: TableColumnRequest },
    ) => {
      const started = target(request);
      if (!started.handle.previewTableColumn)
        throw new Error("표 열 편집을 지원하지 않습니다.");
      const result = await started.handle.previewTableColumn(
        request.columnRequest,
      );
      complete(started, "none");
      return result;
    },
    applyTableColumn: async (
      request: AgentSelectionTarget & {
        previewId: string;
        operationId: string;
      },
    ) => {
      if (
        typeof request.operationId !== "string" ||
        !/^[a-zA-Z0-9._:-]{1,128}$/.test(request.operationId)
      )
        throw new Error("유효한 operationId가 필요합니다.");
      identify(request);
      const fingerprint = JSON.stringify([
        request.documentId,
        request.expectedSessionId,
        request.expectedRevision,
        request.expectedSelectionKey,
        request.expectedVersion,
        request.previewId,
      ]);
      const previous = tableOperations.get(request.operationId);
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          throw new Error("작업 ID가 다른 표 요청에 사용됐습니다.");
        return structuredClone(await previous.task);
      }
      const started = selectionTarget(request);
      if (!started.handle.applyTableColumn)
        throw new Error("표 열 편집을 지원하지 않습니다.");
      if (tableOperations.size >= 128)
        throw new Error("표 작업 기록 한도에 도달했습니다.");
      const task = started.handle.applyTableColumn({
        previewId: request.previewId,
        operationId: request.operationId,
      });
      tableOperations.set(request.operationId, { fingerprint, task });
      return structuredClone(await task);
    },
    getState: () => editor().getState(),
    /** Small identity snapshot for tools that do not need the full formatting/command catalogue. */
    getContext: () => {
      const state = editor().getState();
      return {
        documentId: state.documentId,
        sessionId: state.sessionId,
        version: state.version,
        revision: state.revision,
        selectionKey: state.selectionKey,
        format: state.format,
        ready: state.ready,
        dirty: state.dirty,
        busy: state.busy,
        initialization: state.initialization,
        fonts: state.fonts,
        capabilities: {
          readDocument: state.ready,
          search: state.ready,
          tableColumnEditing: state.ready && state.tableColumnEditing === true,
          insertText:
            state.ready && state.commands.insertText?.enabled === true,
          atomicTextInsertion: state.atomicTextInsertion === true,
          atomicPresets: state.atomicPresets === true,
        },
      };
    },
    retryInitialization: (
      request: AgentTarget & { expectedSessionId: string },
    ) => {
      if (!request.expectedSessionId)
        throw new Error("expectedSessionId가 필요합니다.");
      const { handle, state } = identify(request);
      if (
        state.initialization?.status !== "failed" ||
        !state.initialization.error.retryable ||
        !handle.retryInitialization
      )
        throw new Error("재시도 가능한 편집기 초기화 오류가 없습니다.");
      handle.retryInitialization();
    },
    listAutomationForms: () => structuredClone(OFFICE_AUTOMATION_FORMS),
    listAutomationActions: () => {
      const state = getEditor()?.getState();
      return AUTOMATION_ACTIONS.map((action) => ({
        ...structuredClone(action),
        preview: Boolean(state?.ready),
        applyModes: ["text"] as const,
        applyEnabled: Boolean(
          state?.ready && !state.busy && state.commands.insertText?.enabled,
        ),
        createDocument:
          action.createsDocument && Boolean(options.createDocument),
        imageApply: false,
        imageApplyReason:
          "에이전트의 비동기 그림 삽입은 권한·범위 보장을 지원하지 않습니다.",
      }));
    },
    previewAutomation: (
      request: AgentTarget & { automation: AutomationRequest },
    ) => {
      const started = target(request);
      const result = previewAutomation(request.automation);
      const identity = complete(started);
      if (identity.revision !== started.state.revision)
        throw new SaveConflictError("미리보기 중 문서가 변경됐습니다.");
      const characters = JSON.stringify(result).length;
      if (characters > 8_000_000)
        throw new RangeError("에이전트 미리보기 보관 크기를 넘었습니다.");
      while (
        previews.size >= 16 ||
        [...previews.values()].reduce((n, value) => n + value.characters, 0) +
          characters >
          8_000_000
      )
        previews.delete(previews.keys().next().value!);
      const previewId = crypto.randomUUID();
      previews.set(previewId, { ...identity, result, characters });
      return {
        ...identity,
        previewId,
        ...structuredClone(result),
        changed: false,
        committed: false,
      };
    },
    applyAutomation: async (
      request: AgentSelectionTarget & {
        previewId: string;
        mode: "text";
        operationId: string;
      },
    ) => {
      if (request.mode !== "text")
        throw new TypeError(
          "현재 문서 적용은 명시적인 text 모드만 지원합니다. 구조 보존은 새 문서 생성을 사용하세요.",
        );
      if (
        typeof request.operationId !== "string" ||
        !/^[a-zA-Z0-9._:-]{1,128}$/.test(request.operationId)
      )
        throw new TypeError("유효한 operationId가 필요합니다.");
      const fingerprint = JSON.stringify([
        request.documentId,
        request.expectedSessionId,
        request.expectedVersion,
        request.expectedRevision,
        request.expectedSelectionKey,
        request.previewId,
        request.mode,
      ]);
      const previous = applied.get(request.operationId);
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          throw new Error("operationId가 다른 요청에 이미 사용됐습니다.");
        return structuredClone(await previous.task);
      }
      if (applied.size >= 128)
        throw new Error(
          "자동화 작업 기록 한도에 도달했습니다. 호스트가 기록을 보관한 뒤 새 브리지를 연결해 주세요.",
        );
      const started = selectionTarget(request);
      const result = cachedPreview(request.previewId, started.state);
      if (
        !started.state.commands.insertText?.supported ||
        !started.state.commands.insertText?.enabled
      )
        throw new Error(
          started.state.commands.insertText?.reason ??
            "현재 문서에 텍스트를 적용할 수 없습니다.",
        );
      const task = (async () => {
        try {
          await started.handle.execute(
            { id: "insertText", value: result.text },
            {
              expectedRevision: request.expectedRevision,
              expectedSelectionKey: request.expectedSelectionKey,
            },
          );
          return {
            applied: true as const,
            committed: false as const,
            ...complete(started),
            warnings: [
              ...result.warnings,
              ...(result.kind === "text"
                ? []
                : ["텍스트로 적용했습니다. 표·그림·서식 구조는 제외됐습니다."]),
            ],
          };
        } catch (cause) {
          // A rejected/late native response cannot prove that no write happened.
          // Keep this operation ID recorded so retrying it never duplicates text.
          throw new AutomationOperationError(
            "자동화 적용 결과를 확정하지 못했습니다. 문서를 조회한 뒤 새 작업으로 진행하세요.",
            "unknown",
            false,
            { cause },
          );
        }
      })();
      applied.set(request.operationId, { fingerprint, task });
      try {
        return structuredClone(await task);
      } catch (cause) {
        if (cause instanceof AutomationOperationError && cause.retryable)
          applied.delete(request.operationId);
        throw cause;
      }
    },
    createAutomationDocument: async (
      request: AgentWriteTarget & {
        previewId: string;
        fileName: string;
      },
    ) => {
      const started = target(request, true);
      const preview = cachedPreview(request.previewId, started.state);
      if (!options.createDocument || !preview.template)
        throw new Error(
          "이 기능 또는 호스트는 구조를 유지하는 문서 생성을 지원하지 않습니다.",
        );
      const template = {
        ...structuredClone(preview.template),
        fileName: request.fileName,
      };
      validateTemplate(template);
      const document = await options.createDocument(template);
      const identity = complete(started);
      if (identity.revision !== started.state.revision)
        throw new SaveConflictError("문서 생성 중 원본이 변경됐습니다.");
      return {
        ...identity,
        created: true,
        committed: false,
        document,
        warnings: [
          ...preview.warnings,
          "파일을 생성했습니다. 저장 또는 업로드는 호스트가 별도로 수행해야 합니다.",
        ],
      };
    },
    listCommands: () => {
      const state = editor().getState();
      return AGENT_COMMAND_CATALOG.map((command) => ({
        ...command,
        supported: false,
        enabled: false,
        ...state.commands[command.id],
        ...(state.selectionGuardedCommands === false
          ? {
              enabled: false,
              reason:
                "현재 선택은 에이전트 범위 보호를 지원하지 않습니다. 텍스트 범위를 다시 선택해 주세요.",
            }
          : {}),
        ...(command.id === "insertImage"
          ? {
              supported: false,
              enabled: false,
              reason:
                "에이전트의 비동기 그림 삽입은 권한·범위 보장을 지원하지 않습니다.",
            }
          : {}),
      }));
    },
    inspect: async (request: AgentTarget) => {
      const started = target(request);
      const exported = await started.handle.exportDocument();
      const structure = inspectExport(exported);
      const identity = complete(started, "none");
      if (identity.revision !== exported.revision)
        throw new SaveConflictError("구조 조회 중 문서가 변경됐습니다.");
      const hash = await crypto.subtle.digest(
        "SHA-256",
        new Uint8Array(exported.bytes),
      );
      const finished = complete(started, "none");
      if (finished.revision !== exported.revision)
        throw new AgentGuardError("revision");
      return {
        ...finished,
        ...structure,
        digest: `sha256:${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("")}`,
      };
    },
    /** Receipts are replayable within this bridge lifetime. Hosts must persist them for reconnect recovery. */
    commit: async (request: AgentWriteTarget & { operationId: string }) => {
      if (
        typeof request.operationId !== "string" ||
        !/^[a-zA-Z0-9._:-]{1,128}$/.test(request.operationId)
      )
        throw new Error(
          "operationId는 1~128자의 영문·숫자·._:- 값이어야 합니다.",
        );
      const fingerprint = JSON.stringify([
        request.documentId,
        request.expectedSessionId,
        request.expectedVersion,
        request.expectedRevision,
      ]);
      const previous = commits.get(request.operationId);
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          throw new Error("operationId가 다른 요청에 이미 사용됐습니다.");
        // Replaying a confirmed receipt tolerates later edits/readiness loss,
        // but a new request must still belong to the current document/session.
        const state = editor().getState();
        if (state.documentId !== request.documentId)
          throw new AgentGuardError("documentId");
        if (state.sessionId !== request.expectedSessionId)
          throw new AgentGuardError("sessionId");
        return structuredClone(await previous.task);
      }
      const started = target(request, true);
      if (!started.handle.commit)
        throw new Error("이 편집기는 저장 확정 계약을 지원하지 않습니다.");
      if (commits.size >= 128)
        throw new Error(
          "저장 작업 기록 한도에 도달했습니다. 호스트가 기록을 보관한 뒤 새 브리지를 연결해 주세요.",
        );
      const task = started.handle.commit({
        expectedRevision: request.expectedRevision,
      });
      commits.set(request.operationId, { fingerprint, task });
      try {
        return structuredClone(await task);
      } catch (error) {
        commits.delete(request.operationId);
        throw error;
      }
    },
    readDocument: async (request: AgentTarget) => {
      const started = target(request);
      const result = await started.handle.readDocument();
      const identity = complete(started, "none");
      if (identity.revision !== result.revision)
        throw new AgentGuardError("revision");
      return { ...identity, ...result };
    },
    search: async (request: SearchOptions & AgentTarget) => {
      const started = target(request);
      const result = await started.handle.search(request);
      const identity = complete(started, "none");
      if (identity.revision !== result.revision)
        throw new AgentGuardError("revision");
      return { ...identity, ...result };
    },
    select: async (request: AgentWriteTarget & { matchId: string }) => {
      const started = target(request, true);
      await started.handle.selectMatch(
        request.matchId,
        request.expectedRevision,
      );
      return {
        applied: true,
        ...complete(started),
        selectionKey: started.handle.getState().selectionKey,
      };
    },
    replace: async (request: ReplaceRequest & AgentWriteTarget) => {
      const started = target(request, true);
      const result = await started.handle.replace(
        request,
        request.expectedRevision,
      );
      return {
        ...complete(started),
        applied: result.count > 0,
        count: result.count,
      };
    },
    applyPreset: async (
      request: AgentSelectionTarget & { preset: DocumentPreset },
    ) => {
      const started = selectionTarget(request);
      await started.handle.applyPreset(
        request.preset,
        request.expectedRevision,
        request.expectedSelectionKey,
      );
      return { applied: true, ...complete(started) };
    },
    execute: async (
      request: AgentSelectionTarget & { command: EditorCommand },
    ) => {
      const started = selectionTarget(request);
      await started.handle.execute(request.command, {
        expectedRevision: request.expectedRevision,
        expectedSelectionKey: request.expectedSelectionKey,
      });
      return { applied: true, ...complete(started) };
    },
  };
}
