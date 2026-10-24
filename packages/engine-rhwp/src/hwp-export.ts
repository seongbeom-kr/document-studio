import type { RhwpEditor } from "@rhwp/editor";
import { validateHwpDocument } from "@document-studio/core";
export interface ReportedHwpExport {
  bytes: Uint8Array;
  contentLoss: {
    schemaVersion: number;
    outputFormat: string;
    count: number;
    losses: unknown[];
  };
}
/** The enclosing revision snapshot must guard both verification and serialization. */
export async function exportVerifiedHwp(
  editor: Pick<RhwpEditor, "exportHwpVerify">,
  serialize: () => Promise<ReportedHwpExport>,
): Promise<Uint8Array> {
  const result = await editor.exportHwpVerify();
  if (
    !result.recovered ||
    result.pageCountBefore !== result.pageCountAfter ||
    !Number.isSafeInteger(result.bytesLen) ||
    result.bytesLen < 1
  )
    throw new Error(
      "HWP 저장 결과의 재열기·쪽 수 검증에 실패했습니다. 원본은 유지됩니다.",
    );
  const { bytes, contentLoss } = await serialize();
  if (
    !contentLoss ||
    contentLoss.schemaVersion !== 1 ||
    contentLoss.outputFormat !== "hwp" ||
    contentLoss.count !== 0 ||
    !Array.isArray(contentLoss.losses) ||
    contentLoss.losses.length
  )
    throw new Error(
      "HWP 저장 중 내용 손실이 보고됐거나 손실 보고를 확인하지 못했습니다. 원본은 유지됩니다.",
    );
  if (bytes.byteLength !== result.bytesLen)
    throw new Error(
      "HWP 저장 결과가 검증한 문서와 다릅니다. 다시 저장해 주세요.",
    );
  validateHwpDocument(bytes);
  return bytes;
}
