import {
  paragraphTextOf,
  type OoxmlPart,
  type TreeDocOp,
} from "@docx-editor.dev/core/store";
import type { TextMatch } from "@docx-editor.dev/react";
/** Multi-line span replacement: insert in the matched run before deleting its text. */
export function docxReplacementOps(
  part: OoxmlPart,
  matches: readonly Pick<TextMatch, "blockId" | "start" | "length" | "text">[],
  replacement: string,
): TreeDocOp[] {
  const normalized = replacement.replace(/\r\n?/g, "\n"),
    pieces = normalized.split(/([\n\t])/),
    ops: TreeDocOp[] = [];
  if (matches.length * normalized.length > 1_000_000)
    throw new Error("한 번에 바꿀 텍스트 크기 제한을 넘었습니다.");
  for (const match of [...matches].reverse()) {
    const text = paragraphTextOf(part, match.blockId);
    if (
      text === null ||
      text.slice(match.start, match.start + match.length) !== match.text
    )
      throw new Error("검색 결과의 정확한 텍스트 범위를 다시 확인해 주세요.");
    if (normalized === match.text) continue;
    let offset = match.start;
    for (const piece of pieces) {
      if (!piece) continue;
      if (piece === "\n" || piece === "\t")
        ops.push({
          op: piece === "\n" ? "insertHardBreak" : "insertTab",
          paragraphId: match.blockId,
          offset,
        });
      else
        ops.push({
          op: "insertText",
          paragraphId: match.blockId,
          offset,
          text: piece,
          bias: "right",
        });
      offset += piece.length;
      if (ops.length > 10_000)
        throw new Error("한 번에 바꿀 줄 수 제한을 넘었습니다.");
    }
    ops.push({
      op: "deleteText",
      paragraphId: match.blockId,
      start: offset,
      end: offset + match.length,
    });
  }
  return ops;
}
