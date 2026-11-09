import { validateHwpDocument } from "@document-studio/core";
import type { NativeHwpDocumentV3 } from "./native-runtime";
/** Both calls belong to one frozen native document; callers must not mutate between them. */
export function verifiedHwpBytesV3(
  document: Pick<
    NativeHwpDocumentV3,
    "exportHwpVerify" | "exportHwpWithReport"
  >,
): Uint8Array {
  let verified: Record<string, unknown>;
  try {
    verified = JSON.parse(document.exportHwpVerify());
  } catch {
    throw new Error("REPORT_HWP_REOPEN_FAILED");
  }
  if (
    verified.recovered !== true ||
    !Number.isSafeInteger(verified.pageCountBefore) ||
    Number(verified.pageCountBefore) < 1 ||
    verified.pageCountBefore !== verified.pageCountAfter ||
    !Number.isSafeInteger(verified.bytesLen) ||
    Number(verified.bytesLen) < 1
  )
    throw new Error("REPORT_HWP_REOPEN_FAILED");
  const reported = document.exportHwpWithReport();
  try {
    const loss = JSON.parse(reported.contentLoss());
    if (
      loss?.schemaVersion !== 1 ||
      loss.outputFormat !== "hwp" ||
      loss.count !== 0 ||
      !Array.isArray(loss.losses) ||
      loss.losses.length
    )
      throw new Error("REPORT_HWP_CONTENT_LOSS");
    const bytes = reported.takeBytes();
    if (bytes.byteLength !== verified.bytesLen)
      throw new Error("REPORT_HWP_BYTE_LENGTH_MISMATCH");
    validateHwpDocument(bytes);
    return bytes;
  } finally {
    reported.free();
  }
}
