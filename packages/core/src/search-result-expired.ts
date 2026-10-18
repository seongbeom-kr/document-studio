/** A bounded search-cache miss is recoverable by searching again, not by rereading state. */
export class SearchResultExpiredError extends Error {
  readonly code = "search-result-expired";
  readonly requiredAction = "search-again";
  readonly effect = "none";
  constructor() {
    super(
      "검색 결과가 만료됐습니다. 같은 문구를 다시 검색하고 새 결과를 선택해 주세요.",
    );
    this.name = "SearchResultExpiredError";
  }
}
