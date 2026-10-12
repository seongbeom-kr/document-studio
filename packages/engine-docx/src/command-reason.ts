export function koreanCommandReason(
  reason: string | undefined,
): string | undefined {
  if (!reason) return reason;
  const messages: Record<string, string> = {
    "nothing to undo": "되돌릴 변경사항이 없습니다.",
    "nothing to redo": "다시 적용할 변경사항이 없습니다.",
    "the selection is not inside a table":
      "표 안의 셀을 선택하면 사용할 수 있습니다.",
    "no document is loaded": "문서를 연 뒤 다시 시도해 주세요.",
    "the editor is read-only": "읽기 전용 문서입니다.",
  };
  return messages[reason.toLowerCase()] ?? reason;
}
