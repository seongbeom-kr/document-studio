import {
  SaveConflictError,
  type DocumentFormat,
  type ExportSnapshot,
} from "./index";

/** The version belongs to the serialized bytes, even when the engine serializes asynchronously. */
export async function captureExportSnapshot(
  format: DocumentFormat,
  getRevision: () => string,
  serialize: () => Promise<Uint8Array>,
  refresh: () => void | Promise<void>,
): Promise<ExportSnapshot> {
  const revision = getRevision();
  const bytes = new Uint8Array(await serialize());
  await refresh();
  if (getRevision() !== revision)
    throw new SaveConflictError(
      "문서를 내보내는 동안 revision이 변경됐습니다. 다시 내보내 주세요.",
    );
  return { bytes, revision, format };
}
