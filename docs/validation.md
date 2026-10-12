# 첫 구현 검증 기록

0.1.0의 기존 검증 기록을 보존한 문서입니다. 0.2.0 새 기능과 최종 결과는 [확장 검증 기록](practical-validation.md)을 확인합니다.

라이브러리 중심 구성으로 정리하고 2026-10-04 리뷰의 네 문제를 수정한 뒤 타입 검사·단위 46개·Chrome/Edge E2E 180개·SDK build를 실행했습니다. 수정 내용과 테스트 조건은 [리뷰 수정 기록](review-resolution-2026-10-05.md)에 있습니다. 기본 build는 네 라이브러리만 만들며 playground build는 별도 명령입니다. HWPX 런타임 생성 위치도 `.build/rhwp-studio`로 분리했습니다. `examples/sandbox-agent/document-pane.tsx`는 기존 앱의 파일 탭에 넣는 타입 검사된 연결 예제입니다.

2026년 10월 4~5일 Windows 로컬 환경에서 실행한 기록입니다. 대상은 HWPX·DOCX 첫 구현과 합성 fixture corpus입니다. 기존 운영 샌드박스 앱을 교체하거나 공개 npm 패키지를 설치한 결과는 아닙니다. Microsoft Word 독립 읽기와 immutable install은 10월 4일 결과이며 이번 리뷰 수정에서는 재실행하지 않았습니다.

## 실행 환경

| 항목                      | 버전·조건                                                       |
| ------------------------- | --------------------------------------------------------------- |
| Node / Yarn               | 24.15.0 / 4.14.1, immutable install 통과                        |
| Chrome / Edge             | 153.0.8010.54 / 154.0.4258.53                                   |
| React / TypeScript / Vite | 19.3.0 / 5.9.3 / 8.3.2                                          |
| Playwright / Vitest       | 1.63.0 / 5.0.3                                                  |
| RHWP core·editor          | 0.8.6, Studio commit `e8800c8def63449808a4092798442652ed460552` |
| EigenPal core·React       | 2.25.0, 무료 패키지 사용                                        |
| 패키지 소비 앱            | Next.js 16.2.6, npm으로 로컬 tarball 설치, 소스 alias 없음      |
| 독립 읽기                 | Microsoft Word 16.0, 읽기 전용 COM 검사                         |

## 결과

| 검사             | 결과                           | 확인 범위                                                                                               |
| ---------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------- |
| TypeScript       | 통과                           | SDK·개발용 playground·테스트와 호스트 저장 연결 타입                                                    |
| 단위 테스트      | 46개 통과                      | 입력 범위, revision 저장 표시, 초안 키, 상태 구독, agent 대상 문서 보호, 샌드박스 저장·동기화 경고 계약 |
| 브라우저 E2E     | 180개 통과 (브라우저마다 90개) | Chrome·Edge의 동일 기능 corpus와 문서 전환·저장 회귀 44개                                               |
| Production build | 통과                           | 네 SDK 패키지의 ESM·types·CSS·RHWP 자산과 개발용 playground                                             |
| 패키지 소비      | 통과                           | Yarn pack → 별도 npm 앱 설치 → Next production build                                                    |
| 소비 앱 브라우저 | 4개 조합 통과                  | Chrome·Edge × HWPX·DOCX, 실제 UI 편집·다운로드와 XML 검사                                               |
| Microsoft Word   | 통과                           | 내보낸 rich DOCX의 본문·머리말·꼬리말, 표 1개·그림 1개, 14pt·150% 행간                                  |

소비 앱은 parent workspace를 추론하지 않도록 Turbopack root를 자신의 디렉터리로 지정합니다. 설치할 tarball 경로에 SHA-256 일부를 넣어 동일 버전의 옛 설치 캐시가 검증 결과를 가리지 않게 했습니다. `workspace:` 의존성이 설치된 manifest에 남지 않는지와 LICENSE 포함 여부도 확인합니다.

## 브라우저 검사 내용

각 형식에 같은 시험을 적용했습니다. 별도 원본으로 생성한 blank·sample·rich 문서, 한글·영문·이모지·기호 입력, 키보드 Enter·Tab, 브라우저 IME 조합 프로토콜, 편집 후 저장·재열기를 포함합니다.

서식 검사는 공통 툴바와 agent 명령을 사용합니다. 글꼴 선택, 글자 크기, 기울임, 행간, undo·redo, 확대와 단축키를 확인하며, 내보낸 DOCX XML의 `w:sz=28`·`w:line=360`과 HWPX header의 `height=1400`·`value=150`을 검사합니다. 이는 각각 14pt·150%입니다. 실제 UI의 글자 크기 입력도 검사하므로 API 호출만으로 기능을 판정하지 않습니다.

파일 보존 시험은 여러 페이지가 있는 rich 문서에 행간 변경을 적용한 뒤 본문 텍스트 전체를 비교하고, 표 존재와 그림 파일 bytes를 확인합니다. DOCX 머리말·꼬리말의 문구도 확인합니다. 저장 후 같은 엔진으로 다시 여는 검증과 Microsoft Word의 독립 읽기는 별도 근거입니다.

저장·복구에는 다음 조건을 시험했습니다.

- 호스트 저장 실패 후 미저장 상태 유지와 같은 원본 버전으로 재시도.
- 충돌 후 저장 버튼 차단, 초안 다운로드 유지와 미저장 상태 보존.
- IndexedDB 초안 저장과 새로고침 뒤 복구, 복구본 저장 후 정상 상태.
- 초안 저장 실패 주입 시 오류 표시와 내보내기 가능 상태 유지.
- 연속 저장 때 갱신된 원본 버전 전달, 중복 저장 차단, 저장 중 agent 편집 차단.
- 저장 성공 뒤 파일 목록 갱신 callback 실패를 별도 경고로 표시.
- 외부의 새 원본과 version 변경 없는 bytes 교체 시 현재 초안 보호.
- 상태 조회 주기 전에 들어온 원본 교체와 깨끗한 snapshot의 교체도 명시적 재열기로 처리.
- 현재 문서 탭을 다시 클릭한 뒤 다른 파일을 열어도 미저장 보호 유지.
- 자신의 저장 완료 버전을 props로 다시 받아도 이후 새 편집 유지.
- 종료 취소, Ctrl+S, 숫자 입력 확정 뒤 저장과 Enter 키의 문서 전파 방지.
- 자동 저장 이전 문서 전환, 파일 읽기 중 편집 시 확인, 저장 후 재열기의 내용·서식·저장 기준 보존.
- 명시적인 초안 저장 후 탭 제거, 실패 시 현재 문서 유지, 저장소 비활성·저장 중 전환 거절.
- 진행 중인 자동 초안 저장과 최신 입력의 겹침, 동기화 경고 이후 새 저장 버전 사용.

환경 검사는 두 엔진의 같은 화면 동시 사용, 명령·내용·Ctrl+S 격리, 미지원 확장자·깨진 ZIP header·문서 구조가 없는 ZIP의 오류, 390px 화면의 가로 넘침을 포함합니다. 정상 문서 시험에서 page error가 없는지와 외부 문서 처리·웹 폰트 서버 요청이 없는지도 확인합니다. RHWP 정적 자산의 HTTP 오류는 production 소비 앱에서 별도로 확인합니다.

에이전트의 대상 문서 ID가 바뀐 상태에서 revision이 같은 요청도 거절하는 조건은 단위 테스트로 검증합니다. 실제 엔진 명령 실행과 변경된 receipt는 두 형식의 브라우저 테스트로 확인합니다. 명령 목록은 단위·허용 범위·지원·활성화 상태를 제공합니다. HWPX 실제 변경 이벤트는 revision·서식·미저장 상태를 함께 전달하며, 늦게 도착한 이전 조회 응답은 적용하지 않습니다. 키보드 굵게 변경 뒤 처음 관찰한 새 revision의 서식 상태와 후속 agent 실행을 회귀 테스트로 확인했습니다.

## 발견하고 수정한 문제

| 문제                                          | 수정과 회귀 근거                                                        |
| --------------------------------------------- | ----------------------------------------------------------------------- |
| DOCX 글자 크기 단위                           | 공통 pt를 native half-point로 변환. XML과 Word의 14pt 읽기로 확인       |
| HWPX 글꼴 이름만 전달하면 서식 미적용         | 공식 서비스로 font ID를 등록·전달. 실제 header와 조회 상태로 확인       |
| HWPX 복구본 저장 후 변경 상태가 다시 나타남   | 복구 표시와 엔진 변경 표시를 구분. 복구·저장 뒤 안정 상태 검사          |
| 숫자 입력의 Enter가 문서에도 전달             | 입력칸에서 키를 소비하고 포커스 복원. 선택 문서 전체 텍스트 보존 검사   |
| 숫자 입력 중 Ctrl+S의 내보내기 순서           | 입력을 확정하고 진행 중인 명령 완료 후 내보내기. 저장된 XML의 크기 검사 |
| 새 원본 props가 기존 편집을 교체              | 원본 교체 보호와 명시적 재열기, 자신의 저장 응답 구분                   |
| 다른 문서의 같은 revision으로 agent 실행 가능 | 문서 ID와 revision을 함께 확인                                          |
| 패키지에 upstream 예제·PWA 자산 포함          | 런타임 파일만 복사하고 원본 LICENSE·고지 보관                           |
| Windows sparse checkout의 폰트 링크           | 별도 폰트 디렉터리를 제외하고 npm WASM과 자체 Studio 빌드 사용          |
| 정적 자산의 루트 경로                         | theme·아이콘·이미지 URL을 상대 경로로 정리하고 production HTTP 검사     |

## 재현

```sh
yarn install --immutable
yarn assets:prepare
yarn fixtures:generate
yarn typecheck
yarn test
yarn test:e2e
yarn build
yarn verify:packages
```

E2E가 dev server를 실행하며 로컬에서는 Chrome·Edge가 설치돼 있어야 합니다. CI 모드에서는 `yarn playwright install --with-deps chromium` 후 실행합니다. [GitHub Actions workflow](../.github/workflows/verify.yml)는 작성했으며 원격 GitHub runner에서는 아직 실행하지 않았습니다. 구성은 [GitHub 공식 checkout](https://github.com/actions/checkout), [setup-node](https://github.com/actions/setup-node), [Playwright CI 안내](https://playwright.dev/docs/ci-intro)를 참고했습니다.

Microsoft Word 검증은 Word가 설치된 Windows에서 dev server를 실행한 뒤 다음 순서로 수행합니다.

```powershell
yarn test:native:prepare
powershell -NoProfile -File tests/native/word-validation.ps1
```

원본·편집본은 읽기 전용으로 열며 실제 사용자 문서가 있는 Word 인스턴스에서는 검증을 중단합니다. 결과는 `playwright-report/`, `test-results/`, `.build/package-verification.json`, `.build/consumer-browser.json`, `.build/native-qa/`에 생성됩니다. 이 실행 산출물은 Git에서 제외하며 합성 corpus와 재현 스크립트를 제공합니다.

## 아직 검증하지 않은 범위

실제 한글 프로그램에서 HWPX를 여는 검사, 물리 키보드의 Windows IME 수동 입력, Firefox·Safari·macOS와 실제 Linux 실행 결과는 없습니다. Next.js의 별도 basePath·엄격한 CSP 설정도 검증하지 않았습니다. IME 시험은 Chrome DevTools Protocol로 브라우저 조합 입력을 재현한 것입니다. 화면의 모든 픽셀이 원본 Office와 같다는 검증도 아닙니다. 시스템 글꼴 대체에 따라 조판과 줄바꿈이 달라질 수 있습니다.

corpus는 자체 생성한 6개 문서이며 실제 업무 문서 전반을 대표하지 않습니다. 복잡한 필드·도형·수식·차트·댓글·변경 추적, 암호화·매크로 문서, 대용량·과도하게 압축된 ZIP, 외부 관계 링크와 세부 OOXML·OWPML 적합성은 추가 검증이 필요합니다. 기존 표의 보존 검사와 새 표·그림 삽입 지원도 구분합니다.

저장 fault injection은 모의 호스트와 초안 저장소를 사용합니다. 운영 BFF·lease 만료·청크 업로드·서버 중단·샌드박스 동기화는 기존 앱에 패키지를 실제 연결한 뒤 검증해야 합니다. 현재 제공한 호스트 연결 예제는 기존 업로드 함수의 호출 계약을 유지하며 테스트로 확인한 범위입니다.

HWP·PPTX·XLSX는 후속 계획이며 현재 지원 형식으로 표시하지 않습니다. GitHub·npm 공개와 운영 앱 교체도 이 검증 완료와 별개의 후속 작업입니다.
