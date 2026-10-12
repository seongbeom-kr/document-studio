import type {
  DocumentDraft,
  DraftStore,
  EditorDocument,
} from "@document-studio/core";

export type RecoveryResolution =
  | { kind: "source"; warning?: string }
  | { kind: "draft"; draft: DocumentDraft }
  | { kind: "corrupt"; draft: DocumentDraft; warning: string };

export class RecoveryUnavailableError extends Error {
  constructor(cause: unknown) {
    super(
      `초안 저장소를 읽지 못했습니다: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
    this.name = "RecoveryUnavailableError";
  }
}

/** Read before mounting an editable source: otherwise autosave can overwrite an unseen recovery draft. */
export async function resolveRecovery(
  source: EditorDocument,
  store: DraftStore | null,
  key: string,
  validate: (document: EditorDocument, signal: AbortSignal) => Promise<void>,
  signal: AbortSignal,
): Promise<RecoveryResolution> {
  signal.throwIfAborted();
  if (!store) return { kind: "source" };
  let draft: DocumentDraft | undefined;
  try {
    draft = await new Promise<DocumentDraft | undefined>((resolve, reject) => {
      const abort = () =>
        reject(
          signal.reason ??
            new DOMException("초안 조회가 취소됐습니다.", "AbortError"),
        );
      signal.addEventListener("abort", abort, { once: true });
      Promise.resolve()
        .then(() => {
          signal.throwIfAborted();
          return store.get(key);
        })
        .then(
          (value) => {
            signal.removeEventListener("abort", abort);
            resolve(value);
          },
          (error) => {
            signal.removeEventListener("abort", abort);
            reject(error);
          },
        );
    });
  } catch (cause) {
    signal.throwIfAborted();
    // A failed read is not evidence that the key is empty. Never authorize writes to it.
    throw new RecoveryUnavailableError(cause);
  }
  signal.throwIfAborted();
  if (!draft) return { kind: "source" };
  try {
    if (draft.key !== key || draft.format !== source.format)
      throw new Error("초안의 문서 형식 또는 저장 키가 일치하지 않습니다.");
    await validate({ ...source, bytes: draft.bytes }, signal);
    signal.throwIfAborted();
    return { kind: "draft", draft };
  } catch (cause) {
    signal.throwIfAborted();
    return {
      kind: "corrupt",
      draft,
      warning: `복구 초안이 손상됐습니다: ${cause instanceof Error ? cause.message : String(cause)}`,
    };
  }
}
