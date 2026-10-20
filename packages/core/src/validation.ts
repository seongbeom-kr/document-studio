import { validateDocumentArchive, ARCHIVE_LIMITS } from "./archive";
import type { EditorDocument } from "./index";
export function runValidationWorker(
  worker: Worker,
  input: Record<string, unknown> & { bytes: Uint8Array },
  signal?: AbortSignal,
): Promise<void> {
  if (
    !(input.bytes instanceof Uint8Array) ||
    input.bytes.length > ARCHIVE_LIMITS.compressedBytes
  ) {
    worker.terminate();
    return Promise.reject(
      new Error("검증할 문서의 압축 크기가 허용 범위를 벗어났습니다."),
    );
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    let terminated = false;
    let completion: ReturnType<typeof setTimeout> | undefined;
    const stopWorker = () => {
      if (terminated) return;
      terminated = true;
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
    };
    const settle = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(completion);
      signal?.removeEventListener("abort", abort);
      stopWorker();
      error ? reject(error) : resolve();
    };
    const finish = (error?: Error) => {
      if (settled || terminated) return;
      stopWorker();
      clearTimeout(timer);
      if (error) {
        settle(error);
        return;
      }
      // Do not navigate a new editor frame in the worker's completion microtask.
      // Give the browser a task boundary to retire its terminated worker target.
      // Cancellation remains effective throughout this handoff.
      completion = setTimeout(() => settle(), 0);
    };
    const abort = () =>
      settle(new DOMException("문서 검증이 취소됐습니다.", "AbortError"));
    const timer = setTimeout(
      () => finish(new Error("문서 검증 시간이 초과됐습니다.")),
      15000,
    );
    worker.onmessage = ({ data }) =>
      finish(
        data?.ok === true
          ? undefined
          : new Error(data?.error ?? "문서를 검증하지 못했습니다."),
      );
    worker.onerror = () =>
      finish(new Error("문서 검증 Worker를 실행하지 못했습니다."));
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) {
      abort();
      return;
    }
    try {
      const bytes = new Uint8Array(input.bytes);
      worker.postMessage({ ...input, bytes }, [bytes.buffer]);
    } catch (error) {
      finish(
        error instanceof Error
          ? error
          : new Error("문서 검증을 시작하지 못했습니다."),
      );
    }
  });
}
export async function validateDocumentAsync(
  document: EditorDocument,
  signal?: AbortSignal,
): Promise<void> {
  if (typeof Worker === "undefined") {
    if (typeof window !== "undefined")
      throw new Error("이 환경은 안전한 문서 검증 Worker를 지원하지 않습니다.");
    validateDocumentArchive(document.bytes, document.format);
    return;
  }
  return runValidationWorker(
    new Worker(new URL("./validation-worker.ts", import.meta.url), {
      type: "module",
    }),
    { bytes: document.bytes, format: document.format },
    signal,
  );
}
