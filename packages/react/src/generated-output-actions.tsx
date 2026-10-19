import { useId, useState } from "react";
import type {
  EditorController,
  MailMergeStatus,
  GeneratedStoredFile,
} from "@document-studio/core";
import { ModalDialog } from "./modal-dialog";

export function GeneratedOutputActions({
  status,
  controller,
  onError,
  onOpenStoredCopy,
  onCancel,
}: {
  status: MailMergeStatus;
  controller: Pick<
    EditorController,
    | "exportMailMergeArchive"
    | "noteMailMergeDownload"
    | "acknowledgeMailMergeDelivery"
    | "discardMailMergeResults"
    | "cancelMailMerge"
    | "saveMailMergeResults"
  >;
  onError(error: Error): void;
  onOpenStoredCopy?(file: GeneratedStoredFile): Promise<void>;
  /** Host-owned cancellation flow, including its keyboard completion target. */
  onCancel?(operationId: string, trigger: HTMLButtonElement): void;
}) {
  const [discarding, setDiscarding] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const id = useId();
  const perform = (task: () => void) => {
    try {
      task();
    } catch (cause) {
      onError(cause instanceof Error ? cause : new Error(String(cause)));
    }
  };
  const result = status.lastResult;
  const pending = status.pendingOutput;
  if (status.phase === "running")
    return (
      <div role="status">
        문서 생성 {status.completed}/{status.total}
        <button
          type="button"
          className="ds-button"
          onClick={(event) =>
            perform(() =>
              onCancel
                ? onCancel(status.operationId!, event.currentTarget)
                : controller.cancelMailMerge?.(status.operationId!),
            )
          }
        >
          생성 취소
        </button>
      </div>
    );
  if (!result) return null;
  return (
    <section
      className="ds-generated-output"
      aria-label="생성 사본 보관"
      tabIndex={-1}
    >
      <p role="status">
        {status.phase === "ready" ? "새 문서" : "이전 생성 문서"}{" "}
        {result.files.length}개 생성 완료 ·{" "}
        {pending ? "서버 미저장" : "파일 보관 확인됨"}
        {` · 보관 ${result.files.length - (pending?.receipt.files.length ?? 0)}개 · 남음 ${pending?.receipt.files.length ?? 0}개`}
      </p>
      {Boolean(status.storedFiles?.length) && (
        <ul aria-label="저장된 사본">
          {status.storedFiles!.map((file) => (
            <li key={file.id}>
              {onOpenStoredCopy ? (
                <button
                  type="button"
                  className="ds-button"
                  title={file.path}
                  disabled={opening || status.saving || Boolean(pending)}
                  onClick={() => {
                    setOpening(true);
                    void Promise.resolve()
                      .then(() => onOpenStoredCopy({ ...file }))
                      .catch((cause: unknown) =>
                        onError(
                          cause instanceof Error
                            ? cause
                            : new Error(String(cause)),
                        ),
                      )
                      .finally(() => setOpening(false));
                  }}
                >
                  {result.files.find((item) => item.id === file.id)?.fileName ??
                    file.path.split("/").at(-1)}{" "}
                  열기
                </button>
              ) : (
                <span title={file.path}>
                  {result.files.find((item) => item.id === file.id)?.fileName ??
                    file.path}
                </span>
              )}
              {file.warning && <span role="status"> · {file.warning}</span>}
            </li>
          ))}
        </ul>
      )}
      {pending && status.storageLabel && controller.saveMailMergeResults && (
        <button
          type="button"
          className="ds-button ds-primary"
          disabled={status.saving}
          onClick={() => {
            void Promise.resolve()
              .then(() => controller.saveMailMergeResults!(result.operationId))
              // Partial-save details belong to storageError below. Reporting them
              // as a second generic error leaves a stale failure after recovery.
              .catch((cause: unknown) =>
                onError(
                  cause instanceof Error ? cause : new Error(String(cause)),
                ),
              );
          }}
        >
          {status.saving
            ? "사본 저장 중…"
            : `${status.storageLabel}에 ${status.storedFiles?.length ? "남은 사본" : "사본"} 저장`}
        </button>
      )}
      {status.storageError && <p role="alert">{status.storageError}</p>}
      {pending && (
        <>
          <p role="status">
            생성한 문서 {pending.receipt.files.length}개가 아직 보관 확인되지
            않았습니다. 원본 저장과 별개이며, 확인 전에는 닫기와 문서 전환을
            막습니다.
          </p>
          <ul>
            {pending.receipt.files.map((file) => (
              <li key={file.id}>{file.fileName}</li>
            ))}
          </ul>
        </>
      )}
      <button
        type="button"
        className="ds-button"
        onClick={() =>
          perform(() => {
            if (
              !controller.exportMailMergeArchive ||
              !controller.noteMailMergeDownload
            )
              throw new Error("생성 파일 다운로드를 지원하지 않습니다.");
            const bytes = controller.exportMailMergeArchive(result.operationId);
            const url = URL.createObjectURL(
              new Blob([new Uint8Array(bytes)], { type: "application/zip" }),
            );
            try {
              const anchor = document.createElement("a");
              anchor.href = url;
              anchor.download = "일괄생성-결과.zip";
              anchor.click();
              controller.noteMailMergeDownload(result.operationId);
            } finally {
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }
          })
        }
      >
        생성 파일 ZIP 내려받기
      </button>
      {pending?.downloadRequested && (
        <>
          <p>
            다운로드를 요청했습니다. 브라우저는 파일 보관 완료를 자동 확인할 수
            없습니다. 내려받은 파일을 확인한 뒤 아래 버튼을 누르세요.
          </p>
          <button
            type="button"
            className="ds-button"
            disabled={status.saving}
            onClick={() =>
              perform(() => {
                if (!controller.acknowledgeMailMergeDelivery)
                  throw new Error("파일 보관 확인을 지원하지 않습니다.");
                controller.acknowledgeMailMergeDelivery({
                  operationId: pending.receipt.operationId,
                  files: pending.receipt.files.map((file) => ({
                    id: file.id,
                    digest: file.digest,
                    destination: "download-confirmed",
                  })),
                });
              })
            }
          >
            다운로드한 파일 보관 확인
          </button>
        </>
      )}
      {pending && (
        <button
          type="button"
          className="ds-button"
          disabled={status.saving}
          onClick={() => setDiscarding(pending.receipt.operationId)}
        >
          생성 결과 버리기
        </button>
      )}
      {discarding && (
        <ModalDialog labelledBy={id} onCancel={() => setDiscarding(null)}>
          <h3 id={id}>생성 사본을 버릴까요?</h3>
          <p>
            아래 사본의 메모리 결과를 버립니다. 원본 문서와 입력 데이터는
            유지됩니다.
          </p>
          <ul>
            {pending?.receipt.files.map((file) => (
              <li key={file.id}>{file.fileName}</li>
            ))}
          </ul>
          <div className="ds-dialog-actions">
            <button
              type="button"
              className="ds-button"
              onClick={() => setDiscarding(null)}
            >
              계속 보관
            </button>
            <button
              type="button"
              className="ds-button"
              onClick={() =>
                perform(() => {
                  if (
                    !controller.discardMailMergeResults ||
                    pending?.receipt.operationId !== discarding
                  )
                    throw new Error(
                      "생성 결과가 변경됐습니다. 다시 확인해 주세요.",
                    );
                  controller.discardMailMergeResults(discarding);
                  setDiscarding(null);
                })
              }
            >
              확인한 생성 결과 버리기
            </button>
          </div>
        </ModalDialog>
      )}
    </section>
  );
}
