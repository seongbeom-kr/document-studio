# 0.2.2 적대적 리뷰 및 임베드 UI 수정

2026-10-05. 대상은 별도 앱이 아니라 기존 프론트에 넣는 React SDK다. SDK 소스는 `D:\dev\document-studio`, 프론트 검증 작업 트리는 `D:\dev\_worktrees\document-studio-ux-review-fixes`다. 프론트 브랜치 `codex/document-studio-ux-review-fixes`는 최신화한 `origin/dev` `4be7b5ed5`에서 만들었다. 기존 프론트 작업 파일과 실행 중인 편집기는 보존했다.

## 구현 순서와 완료 내용

1. 적대적 리뷰의 5개 항목을 원본·초안·서버 저장 상태의 경계에서 수정하고 각 항목을 DOCX/HWPX × Chrome/Edge 브라우저 시험으로 검증한다.
2. SDK가 소유하던 제목·저장·닫기 헤더를 선택적으로 없애고 호스트에 상태를 전달한다. 샌드박스가 기존 버튼과 저장 상태를 소유한다.
3. 속성 패널의 위치·스크롤·선택 값 동기화·부분 적용을 수정한다. 검색과 주요 고급 기능의 언어를 정리한다.
4. tarball을 독립 Next.js 앱에 설치해 시험하고 동일 bytes를 최신 프론트 브랜치에 설치한다. 프론트 저장·실패·종료 시험과 정적 검사·빌드를 수행한다.
5. 인증된 개발자 프록시에서 실제 BFF·lease·저장·재열기·에이전트 handoff를 검증한다. 이 단계는 아직 실행하지 못했다.

## 적대적 리뷰 대응

| 항목                            | 변경                                                                                                                                                 | 재현 방지 시험                                               |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 대상 B의 초안을 건너뛴 전환     | 초기 로딩과 승인된 전환 모두 `resolveRecovery()`를 거친다. B의 복구 선택 전에 편집기를 마운트하지 않는다. 전환 전 A의 최신 입력도 초안으로 보관한다. | B의 기존 초안 bytes 불변, 복구 내용 확인, A의 최신 입력 보존 |
| `draftStore={false}` 이후 쓰기  | 실행 직전에 현재 설정과 저장소를 확인한다. false이면 명시적 flush는 거절하고 자동 쓰기를 중지한다.                                                   | flush 실패 및 자동 저장 주기 이후 쓰기 수 불변               |
| 손상된 초안으로 원본도 못 엶    | 원본 검증과 초안 검증을 분리한다. 손상 자료 다운로드와 명시적 삭제 후 원본 열기를 제공한다. 삭제 실패 시 복구 선택을 유지한다.                       | 유효 원본 + 손상 초안의 복구 선택·삭제·원본 재열기           |
| 조회 중 저장소 교체의 무한 로딩 | 원본과 초안 준비가 끝난 뒤 입력을 채택한다. 조회는 취소 신호에 즉시 응답하고 새 저장소로 다시 준비한다.                                              | 문서 객체 동일 + 지연 조회 중 저장소 교체                    |
| 직렬화 충돌로 영구 저장 차단    | 저장소 호출에서 발생한 서버 version 충돌만 영구 충돌 상태로 처리한다. 내보내기 revision 오류는 재시도할 수 있다.                                     | 첫 내보내기 실패 뒤 실제 저장 성공                           |

기존 `.build/adversarial-review2-20261005/probes.mjs`와 결과는 리뷰 원본으로 보존했다. 소스 콜백을 추출하는 이전 probe는 refactor 이후 회귀 시험의 합격 기준으로 사용하지 않는다. 실제 컴포넌트와 엔진을 실행하는 `tests/e2e/recovery-review.spec.ts`가 재현 방지 시험이다.

## UI 소유권과 변경

- `appearance="embedded"`는 SDK의 문서 제목·저장·닫기 헤더를 생략한다. 기본 standalone 모드는 개발용 예제와 기존 소비 앱에 유지된다.
- `onStateChange`와 `getState()`의 busy/saving을 호스트 버튼·미저장 표시와 연결한다. 샌드박스 footer에는 현재 편집본 다운로드, 작업 공간 저장, 편집 완료가 있다. 저장 실패 시 화면을 유지한다.
- 제목과 최종 저장본 다운로드는 기존 호스트 헤더의 역할이다. SDK 편집 중에는 헤더의 서버 원본 다운로드를 숨겨 현재 편집본과 혼동하지 않도록 했다. 마지막 서버 저장 시각을 표시한다.
- 편집 진입 시 DOCX/HWPX 문서에 집중하는 큰 화면을 사용한다. 속성 도구는 오른쪽에서 독립 스크롤된다. 720px 이하 컨테이너에서는 문서 위에 겹쳐 열리며 문서 높이를 유지한다.
- 호스트 글꼴과 디자인 시스템 CSS 변수를 상속한다. 프론트 저장·종료 버튼은 기존 shadcn `Button`을 사용한다.
- 문단 값은 현재 선택에 따라 자동 갱신되고 사용자가 바꾼 항목만 적용된다. 선택 변경·서식 변경 후 오래된 입력을 적용하지 않는다. 미확인·혼합 값은 임의 숫자로 채우지 않는다.
- 공통 찾기 버튼과 문서 안 Ctrl+F를 제공한다. 비활성 도구는 원인과 표 셀 선택 안내를 표시한다. 업무 자동화는 별도 탭을 유지한다.
- DOCX의 주요 메뉴·문단·페이지·표에 한국어 번역을 추가했다. HWPX 고급 메뉴에서는 중복 기본 툴바를 제거했다.
- 미저장 종료 선택은 저장하고 이동 / 변경 버리기 / 계속 편집이다. 저장 또는 초안 정리가 실패하면 현재 편집 화면을 유지한다.

## 검증 기록

| 검사                                                  | 결과                                                                   |
| ----------------------------------------------------- | ---------------------------------------------------------------------- |
| SDK 단위 시험                                         | 218개 통과                                                             |
| SDK 전체 Chrome·Edge E2E                              | 336개 통과, 실패·건너뛰기·flaky 0                                      |
| 추가 표 도구 안내·고급 메뉴 언어 검사                 | 4개 통과, 두 형식 × 두 브라우저                                        |
| SDK TypeScript·production build                       | 통과                                                                   |
| 독립 npm 소비 앱                                      | tarball 설치·Next.js 16.3.8 빌드·Chrome/Edge × DOCX/HWPX 4개 시험 통과 |
| SDK 새 디렉터리 immutable 설치                        | 통과, 실행 중 preview 의존성 보존                                      |
| 라이선스 gate                                         | npm 102개·고정 Rust registry crate 393개 통과                          |
| SDK production dependency audit                       | 보고 항목 없음                                                         |
| 프론트 전체 단위/컴포넌트 시험                        | 72개 파일·537개 시험 통과                                              |
| 프론트 Escape 우선순위 추가 검증                      | 기존 확장 hook 시험에 속성 패널 경로를 추가해 재검증 통과              |
| 프론트 typegen·typecheck·ESLint·Next.js 16.2.11 build | 통과                                                                   |
| 프론트 immutable 설치·madge·루트 knip workspace 검사  | 통과; 순환/미사용 보고 항목 없음                                       |
| 변경 파일 Prettier·git diff 공백 검사                 | 통과                                                                   |

원본 결과는 `.build/e2e-results-0.2.2.json`, `.build/embedded-guidance-results.json`, `.build/package-verification.json`, `.build/clean-install.json`에 있다. 프론트 시험 JSON은 해당 작업 트리의 `apps/sandbox-agent/.build/document-studio-0.2.2-tests.json`에 있다. 임베드 모드 1366×768 캡처는 `.build/ui-evidence-0.2.2/{chrome,edge}-{docx,hwpx}-embedded-properties.png`에 보관했다. 이 캡처는 SDK fixture 실행 화면이며 실제 인증된 샌드박스의 화면은 아니다.

SDK 재현 명령:

```powershell
yarn typecheck
yarn test
$env:DOCUMENT_STUDIO_TEST_PORT='4180'
yarn test:e2e
yarn build
yarn verify:packages
yarn verify:clean-install
yarn audit:security
```

프론트 작업 트리의 재현 명령:

```powershell
yarn install --immutable
yarn workspace @apps/sandbox-agent typegen
yarn workspace @apps/sandbox-agent typecheck
yarn workspace @apps/sandbox-agent lint
yarn workspace @apps/sandbox-agent test
yarn workspace @apps/sandbox-agent build
yarn workspace @apps/sandbox-agent madge
yarn exec knip --workspace apps/sandbox-agent --no-exit-code
```

## 남은 검증과 기능 제한

2026-10-06 사용자의 실제 화면 반영 요청에 따라 프론트 수정 브랜치에서 sandbox-agent(10129)와 settings(10001)를 함께 활성화했다. 두 프로세스의 작업 트리, bootstrap·설정 SSE·헬스 체크 200, 새 RHWP 자산 bytes 일치, 생성된 클라이언트 chunk의 0.2.2 임베드 UI를 확인했다. 메인 화면 및 세션·세션 목록·그룹 BFF 요청도 서버 로그에서 200 응답을 확인했다.

기존 개발자 프록시 브라우저 탭 연결은 보안 정책에서 `sblim.dev.gridone.net` 접근을 막는 저장된 사용자 설정 때문에 거절됐다. 별도 브라우저·localhost·인증 헤더 주입으로 우회하지 않았다. 따라서 직접 화면 확인과 실제 편집·저장·재열기·lease·handoff 시험은 남아 있다. SDK fixture 시험과 독립 소비 앱 시험, 서버 로그의 200 응답으로 이 시험을 대체하지 않는다.

HWPX 서식 조회는 현재 커서 문단 기준이며 여러 문단의 혼합 상태 조회는 아직 지원되지 않는다. 일부 DOCX 엔진 고급 대화상자는 원본 영어를 유지한다. 기관 오피스의 전체 기능 동등성이나 실제 업무 문서 전체 호환성을 보장하지 않는다. 물리 Windows IME·한컴 원본 프로그램 재열기·운영 서버 통합은 별도 검증이 필요하다. SDK는 Apache-2.0이며 의존성 고지·SBOM과 고정 버전 라이선스 gate를 포함한다. npm/Git 원격 공개는 수행하지 않았다.
