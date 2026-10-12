# 최신 범정부 오피스 참고 기능과 SDK 대응

[2026-08-04 공식 공개 게시물](https://sotong.go.kr/front/board/boardContentsView.do?board_id=240&contents_id=7bf5da6228d146fcade014ede52bb129&menu_id=606)의 1,310일판을 최신 참고로 사용했습니다. 같은 게시물의 [공식 1,100일판 가이드북](https://sotong.go.kr/commonfile/fileidDownLoad.do?file_id=d05400b70c8a4be5be392788a5c6b565) 91쪽을 읽고 기능군을 분류했습니다. 가이드북은 2025-11-28 작성 파일이며 실행판과 일자가 다릅니다. 목차/본문의 기능군 비교 결과로, 영상 전용 메뉴·1,000여 개 개별 단축키 전부의 일치표는 아닙니다.

프로그램·기관 서식·실행 파일의 공개 소스 라이선스는 확인하지 못했습니다. 파일·코드·로고·기관 양식을 복사하거나 배포하지 않고 아래 기능을 자체 코드로 구현했습니다. 가이드북은 ignored `.cache/references`의 읽기 자료이며 배포물에 넣지 않습니다. 공식 프로그램의 KISA 점검은 이 SDK의 인증이 아닙니다.

| 가이드 기능군                                            | 0.2.0 구현                                                       | 적용 범위·남은 차이                                           |
| -------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------- |
| 제목·본문·참고·문단·보고서 스타일                        | 공통 문단 도구, title/body/note/table preset, host custom preset | 기관별 공식 양식 아님. 텍스트박스·도형은 native 도구 범위     |
| 글자 크기·행간·여백·번호·글머리표                        | 46개 명령의 형식별 연결, pt/mm/배수 계약                         | native 미지원 명령 거절                                       |
| 금액 한글화                                              | BigInt 금액/한글 금액                                            | 최대 24자리 정수, 자체 표기 규칙                              |
| 날짜·나이·다음주/다음달                                  | 엄격한 달력·윤년·UTC 계산                                        | 생일 전후 만 나이 계산. 법률 판단 기능 아님                   |
| 순번·쉼표·셀 앞뒤·다중 치환                              | 셀 데이터 변환·revision 기반 전체 치환                           | TSV/CSV와 본문/표. 깊은 중첩·객체 범위 제한                   |
| 산출근거·비율·합계·역합계                                | 유리수 사칙연산, 비율·역합계                                     | 만원/원/명/개월 등 명시 단위, eval/매크로 없음                |
| 취합·표 정리·직제순                                      | 원본을 바꾸지 않는 행 취합·정렬·TSV/CSV 변환                     | 실제 XLSX 수식/스타일 병합·Excel 앱 조작 미지원               |
| AI 답변/초안·마크다운 변환                               | report prompt, 제목·목록·표·코드 문단 → DOCX/HWPX                | LLM은 host 담당. Markdown 전체 문법·inline 스타일 보존 미지원 |
| 회의명패·명찰·참석자 명단                                | 이름/소속/직위 문서, 큰 명단 표 분할                             | 접는 명패·절취선·기관별 인쇄 규격 미지원                      |
| 표/사진·표 서식                                          | 표 생성·셀·행열·그림 공통 도구                                   | 모든 native 사진 배치 유형을 검증한 것은 아님                 |
| 차트·조직도·시각 자료                                    | bar/line/pie, 조직 연결 SVG를 로컬 PNG로 삽입, 조직 경로 표      | 데이터 편집 가능한 Office chart 객체는 아님. 항목/노드 제한   |
| 추첨·조 편성                                             | 기본 CSPRNG, 중복 없는 추첨·균등 조 편성                         | 재현용 난수 함수는 host 시험에서 제공 가능                    |
| PDF 글자 읽기·일괄 파일 축소·Windows 작업·자리 배치 지도 | 미구현                                                           | 별도 읽기/변환 어댑터·레이아웃 개발 필요                      |

에이전트는 `createAgentBridge()`로 상태와 명령의 `valueSchema`, 지원·활성화 상태를 조회합니다. 쓰기에는 현재 documentId·expectedSessionId·expectedRevision이 필요합니다. 행간 1.6은 160%, 크기는 pt, 문단·용지·그림은 mm입니다. 엔진 내부 단위를 에이전트가 다시 계산하지 않습니다.

```ts
const agent = createAgentBridge(() => editorRef.current);
const state = agent.getState();
const found = await agent.search({
  documentId: state.documentId,
  query: "검토 내용",
});
await agent.replace({
  documentId: state.documentId,
  expectedRevision: found.revision,
  expectedSessionId: found.sessionId,
  matchId: found.matches[0].id,
  replacement: "확정 내용",
});
```

선택 대상이 바뀌면 다시 검색합니다. HWPX 상태는 캐럿 기준이며 혼합 서식을 정확히 집계했다고 가정하지 않습니다. DOCX·HWPX 전체 치환은 한 번의 Undo/Redo로 복구합니다. 순차 preset은 여러 native undo 단계일 수 있습니다. LLM/MCP transport·인증·자동 저장 정책은 호스트가 연결합니다.
