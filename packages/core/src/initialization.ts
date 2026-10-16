export type EngineInitializationPhase = "validating" | "connecting" | "opening";
export type EngineInitializationStage =
  | "iframe-loading"
  | "transport-connecting"
  | "engine-starting"
  | "controls-connecting"
  | "document-opening"
  | "state-connecting";
export interface EngineInitializationDiagnostics {
  stage: EngineInitializationStage;
  elapsedMs: number;
  transport?: "message-port" | "legacy";
  steps: { stage: EngineInitializationStage; elapsedMs: number }[];
}
export const INITIALIZATION_STAGE_LABELS: Record<
  EngineInitializationStage,
  string
> = {
  "iframe-loading": "편집 화면 파일 로드",
  "transport-connecting": "편집 화면 통신 연결",
  "engine-starting": "문서 엔진 준비",
  "controls-connecting": "편집 도구 연결",
  "document-opening": "문서 파일 열기",
  "state-connecting": "편집 상태 연결",
};
export class EngineInitializationError extends Error {
  readonly retryable = true;
  readonly diagnostics?: EngineInitializationDiagnostics;
  constructor(
    message: string,
    readonly code:
      | "engine-initialization-timeout"
      | "engine-initialization-failed" = "engine-initialization-failed",
    options?: ErrorOptions & { diagnostics?: EngineInitializationDiagnostics },
  ) {
    super(message, options);
    this.name = "EngineInitializationError";
    this.diagnostics = options?.diagnostics
      ? structuredClone(options.diagnostics)
      : undefined;
  }
}
export type EngineInitializationState =
  | { status: "loading"; phase: EngineInitializationPhase }
  | { status: "ready" }
  | {
      status: "failed";
      error: {
        code: EngineInitializationError["code"];
        message: string;
        retryable: boolean;
        diagnostics?: EngineInitializationDiagnostics;
      };
    };
