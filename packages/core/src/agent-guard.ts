import { SaveConflictError } from "./save-conflict";
import type { EngineInitializationState } from "./initialization";

/** No document operation was performed. Resolve readiness before issuing a new request. */
export class AgentReadinessError extends Error {
  readonly effect = "none";
  readonly retryable = false;
  readonly code: "editor-not-ready" | "editor-initialization-failed";
  readonly requiredAction:
    | "wait-for-ready"
    | "retry-initialization"
    | "inspect-initialization";
  constructor(initialization?: EngineInitializationState) {
    const failed = initialization?.status === "failed";
    super(
      failed
        ? "편집기 초기화에 실패했습니다. 초기화 상태를 확인해 주세요."
        : "편집기를 준비하는 중입니다. 준비 상태를 다시 확인해 주세요.",
    );
    this.name = "AgentReadinessError";
    this.code = failed ? "editor-initialization-failed" : "editor-not-ready";
    this.requiredAction = failed
      ? initialization.error.retryable
        ? "retry-initialization"
        : "inspect-initialization"
      : "wait-for-ready";
  }
}

export type AgentGuardField =
  | "documentId"
  | "sessionId"
  | "version"
  | "revision"
  | "selectionKey"
  | "contextRef";

/** A rejected precondition is not evidence that the user changed the document. */
export class AgentGuardError extends SaveConflictError {
  readonly code = "agent-context-mismatch";
  readonly retryable = false;
  readonly requiredAction = "refresh-context-and-review";
  constructor(
    readonly field: AgentGuardField,
    readonly effect: "none" | "unknown" = "none",
  ) {
    super(
      `요청의 대상 문서·편집 세션·버전·revision·선택 상태가 현재 상태와 일치하지 않습니다 (${field}). 현재 상태를 다시 조회하고 대상을 확인해 주세요.`,
    );
    this.name = "AgentGuardError";
  }
}
