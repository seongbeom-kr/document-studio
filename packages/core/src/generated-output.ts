import type { MailMergeReceipt } from "./mail-merge";
import type { EditorDocument } from "./index";

export interface GeneratedStoredFile {
  id: string;
  digest: string;
  version: string;
  path: string;
  warning?: string;
}
/** Host-owned storage. Repeated operationId/file.id/digest must never create duplicate files. */
export interface GeneratedOutputStorage {
  id: string;
  label: string;
  timeoutMs?: number;
  save(input: {
    operationId: string;
    documentId: string;
    sessionId: string;
    file: EditorDocument;
    digest: string;
    signal: AbortSignal;
  }): Promise<GeneratedStoredFile>;
}
export interface GeneratedOutputSaveResult {
  operationId: string;
  complete: boolean;
  remaining: number;
  stored: readonly GeneratedStoredFile[];
  error?: string;
}

export interface GeneratedOutputPending {
  receipt: MailMergeReceipt;
  downloadRequested: boolean;
}
export type GeneratedFileDelivery = {
  id: string;
  digest: string;
} & (
  | { destination: "download-confirmed" }
  | { destination: "storage"; version: string }
);

/** Reading bytes or requesting a browser download is not evidence of durable delivery. */
export class GeneratedOutputPendingError extends Error {
  readonly effect = "none";
  constructor(
    readonly output?: GeneratedOutputPending,
    readonly generating = false,
  ) {
    super(
      generating
        ? "문서 생성이 진행 중입니다. 완료하거나 취소한 뒤 계속해 주세요."
        : `생성한 문서 ${output?.receipt.files.length ?? 0}개가 아직 보관되지 않았습니다. 파일 보관을 확인하거나 결과를 명시적으로 버려 주세요.`,
    );
    this.name = "GeneratedOutputPendingError";
  }
}

export class GeneratedOutputLedger {
  private receipt?: MailMergeReceipt;
  private delivered = new Map<string, GeneratedFileDelivery>();
  private requested = false;

  pending(): GeneratedOutputPending | undefined {
    if (!this.receipt) return;
    const files = this.receipt.files.filter(
      (file) => !this.delivered.has(file.id),
    );
    if (!files.length) return;
    return {
      receipt: structuredClone({ ...this.receipt, files }),
      downloadRequested: this.requested,
    };
  }
  assertSettled() {
    const pending = this.pending();
    if (pending) throw new GeneratedOutputPendingError(pending);
  }
  retain(receipt: MailMergeReceipt) {
    this.assertSettled();
    this.receipt = structuredClone(receipt);
    this.delivered.clear();
    this.requested = false;
  }
  reset() {
    this.assertSettled();
    this.receipt = undefined;
    this.delivered.clear();
    this.requested = false;
  }
  private check(operationId: string) {
    if (!this.receipt || this.receipt.operationId !== operationId)
      throw new Error("현재 보관 중인 생성 결과와 작업 ID가 다릅니다.");
    return this.receipt;
  }
  noteDownload(operationId: string) {
    this.check(operationId);
    this.requested = true;
  }
  acknowledge(operationId: string, files: readonly GeneratedFileDelivery[]) {
    const receipt = this.check(operationId);
    if (
      !Array.isArray(files) ||
      !files.length ||
      files.length > receipt.files.length ||
      new Set(files.map((f) => f?.id)).size !== files.length
    )
      throw new Error("파일별 보관 영수증을 확인해 주세요.");
    const confirmed = structuredClone(files);
    for (const item of confirmed) {
      const file = receipt.files.find((f) => f.id === item?.id);
      if (
        !file ||
        item.digest !== file.digest ||
        !["download-confirmed", "storage"].includes(item.destination) ||
        (item.destination === "download-confirmed" && !this.requested) ||
        (item.destination === "storage" &&
          (typeof item.version !== "string" ||
            !item.version.trim() ||
            item.version.length > 1024))
      )
        throw new Error(
          "생성 파일의 ID·digest·보관 확인 정보가 올바르지 않습니다.",
        );
    }
    for (const item of confirmed) this.delivered.set(item.id, item);
  }
  discard(operationId: string) {
    this.check(operationId);
    this.receipt = undefined;
    this.delivered.clear();
    this.requested = false;
  }
}
