# 2026-10-04 리뷰 수정 및 재검증

검토 대상은 `D:\dev\document-studio`입니다. [원본 리뷰](code-review-2026-10-04.txt)의 네 문제는 현재 구현에서 모두 확인됐고, 2026-10-05에 수정과 재검증을 완료했습니다. 기존 단위 44개·E2E 136개에는 이 문서 전환 조건이 빠져 있었습니다.

## 수정 결과

| 리뷰                      | 원인                                           | 수정                                                                                                                          | 회귀 근거                                                                                      |
| ------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| P1 전환 직전 입력 유실    | 다음 자동 초안 저장 전에 편집기 제거           | SDK `flushDraft()` 추가. 명령·자동 저장을 기다리고 최신 내용을 다시 내보내 초안 트랜잭션 완료 후 전환. 실패 시 현재 문서 유지 | 자동 저장 이전 전환·복구, 초안 저장 실패·재시도, SDK 탭 제거, 진행 중인 자동 저장 후 추가 입력 |
| P1 파일 읽기 중 확인 우회 | 비동기 완료 시 이전 렌더의 dirty 참조          | 현재 선택 문서와 실제 엔진의 최신 상태 조회                                                                                   | `File.arrayBuffer()` 1.5초 지연 중 편집, 기존 문서 유지와 확인창, 취소 후 내용 확인            |
| P2 저장 후 원본 재열기    | 목록 bytes는 최초 원본이고 초안만 삭제         | `DocumentSavedEvent`에 저장 bytes·문서 ID·version 전달. 목록과 선택 문서 갱신. 다운로드 저장도 새 로컬 version 생성           | 저장·재열기의 내용·14pt·150% 행간, 이후 초안의 저장 기준 일치                                  |
| P2 동기화 경고 후 충돌    | 서버에 저장됐는데 예외로 처리해 새 digest 유실 | version을 반환하고 `sandbox-sync-pending` 경고를 별도 전달. SDK는 version·저장 완료 반영 후 경고 표시                         | 모의 서버 연속 저장, 브라우저 warning·clean·v2 확인 및 다음 저장 expectedVersion=v2            |

수정한 코드는 [React SDK](../packages/react/src/document-editor.tsx), [저장 계약](../packages/core/src/index.ts), [playground](../apps/playground/src/main.tsx), [샌드박스 저장 연결](../examples/sandbox-agent/storage.ts)에 있습니다. [샌드박스 편집 pane](../examples/sandbox-agent/document-pane.tsx)은 ref를 전달해 소비 앱이 `flushDraft()`를 호출할 수 있도록 했습니다. 앱 안에 넣는 라이브러리 구조를 유지합니다.

## 호스트의 저장·전환 계약

`flushDraft()` 성공 후 편집기를 제거합니다. 실패하면 현재 문서를 유지하고 오류를 표시합니다. 초안 저장소를 끈 호스트는 미저장 문서를 먼저 저장하거나 사용자가 명시적으로 변경사항을 버리게 해야 합니다. `flushDraft()`는 서버 저장을 대신하지 않으며 dirty를 지우지 않습니다. 저장 중에는 전환 준비를 거절하고, 진행 중인 자동 초안 저장이 있으면 완료 후 최신 내용을 다시 저장합니다.

문서 ID는 저장 전후에 유지합니다. `onSaved`의 bytes와 version은 한 저장본에 속하므로 함께 갱신합니다. 저장 버전 변경으로 component key를 바꾸지 않습니다. 다운로드 저장의 `download:` version은 브라우저 내 저장본 토큰이며 서버 digest가 아닙니다. playground 목록은 세션의 메모리에, 미저장 초안은 IndexedDB에 보관합니다.

동기화 경고가 있어도 새 digest를 다음 저장 기준으로 사용합니다. 동기화 재시도는 호스트의 기존 동기화 기능에 연결하고, `storage.save()`로 같은 문서를 자동 재업로드하지 않습니다. 운영 서버의 동기화 endpoint는 새로 정의하지 않았습니다.

## 테스트 기록 정리

원본 `.build/review-tests`와 당시 증거는 유지했습니다. 정식 회귀 테스트는 [document-lifecycle.spec.ts](../tests/e2e/document-lifecycle.spec.ts)와 [sandbox-storage.test.ts](../tests/unit/sandbox-storage.test.ts)에 추가했습니다.

원본 파일 읽기 시험에는 새 문서가 이미 열렸다는 assertion 다음에 확인창을 요구하는 조건이 있습니다. 수정 후 기대는 기존 문서를 유지하며 확인창을 표시하는 것이므로 정식 시험에서 바로잡았습니다. 초안 복구 버튼도 비동기 조회가 끝날 때까지 기다립니다. 같은 버전 원본 교체 후 revision 기준을 확인하는 성공 사례는 DOCX·HWPX 모두 포함했습니다.

원본 `storage-repro.mjs`는 저장 반환값을 사용하지 않고 같은 옛 expectedVersion으로 다시 저장합니다. 수정 후에도 그 요청은 충돌하는 것이 맞습니다. 정식 시험은 첫 저장이 반환한 새 digest를 다음 편집의 expectedVersion으로 사용합니다.

소비 앱 시험에는 실제 저장 callback의 bytes·version을 호스트 props에 반영하는 조건을 추가했습니다. 이 과정에서 Next.js의 빈 `next-route-announcer`가 `role=alert`를 가진다는 점을 확인했습니다. 오류 검사는 SDK 내부로 범위를 지정하고 브라우저의 unhandled error·정적 자산 오류도 별도로 확인합니다.

## 검증 결과

| 명령·검사               | 결과                                                                                                |
| ----------------------- | --------------------------------------------------------------------------------------------------- |
| `yarn typecheck`        | 통과                                                                                                |
| `yarn test`             | 단위 46개 통과                                                                                      |
| `yarn test:e2e`         | Chrome 90개 + Edge 90개, 총 180개 통과. 기존 136개 + 새 회귀 44개                                   |
| `yarn build`            | 네 SDK 패키지 빌드 통과                                                                             |
| `yarn build:playground` | 예제 production build 통과                                                                          |
| `yarn verify:packages`  | SDK tarball의 별도 npm 설치·Next.js production build·Chrome/Edge × DOCX/HWPX 브라우저 4개 조합 통과 |

새 회귀 검사는 양쪽 형식·브라우저에 동일하게 적용합니다. 입력 직후 전환뿐 아니라 초안 저장 장애·재시도, 비활성 저장소, 저장 진행 중 전환, 자동 저장과 새 입력의 겹침, 저장 후 추가 편집, 원본 교체 후 새 편집, 동기화 경고 후 연속 저장을 검사했습니다.

실행 증거는 `.build/e2e-results.json`, `playwright-report/index.html`, `.build/package-verification.json`, `.build/consumer-browser.json`에 있습니다. 실행 자료는 Git에서 제외되고 테스트 소스·문서 기록은 저장소에 남습니다.

## 검증 한계

자체 생성한 fixture 문서를 사용했습니다. 운영 샌드박스의 BFF·lease·동기화는 연결 예제와 모의 호스트까지 검증했습니다. 실제 한컴 한글에서 HWPX를 열거나 물리 Windows IME를 시험하지 않았습니다. 이전 Microsoft Word 독립 읽기는 2026-10-04 기록이며 이번 저장·전환 수정에서는 재실행하지 않았습니다. 실제 업무 문서 전체의 호환성을 보장하는 결과는 아닙니다.
