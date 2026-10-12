import { SaveConflictError, type DocumentStorage } from "@document-studio/core";

export interface SandboxHost {
  sessionId: string;
  path: string;
  documentId?: string;
  getEditToken(): string | undefined;
  isBlocked(): boolean;
  refresh(): Promise<{ file: { digest?: string } }>;
  uploadWorkspaceFile(
    sessionId: string,
    file: File,
    onProgress: (progress: number) => void,
    signal: AbortSignal | undefined,
    options: { path: string; expectedDigest: string; editToken: string },
  ): Promise<{
    sha256: string;
    file?: { digest?: string };
    sandboxSyncWarning?: string | null;
  }>;
  onProgress?(progress: number): void;
}
/** This adapter lives in the consumer. Keep the existing BFF upload, lease and complete-edit implementation. */
export function createSandboxStorage(host: SandboxHost): DocumentStorage {
  return {
    async save({ document, bytes, expectedVersion }) {
      if (host.documentId && host.documentId !== document.id)
        throw new SaveConflictError(
          "저장 대상과 편집 문서 ID가 일치하지 않습니다.",
        );
      if (!expectedVersion)
        throw new Error("원본 digest가 없어 저장할 수 없습니다.");
      if (host.isBlocked()) throw new Error("현재 문서를 편집할 수 없습니다.");
      const editToken = host.getEditToken();
      if (!editToken) throw new Error("편집 lease가 없어 저장할 수 없습니다.");
      if (!bytes.byteLength || bytes.byteLength > 32 * 1024 * 1024)
        throw new Error("저장할 문서의 크기가 허용 범위를 벗어났습니다.");
      const current = await host.refresh();
      if (current.file.digest !== expectedVersion)
        throw new SaveConflictError();
      if (host.isBlocked() || host.getEditToken() !== editToken)
        throw new Error(
          "문서 편집권이 변경됐습니다. 편집 상태를 다시 확인해 주세요.",
        );
      try {
        const mediaType =
          document.format === "hwpx"
            ? "application/hwp+zip"
            : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        const file = new File(
          [new Uint8Array(bytes).buffer],
          document.fileName,
          { type: mediaType },
        );
        const result = await host.uploadWorkspaceFile(
          host.sessionId,
          file,
          host.onProgress ?? (() => {}),
          undefined,
          { path: host.path, expectedDigest: expectedVersion, editToken },
        );
        const version =
          result.file?.digest ??
          (/^[a-f\d]{64}$/i.test(result.sha256)
            ? `sha256:${result.sha256}`
            : undefined);
        if (!version)
          throw new Error("저장 결과의 digest를 확인하지 못했습니다.");
        return {
          version,
          ...(result.sandboxSyncWarning
            ? {
                warnings: [
                  {
                    code: "sandbox-sync-pending",
                    message: `파일은 저장됐지만 샌드박스 반영을 확인하지 못했습니다: ${result.sandboxSyncWarning}`,
                  },
                ],
              }
            : {}),
        };
      } catch (cause) {
        if (
          cause &&
          typeof cause === "object" &&
          "code" in cause &&
          cause.code === "UPLOAD_FILE_CHANGED"
        )
          throw new SaveConflictError();
        throw cause;
      }
    },
  };
}
