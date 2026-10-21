export class SelectionConflictError extends Error {
  readonly code = "selection-conflict";
  readonly retryable = true;
  constructor(readonly effect: "none" | "unknown" = "unknown") {
    super("선택 범위가 변경됐습니다. 적용 대상을 다시 확인해 주세요.");
    this.name = "SelectionConflictError";
  }
}
