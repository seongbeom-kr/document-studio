import { SaveConflictError } from "./save-conflict";

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
