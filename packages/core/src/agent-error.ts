import { AgentGuardError } from "./agent-guard";
import { AgentToolArgumentError } from "./agent-tools";
import {
  TableReadError,
  TableVerificationError,
  TableEditError,
} from "./table-column";
import { QuickActionError, QuickActionInputError } from "./quick-actions";
import { MailMergeError } from "./mail-merge";
import { SearchResultExpiredError } from "./search-result-expired";
import { SelectionConflictError } from "./selection-conflict";

/** Safe, JSON-serializable transport failure; excludes stacks, causes and host internals. */
export function agentToolFailure(error: unknown) {
  if (
    error instanceof SearchResultExpiredError ||
    error instanceof QuickActionInputError
  )
    return {
      code: error.code,
      message: error.message,
      effect: error.effect,
      retryable: false,
      requiredAction: error.requiredAction,
    };
  if (error instanceof SelectionConflictError)
    return {
      code: error.code,
      message: error.message,
      effect: error.effect,
      retryable: false,
      requiredAction:
        error.effect === "none"
          ? "confirm-selection"
          : "inspect-result-or-undo",
    };
  if (error instanceof AgentGuardError)
    return {
      code: error.code,
      message: error.message,
      effect: error.effect,
      retryable: error.retryable,
      requiredAction: error.requiredAction,
      field: error.field,
    };
  if (error instanceof AgentToolArgumentError)
    return {
      code: error.code,
      message: error.message,
      effect: error.effect,
      retryable: false,
      requiredAction: error.requiredAction,
      method: error.method,
      argumentSchema: structuredClone(error.argumentSchema),
    };
  if (error instanceof TableReadError)
    return {
      code: error.code,
      message: error.message,
      effect: error.effect,
      retryable: error.retryable,
      requiredAction: error.requiredAction,
    };
  if (error instanceof TableVerificationError)
    return {
      code: error.code,
      message: error.message,
      effect: error.effect,
      retryable: error.retryable,
      requiredAction: error.requiredAction,
      verification: structuredClone(error.verification),
    };
  if (
    error instanceof TableEditError ||
    error instanceof QuickActionError ||
    error instanceof MailMergeError
  )
    return {
      code: "document-operation-failed",
      message: error.message,
      effect: error.effect,
      retryable: false,
      requiredAction:
        error.effect === "none"
          ? "review-input-and-preview"
          : "inspect-result-or-undo",
    };
  return {
    code: "document-operation-unknown",
    message:
      "작업 결과를 확인하지 못했습니다. 현재 문서와 저장 결과를 확인해 주세요.",
    effect: "unknown" as const,
    retryable: false,
    requiredAction: "inspect-document-and-storage",
  };
}
