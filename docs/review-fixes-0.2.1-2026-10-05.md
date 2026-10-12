# 0.2.1 리뷰 수정과 프론트 통합 검증

2026-10-05. SDK 소스는 `D:\dev\document-studio`. 공개 npm/GitHub 배포는 수행하지 않았다.

두 리뷰의 10개 항목을 수정했다. SDK의 자체 라이선스는 Apache-2.0이며, 각 패키지와 RHWP 자산에 원본 라이선스·고지·고정 의존성 목록을 포함한다.

| 리뷰 문제                                                       | 수정과 검증                                                                                                                                                                                                |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 잘못된 새 원본과 저장소가 들어오면 이전 문서가 새 대상에 저장됨 | 수락한 ID·형식·원본·초안 scope와 저장 대상을 검사한다. 잘못된 원본은 기존 편집본을 보존하면서 저장을 차단한다. 독립 호스트 브라우저 시험을 정식 회귀 시험으로 편입했다.                                    |
| DOCX 가로 문서 크기가 뒤집힘                                    | docx 생성기의 방향별 크기 교환을 반영했다. 생성 문서와 기존 문서의 가로 크기를 두 브라우저에서 확인했다.                                                                                                   |
| HWPX 조회에서 줄바꿈·탭이 빠짐                                  | 텍스트와 lineBreak/tab/공백 제어를 순서대로 읽는다. 두 형식의 치환·조회·내보낸 XML을 비교했다.                                                                                                             |
| DOCX 강조색 상태가 유효하지 않은 문자열임                       | 명령과 상태가 같은 Word 강조색 RGB 표를 사용한다. `#ffff00` 상태를 확인했다.                                                                                                                               |
| 압축 해제 제한을 선언 크기로 우회함                             | 청크 단위 실제 해제량·CRC·로컬/중앙 헤더·descriptor를 검증한다. 로컬/중앙 크기를 함께 조작한 65 MiB 항목을 거부한다. 브라우저 검증과 HWPX 사전 WASM 파싱은 취소·15초 종료 제한을 가진 Worker에서 수행한다. |
| rhwpEngine 재생성으로 편집기 재마운트                           | 동일 studioUrl의 엔진/View 정의를 재사용한다. 호스트 재렌더링 시 입력을 유지한다.                                                                                                                          |
| 서버 저장 성공 뒤 markSaved 실패가 저장 실패로 반환됨           | 완료 version을 먼저 반영하고 엔진 후처리를 별도 경고로 전달한다. onSaved가 최신 bytes/version을 받는다. 후속 저장은 완료 version을 사용한다.                                                               |
| 연결 예제의 깨끗한 문서 A→B 전환이 충돌 처리됨                  | 다른 ID의 깨끗한 문서 전환과 동일 ID의 원본 교체를 구분한다. 변경 중인 문서는 flushDraft 완료 뒤 전환한다.                                                                                                 |
| 비동기 직렬화의 bytes와 revision이 다를 수 있음                 | 두 엔진이 같은 captureExportSnapshot 경계를 사용한다. 직렬화 전 revision을 고정하고 완료 후 달라지면 내보내기를 거부한다.                                                                                  |
| 저장 결과에 version이 없어도 저장 완료가 됨                     | 어댑터 응답을 런타임 검증한다. version이 없거나 잘못됐으면 미저장 상태와 이전 저장 version을 유지한다.                                                                                                     |

추가로 Next.js에서 Worker URL과 동적 import를 올바르게 처리하도록 수정했다. HWPX 검증용 WASM 바인딩을 자체 호스팅 자산으로 분리해 검증 Worker가 약 13 MB에서 12 KB로 줄었다. 호스트용 readOnly 제어는 서식·본문 입력·명령·저장을 차단하고 내보내기를 허용한다.

## 완료한 검증

- SDK 단위 시험: 8개 파일, 208개 통과.
- SDK E2E: Chrome·Edge 각각 150개, 총 300개 통과. 실패·건너뛰기·flaky 0개.
- 독립 npm 소비 앱: 소스 alias 없이 tarball 설치, Next.js 16.3.8 프로덕션 빌드와 Chrome·Edge × DOCX·HWPX 4개 검증 통과. 최신 패키지의 Worker·자산 로딩, 저장·서식·초안·생성 문서를 포함한다.
- SDK 타입 검사·빌드·새 작업 디렉터리 immutable 설치 통과.
- 라이선스 gate: npm 102개, Rust 고정 의존성 393개 통과. production 의존성 audit 보고 항목 없음.
- 프론트: 72개 파일, 529개 단위/컴포넌트 시험 통과. 타입 검사·ESLint·Next.js 16.2.11 프로덕션 빌드·madge 통과. 루트 설정에서 `knip --workspace apps/sandbox-agent --no-exit-code` 결과 없음. 앱 단독 knip 명령은 기존 workspace 경고를 출력하므로 루트 결과와 구분한다.
- 프론트 immutable 설치 통과. 환경의 Husky 설치 helper는 cmd.exe ENOENT로 건너뛰어졌으며 commit/push는 수행하지 않았다.

전체 SDK E2E의 첫 실행은 테스트의 고정 포트 비교가 새 검증 포트 4180을 외부 요청으로 오인해 4개 실패했다. 기준 origin을 Playwright baseURL에서 읽도록 고치고 전체 300개를 다시 실행해 통과했다. 기존 4173 프로세스의 캐시 영향을 피하려고 새 검증 서버를 사용했다.

## 실제 프론트에 적용한 상태

- 최신 origin/dev 기준 커밋: `4be7b5ed5`. 종료 전 fetch로 원격과 기준 HEAD의 차이가 0임을 재확인했다.
- 브랜치: `codex/document-studio-sandbox-integration`.
- 작업 디렉터리: `D:\dev\_worktrees\document-studio-sandbox-integration`.
- 원래 `D:\dev\front\automation-platform`의 수정 파일은 그대로 보존했다.
- 실제 파일 편집 경로의 DOCX·HWPX를 공통 SDK로 연결했다. 기존 BFF, complete-edit의 expectedDigest와 editToken, 편집 lease, 이전 버전 복원 흐름을 사용한다.
- 로그인 사용자·세션·파일별 복구 초안을 구분한다. 편집권 변경·원본 충돌은 읽기 전용으로 처리하고 서버 저장 어댑터에서도 검증한다. 원본 조회 중 편집권이 바뀌면 업로드를 시작하지 않는다.
- 저장 완료 시 호스트의 bytes/version을 갱신한다. 샌드박스 반영 경고가 있으면 저장 version을 유지하고 문서 재업로드 대신 recover 동작을 제공한다. 이 상태에서는 에이전트 요청으로 편집권을 넘기지 않는다.
- 저장 어댑터를 대상 문서 ID에 묶고, 이전 문서의 지연된 저장 완료 콜백이 현재 문서를 갱신하지 못하게 한다. 같은 digest를 가진 다른 파일로 바뀌는 경우도 검사한다.
- 네 패키지는 앱의 vendor에 tarball과 라이선스 고지를 포함해 설치한다. 미공개 패키지의 전이 의존성을 해석하기 위한 root resolutions와 yarn.lock을 갱신했다. 공용 packages 및 my-workspace 소스는 수정하지 않았다.
- dev 서버: `10.30.1.186:10129`, scope `sblim`. bootstrap·SSE 연결과 `http://127.0.0.1:10129/sandbox-agent/api/health` 200을 확인했다. 이는 기동 확인이며 인증된 사용자 흐름의 합격 증거가 아니다.

## 아직 완료하지 못한 마지막 단계

실제 로그인 Chrome 세션으로 `https://sblim.dev.gridone.net/sandbox-agent`에 접근하려고 했으나 브라우저 자동 승인 검토가 **사용자 권한 거부** 사유로 차단했다. 다른 origin·localhost·헤더 주입·쿠키 추출로 이 차단을 우회하지 않았다.

접근이 허용되면 이 브랜치에서 별도 시험용 세션과 문서로 다음을 수행한다.

1. DOCX·HWPX 열기, 한글 입력, 글자 크기·행간·문단·표·그림 편집.
2. 저장 직후 미리보기·재열기·서버 다운로드의 내용과 digest 비교, 두 번째 저장 확인.
3. 다른 문서/세션 전환, 초안 복구, 화면 크기 변경, 같은 문서 최신 원본 교체.
4. 저장 실패·원본 변경·편집권 상실·샌드박스 반영 재시도의 표시와 입력 보존.
5. 문서 저장·편집 종료 후 에이전트 요청을 실행하고, 에이전트가 실제 저장된 내용을 읽는지 확인.

실제 backend·lease·샌드박스 동기화 acceptance는 아직 미완료다. 이번 수정에 대한 물리 Windows IME 및 실제 한컴 프로그램 재열기 검사는 수행하지 않았다. 합성 fixture와 기존 지원 범위의 결과이며 모든 업무 문서의 호환성을 보장하지 않는다. 대화형 엔진의 렌더링은 기존 브라우저 실행 경로에서 수행하므로 검증 Worker를 운영체제 프로세스 격리로 표현하지 않는다.

## 로컬 증거

- `.build/e2e-results.json`, `.build/consumer-browser.json`, `.build/package-verification.json`, `.build/clean-install.json`, `.build/licenses/sbom.json`.
- `tests/unit/review-boundaries.test.ts`, `tests/unit/sandbox-storage.test.ts`, `tests/e2e/review-regressions.spec.ts`, `tests/e2e/format-review-regressions.spec.ts`.
- 프론트 `document-studio-panel.test.tsx`, `document-studio-storage.test.ts`, 기존 document-edit-session/file-preview/workspace-shell 시험.

  0.2.0 리뷰와 native Word 검증 문서는 과거 기록으로 유지한다. 과거 네이티브 결과를 0.2.1의 신규 네이티브 시험으로 간주하지 않는다.
