import {
  AGENT_COMMAND_CATALOG,
  OFFICE_AUTOMATION_FORMS,
  SaveConflictError,
  SelectionConflictError,
  inspectExport,
  type EditorCommand,
  type SearchOptions,
  type ReplaceRequest,
  type DocumentPreset,
} from "@document-studio/core";
import type {
  DocumentEditorHandle,
  DocumentCommitReceipt,
} from "./document-editor";

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

/** The host supplies transport/auth. Mutations require the identity returned by getState/search. */
export function createAgentBridge(
  getEditor: () => DocumentEditorHandle | null,
) {
  const commits = new Map<
    string,
    { fingerprint: string; task: Promise<DocumentCommitReceipt> }
  >();
  const editor = () => {
    const handle = getEditor();
    if (!handle) throw new Error("열린 편집기가 없습니다.");
    return handle;
  };
  const target = (request: AgentTarget, write = false) => {
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
      throw new SaveConflictError("대상 문서가 변경됐습니다.");
    if (
      request.expectedSessionId !== undefined &&
      request.expectedSessionId !== state.sessionId
    )
      throw new SaveConflictError("대상 편집 세션이 변경됐습니다.");
    if (
      request.expectedVersion !== undefined &&
      request.expectedVersion !== state.version
    )
      throw new SaveConflictError("대상 문서 버전이 변경됐습니다.");
    if (write) {
      const revision = (request as AgentWriteTarget).expectedRevision;
      if (typeof revision !== "string")
        throw new Error("expectedRevision이 필요합니다.");
      if (revision !== state.revision)
        throw new SaveConflictError("편집 revision이 변경됐습니다.");
    }
    if (!state.ready) throw new Error("편집기를 준비하는 중입니다.");
    return { handle, state };
  };
  const complete = (started: ReturnType<typeof target>) => {
    const current = editor().getState();
    if (
      current.documentId !== started.state.documentId ||
      current.sessionId !== started.state.sessionId ||
      current.version !== started.state.version
    )
      throw new SaveConflictError(
        "작업 중 대상 문서 또는 편집 세션이 변경됐습니다.",
      );
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
      throw new SelectionConflictError();
    return started;
  };
  return {
    getState: () => editor().getState(),
    listAutomationForms: () => structuredClone(OFFICE_AUTOMATION_FORMS),
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
      const identity = complete(started);
      if (identity.revision !== exported.revision)
        throw new SaveConflictError("구조 조회 중 문서가 변경됐습니다.");
      const hash = await crypto.subtle.digest(
        "SHA-256",
        new Uint8Array(exported.bytes),
      );
      complete(started);
      return {
        ...identity,
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
      const identity = complete(started);
      if (identity.revision !== result.revision)
        throw new SaveConflictError(
          "문서 조회 중 내용이 변경됐습니다. 다시 조회해 주세요.",
        );
      return { ...identity, ...result };
    },
    search: async (request: SearchOptions & AgentTarget) => {
      const started = target(request);
      const result = await started.handle.search(request);
      const identity = complete(started);
      if (identity.revision !== result.revision)
        throw new SaveConflictError(
          "검색 중 문서가 변경됐습니다. 다시 검색해 주세요.",
        );
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
