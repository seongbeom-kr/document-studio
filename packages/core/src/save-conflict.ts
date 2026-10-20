export class SaveConflictError extends Error {
  constructor(
    message = "원본 문서가 변경됐습니다. 내 초안을 다운로드한 뒤 최신 문서를 다시 열어 주세요.",
  ) {
    super(message);
    this.name = "SaveConflictError";
  }
}
