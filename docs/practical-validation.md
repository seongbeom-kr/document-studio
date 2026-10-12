# 0.2.0 확장 검증 기록

후속 SDK 안정성 검증은 [0.2.5 리뷰 대응 기록](review-fixes-0.2.5-2026-10-06.txt)에 있습니다. 이 문서는 0.2.0 당시 수행한 검증 결과와 native 확인 범위를 보존합니다.

2026-10-05 Windows 로컬에서 앱에 넣는 HWPX·DOCX SDK를 검증했습니다. 계획은 [실사용 확장 계획](practical-editor-plan.md), 현재 기능과 제한은 [지원표](feature-support.md)입니다. 검증 기록을 준비하는 시점의 최신 전체 회귀는 258개 통과이며 기존 0.1.0의 180개 회귀를 포함합니다.

| 검사                | 결과                 | 범위                                                                                 |
| ------------------- | -------------------- | ------------------------------------------------------------------------------------ |
| TypeScript          | 통과                 | SDK·host 예제·테스트, 소비 앱 Next 타입 build                                        |
| 단위                | 185개 / 7파일 통과   | 숫자·날짜·CSV·계산·조직·추첨·SVG·schema·ZIP·template·저장/agent 계약                 |
| Chrome·Edge         | 258개 통과, 각 129개 | HWPX/DOCX, 편집·저장·재열기·실패 주입·서식·업무 생성                                 |
| SDK build           | 통과                 | 네 0.2.0 ESM/types/CSS/self-hosted JS·WASM 패키지                                    |
| playground build    | 통과                 | 별도 private 예제 build. 큰 엔진 chunk 안내 있음                                     |
| 독립 소비 앱        | 통과                 | 로컬 tarball → npm install → Next 16.3.8 production build                            |
| 소비 앱 브라우저    | 4개 조합 통과        | Chrome/Edge × DOCX/HWPX, 편집·다운로드·저장 ack·문단 도구·Markdown factory·초안 전환 |
| Microsoft Word 16.0 | 통과                 | rich DOCX 본문·머리말·꼬리말·표/그림, 14pt·150% 해석                                 |
| 라이선스 gate       | 통과                 | npm 102개 + 외부 Rust 393개, notices·inventory의 tarball 포함                        |
| 보안 advisory 검사  | 통과                 | 전체 workspace production recursive audit. 현재 registry 제안 없음                   |
| 새 workspace 설치   | 통과                 | 최신 lock/manifest를 별도 빈 디렉터리에 immutable install                            |

Next 16.2.6의 알려진 advisory를 발견해 소비 예제를 16.3.8로 올렸습니다. root에서 기존 preview가 SWC 파일을 사용 중이라 in-place link가 EPERM으로 실패한 작업은 성공으로 세지 않았습니다. 기존 프로세스를 종료하거나 사용 중인 파일을 지우지 않고 새 디렉터리의 immutable install과 독립 Next 소비 build로 확인했습니다. 보안 검사는 [공식 Next advisory](https://github.com/vercel/next.js/security/advisories/GHSA-vcvr-r3jv-pc5j)의 수정 버전과 registry 결과를 참고했으며 새로운 취약점이 발견되면 다시 실행해야 합니다.

고정 엔진은 RHWP core/editor 0.8.6, Studio commit `e8800c8def63449808a4092798442652ed460552`, EigenPal core/react 2.25.0입니다. Chrome 153.0.8010.54와 Edge 154.0.4258.53, Node 24.15.0, Yarn 4.14.1, React 19.3.0을 사용했습니다.

## 문서와 시험 조건

자체 생성한 11개 파일을 사용했습니다. 두 형식의 blank/sample/rich/unicode/long 10개와 nested DOCX입니다. rich는 여러 문단·표·PNG, DOCX 병합 셀·머리말·꼬리말을 포함합니다. unicode는 한글·영문·일본어·아랍어·emoji/grapheme·특수 기호, long은 200문단입니다. 이 밖에 Markdown 제목/목록/표와 150명 참석자 문서를 runtime factory로 생성해 재열었습니다. 2,000명 명단은 단위 수준의 분할/검증 검사이며 2,000명 브라우저 성능 시험은 아닙니다.

문단 앞 6pt·뒤 9pt·왼쪽 10mm·내어쓰기 5mm·고정 행간 18pt를 UI에서 적용하고 실제 XML의 twips/HWPUNIT을 확인했습니다. 페이지 가로·여백, 표 2×3/행 추가·셀 배경·세로 정렬·1pt 테두리의 물리 변환, PNG 크기·media bytes·undo를 검사했습니다. 차트는 문서 영역의 실제 PNG 픽셀과 화면을 확인했습니다. HWPX 본문 그림이 여백 밖에 놓인 문제는 inline 설정으로 수정한 뒤 검사했습니다.

검색은 한국어·중복·대소문자·단어 단위·emoji 뒤 위치·빈 문자열 치환·오래된 결과 거절을 확인했습니다. 고정 DOCX runtime이 타입에 선언된 replaceMatch/historyGroup을 거절해 지원되는 선택+텍스트 입력/선택 삭제 경로를 사용했습니다. 전체 치환의 한 번 undo를 보장하지 않습니다. preset 중 export는 명령 완료를 기다리며 오래된 revision·파괴적인 preset은 변경 전에 거절합니다.

저장은 주기적 초안 이전 전환, 파일 읽기 중 새 입력, 저장 후 목록/재열기, 이미 진행 중인 초안 저장, 저장 실패·version 충돌·동기화 경고·onSaved 실패·외부 원본 교체를 포함합니다. 운영 서버가 아닌 모의 storage와 자체 host 예제를 사용했습니다.

## 한계

- 실제 고객/기관 문서 전체의 호환성을 확인한 것은 아닙니다. 테스트한 synthetic corpus와 명령 범위의 근거입니다.
- 실제 한컴 한글의 HWPX Open 검사는 수행하지 않았습니다. Office 2018 COM 등록은 확인했으나 파일 접근 automation module 값이 없는 상태여서 native 승인창을 자동 처리하는 시험을 수행하지 않았습니다.
- 물리 Windows IME·Firefox·Safari·터치 입력·스크린리더·모든 native 고급 메뉴는 미검증입니다. 원격 GitHub CI는 설정했으며 실제 실행 결과는 없습니다.
- 운영 샌드박스 BFF·인증·lease·동기화는 타입/모의 계약 시험이며 실제 통합 결과가 아닙니다.
- DOCX 병합/분할·자간/장평, HWPX 깊은 중첩 자동 쓰기, PDF/XLSX 실제 파일 처리, native 전체 기능 동등성은 [지원표](feature-support.md)와 [정부 기능 대응](government-office-reference.md)의 제한을 따릅니다.
- 라이선스는 [근거 기록](licensing.md)과 보관된 조건을 확인한 범위이며 법률 감사/완전한 binary linkage 추출을 뜻하지 않습니다.

## 재현과 산출물

```sh
yarn typecheck
yarn test
yarn test:e2e
yarn audit:licenses
yarn audit:security
yarn build
yarn build:playground
yarn verify:packages
node scripts/verify-clean-install.mjs
yarn test:native:prepare
powershell -NoProfile -File tests/native/word-validation.ps1
```

기계 요약은 [practical-validation-results.json](practical-validation-results.json)에 저장합니다. 상세 로컬 산출물은 `.build/e2e-results.json`, `playwright-report/index.html`, `.build/unit-results.json`, `.build/package-verification.json`, `.build/consumer-browser.json`, `.build/licenses/`, `.build/native-qa/`, `.build/extended-*-chart.png`입니다. `.build`와 실제 참고 PDF는 Git에서 제외합니다. 로컬 배포 tarball은 `.build/packs/{core,react,engine-docx,engine-rhwp}.tgz`입니다. GitHub/npm에는 아직 게시하지 않았습니다.
