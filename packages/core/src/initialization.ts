export type EngineInitializationPhase = "validating" | "connecting" | "opening";
export class EngineInitializationError extends Error {
  readonly retryable = true;
  constructor(
    message: string,
    readonly code:
      | "engine-initialization-timeout"
      | "engine-initialization-failed" = "engine-initialization-failed",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "EngineInitializationError";
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
      };
    };
