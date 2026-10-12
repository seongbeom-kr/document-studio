# HWPX와 DOCX 편집기 오픈소스 조사

2026년 10월 4일 기준 조사입니다. 목적은 독립 오픈소스 편집기를 만들고, `automation-platform`의 샌드박스 에이전트가 배포된 편집기 패키지를 사용하도록 하는 것입니다. 사용자가 선택한 첫 공개 범위는 **HWPX와 DOCX**, 이후 확장은 HWP, PPTX, XLSX입니다.

선택한 구조는 **RHWP와 EigenPal DOCX Editor를 형식별 엔진으로 사용하고, React로 공통 화면과 툴바를 만드는 방식**입니다. 두 엔진 모두 외부 UI를 연결할 공식 API가 있습니다. 조사 이후 고정 패키지와 자체 호스팅 자산을 연결해 첫 구현을 완료했으며, 조사 근거와 실제 구현 검증을 구분하기 위해 결과는 [검증 기록](validation.md)에 정리했습니다.

## 조사 기준과 근거 수준

공식 저장소, 문서, 라이선스 파일, npm 레지스트리 메타데이터를 확인했습니다. npm 조회 결과는 [research-snapshot.json](research-snapshot.json)에 저장했습니다. 라이브러리를 설치하거나 실제 문서의 편집·저장을 실행한 새 검증은 이번 조사에 포함하지 않습니다.

평가 기준은 원래 파일 형식으로 저장 가능한지, 자체 툴바와 선택 상태를 연결할 수 있는지, 브라우저에서 동작하는지, React에 넣기 쉬운지, 공개·배포 조건이 무엇인지입니다. README에 있는 기능 설명과 실제 호환성 검증은 구분합니다. 특히 **화면 표시, 편집, 저장 시 보존**은 서로 다른 기능입니다.

## 주요 후보 비교

표의 채택 판단은 이번 프로젝트의 요구를 기준으로 한 제안입니다. 라이선스는 주요 직접 구성요소 기준이며, 최종 배포 시 하위 의존성과 번들 자산의 고지 조건을 함께 확인해야 합니다.

| 후보                                                            | 확인한 기능과 조건                                                                                              | 이번 프로젝트의 판단                                                                               |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| [RHWP](https://github.com/edwardkim/rhwp)                       | Rust·WASM 기반 HWP/HWPX 파싱·렌더링·편집·저장. MIT. `@rhwp/editor`는 iframe, `@rhwp/core`는 직접 WASM API.      | **HWPX 우선 후보.** 기존 샌드박스 구현과 연결 경험을 활용할 수 있음.                               |
| [EigenPal DOCX Editor](https://github.com/eigenpal/docx-editor) | 브라우저 DOCX 편집, React·Vue 어댑터, 자체 UI 구성 API. 기본 엔진·React 패키지는 Apache-2.0.                    | **DOCX 우선 후보.** 공통 React 툴바 구성에 적합.                                                   |
| [SuperDoc](https://github.com/superdoc/docx-editor)             | DOCX 편집과 문서 API, 협업·검토 기능. 저장소는 AGPLv3, 별도 상용 라이선스 제공.                                 | 기능 비교용 대안. 플랫폼에 배포할 방식과 라이선스 선택이 달라져 기본 의존성으로 선정하지 않음.     |
| [pptx-viewer](https://github.com/ChristopherVR/pptx-viewer)     | 브라우저 편집·발표·PPTX 저장, React 바인딩과 headless core. Apache-2.0. 일부 번들 구성요소는 별도 라이선스.     | **PPTX 후속 후보.** 기존 패치를 최신 버전에서도 재검증해야 함.                                     |
| [office-kit/xlsx](https://github.com/office-kit/xlsx)           | Node·브라우저 XLSX 읽기·쓰기, 워크북·스타일·차트 구조 처리. MIT. 공식 문서는 pre-1.0 alpha로 명시.              | **XLSX 파일 처리 후보.** 편집 화면은 별도로 필요.                                                  |
| [Univer](https://github.com/dream-num/univer)                   | 공통 모델·명령·플러그인·UI와 수식 엔진. OSS는 Apache-2.0. 공식 Office import/export, 여러 고급 기능은 Pro 영역. | UI 참고 및 XLSX 화면 대안. 무료 공개 구성만으로 원본 파일 저장을 완성하는 비용을 따로 계산해야 함. |
| [FortuneSheet](https://github.com/ruilisi/fortune-sheet)        | React 스프레드시트, 수식·셀 서식·병합·행열 작업. MIT. Excel import/export는 별도 플러그인 연결.                 | XLSX 단계에서 비교할 화면 후보. 가져오기·저장 시 손실과 자체 UI 연결 범위 검증 필요.               |
| [ONLYOFFICE Docs](https://github.com/ONLYOFFICE/DocumentServer) | 통합 Office 편집과 협업. Document Server 구성이 필요하며 Community는 AGPLv3.                                    | 별도 서버를 운영하는 대안. 현재 목표인 가벼운 React 편집기 패키지와 구조가 다름.                   |
| [Collabora Online](https://github.com/CollaboraOnline/online)   | LibreOffice 기반 문서·시트·슬라이드 편집. 소스는 주로 MPLv2와 기타 라이선스.                                    | 서버 기반 대안. 배포할 실행 파일·이미지의 조건을 별도 확인해야 함.                                 |

EigenPal의 변경 추적·댓글 작성·custom node는 `@docx-editor.dev/pro`, Office.js 형태의 자동화 API는 `@docx-editor.dev/editor-api`라는 **상용 패키지**에 해당합니다. 공개 버전은 기본 편집과 무료 core/React 명령 API를 사용하도록 설계합니다. 자체 툴바 연결과 상용 자동화 API를 혼동하지 않아야 합니다. [공식 라이선스 설명](https://www.docx-editor.dev/), [자동화 API 문서](https://www.docx-editor.dev/docs/2.x/editor-api).

Univer의 통일된 UI를 그대로 채택하면 HWPX 엔진 연결과 Office 파일 변환 계층을 추가로 만들어야 합니다. 공식 저장소는 Sheets·Docs·Slides의 import/export를 Pro 영역으로 구분합니다. 따라서 전체 엔진 교체보다 형식별 엔진을 감싸는 방식을 우선 제안합니다. [OSS와 Pro 기능 경계](https://github.com/dream-num/univer#-open-source-and-pro).

ONLYOFFICE가 HWP/HWPX를 열 수 있다는 설명은 HWPX 원본으로 편집·저장할 수 있다는 뜻과 다릅니다. 공식 8.3 안내는 해당 파일의 편집 시 OOXML로 변환해 저장한다고 명시합니다. HWPX 원본 저장 요구는 RHWP 경로로 유지해야 합니다. [공식 형식 안내](https://www.onlyoffice.com/blog/2025/02/onlyoffice-docs-8-3-released).

Collabora는 소스와 공식 실행 형태의 배포 조건을 구분합니다. MPL이라는 이유만으로 공식 바이너리의 재배포 조건까지 같다고 가정하지 않습니다. 이번 설계에서는 후속 서버 플러그인 후보로만 둡니다. [공식 소스와 실행 형태 조건](https://www.collaboraonline.com/terms/collabora-online-mplv2/).

## 공통 UI를 만들 수 있는 확장점

### RHWP

`createStudio()`와 `chrome` 설정으로 기본 메뉴·툴바·상태표시줄을 숨길 수 있습니다. 외부에서 `commands.list()`, `commands.isEnabled()`, `commands.execute()`, `commands.context()`를 호출하고 HwpCtrl bridge를 연결할 수 있습니다. 외부 React 화면이 저장 버튼과 메뉴를 소유하는 방식이 가능합니다. [공식 SDK 설명](https://github.com/edwardkim/rhwp/blob/main/npm/editor/README.md).

npm 0.8.6의 `gitHead`에 해당하는 타입 선언에서도 `createStudio`, 툴바 표시 설정, 명령 API가 확인됩니다. 다만 `CommandInfo`는 활성화 여부를 제공하고, 현재 선택의 굵기·글꼴 같은 모든 서식 상태는 타입으로 보장하지 않습니다. `commands.context()`와 HwpCtrl로 어디까지 읽고 적용할 수 있는지 실행 검증이 필요합니다. [고정 커밋 타입 선언](https://github.com/edwardkim/rhwp/blob/e8800c8def63449808a4092798442652ed460552/npm/editor/index.d.ts).

같은 타입에서 `onDocumentChanged`의 사유는 `agent_apply`와 `agent_revert`입니다. 이를 모든 키보드 입력·서식 변경·undo 이벤트라고 가정하면 미저장 상태를 놓칠 수 있습니다. 일반 편집의 변경 알림과 상태 조회 범위를 첫 검증에 포함합니다. 관찰 내용은 [rhwp-api-observation.json](rhwp-api-observation.json)에 기록했습니다.

iframe은 외부 명령 bridge와 스타일 분리를 위한 구현 방식으로 사용합니다. 기본 Studio URL이 외부 데모를 가리킬 수 있으므로 제품은 Studio·WASM·허용된 폰트를 직접 호스팅합니다. SDK와 Studio 빌드 커밋을 묶어 기록하고, 파일 선택부터 저장까지 외부 서비스 요청 없이 가능한지 확인합니다. [SDK 옵션과 자체 호스팅](https://github.com/edwardkim/rhwp/blob/main/npm/editor/README.md).

확장점이 부족하면 먼저 재현 가능한 작은 upstream 개선을 제안합니다. 필요한 동안 작은 bridge 패치를 유지할 수 있지만, 전체 렌더링·조판 엔진을 다시 구현하는 경로는 첫 버전에 넣지 않습니다. RHWP도 공통 엔진과 제품별 화면·서비스를 upstream/downstream으로 구분합니다. [공식 프로젝트 경계](https://github.com/edwardkim/rhwp/blob/main/ROADMAP.md#업스트림과-다운스트림의-경계).

### DOCX Editor

`DocxEditor.Root`, `Viewport`, `Content`로 편집 영역을 조합하고, 자체 React 툴바를 붙일 수 있습니다. `useEditorCommand()`가 실행·활성화·선택 상태를 제공하고 `useEditorState()`가 편집기 상태 구독을 제공합니다. CSS 색상만 바꾸는 것보다 공식 조합 API로 공통 UI를 구현하는 방식이 적합합니다. [UI 구성 문서](https://www.docx-editor.dev/docs/2.x/react/composition), [툴바 연결 문서](https://www.docx-editor.dev/docs/2.x/guides/toolbar).

툴바 클릭 때 선택 영역과 IME 입력을 유지해야 합니다. 공식 예시도 버튼의 mouse-down이 캐럿을 빼앗지 않도록 처리합니다. 미저장 여부는 `canUndo`와 다르므로 저장 완료 revision을 별도로 관리합니다. [React hooks와 상태 의미](https://www.docx-editor.dev/docs/2.x/react/hooks).

공식 기능표는 병합·분할 같은 표 편집, 일부 그림과 조판 기능의 한계를 설명합니다. 두 형식의 메뉴는 같은 위치와 디자인을 쓰되, 엔진이 지원하는 동작만 제공해야 합니다. 표시·수정·보존의 지원 범위를 형식별로 공개합니다. [Word 기능과 보존 범위](https://www.docx-editor.dev/docs/2.x/word-fidelity).

## 다른 오픈소스에서 얻을 부분

| 후보                                                                                                       | 확인한 역할                                                                                 | 활용 판단                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| [Tiptap](https://github.com/ueberdosis/tiptap)와 [ProseMirror](https://github.com/ProseMirror/prosemirror) | MIT 기반 rich text 구성 도구. Tiptap의 공식 DOCX Conversion은 별도 서비스·유료 플랜에 포함. | UI·명령 구조 참고. 기존 DOCX 보존을 위한 기본 엔진으로 바로 대체하지 않음. [Conversion 제품 조건](https://tiptap.dev/product/conversion). |
| [hwp.js](https://github.com/hahnlee/hwp.js)                                                                | Apache-2.0 HWP 뷰어·파서.                                                                   | 비교용 읽기 도구. 저장까지 제공하는 편집 엔진으로 간주하지 않음.                                                                          |
| [docx-preview](https://github.com/VolodymyrBaydalka/docxjs)                                                | Apache-2.0 DOCX 렌더링 라이브러리.                                                          | 미리보기 후보. 편집 후 원본 저장 경로는 별도로 필요.                                                                                      |
| [PPTist](https://github.com/pipipi-pikachu/PPTist)                                                         | Vue 기반 슬라이드 앱. 현재 AGPL-3.0.                                                        | 슬라이드 UX 참고. React 패키지와 원본 PPTX 보존은 별도 평가가 필요.                                                                       |
| [PptxGenJS](https://github.com/gitbrent/PptxGenJS)                                                         | MIT PowerPoint 생성 라이브러리.                                                             | 새 파일 생성용 도구. 기존 PPTX 편집 엔진 채택의 근거로 삼지 않음.                                                                         |
| [SheetJS CE](https://git.sheetjs.com/sheetjs/sheetjs)                                                      | Apache-2.0 스프레드시트 파일·데이터 처리 도구.                                              | 다양한 형식 읽기 대안. 편집 UI와 복잡한 원본 보존은 따로 검증.                                                                            |
| [AG Grid Community](https://www.ag-grid.com/react-data-grid/community-vs-enterprise/)                      | MIT 데이터 그리드. Excel export·여러 고급 기능은 Enterprise 영역.                           | 기존 셀 편집 재사용에 유용하지만, Excel 전체 편집기를 의미하지 않음.                                                                      |
| [Luckysheet](https://github.com/dream-num/Luckysheet)                                                      | MIT, 공식 저장소가 보관 상태이며 유지보수 중단을 명시.                                      | 신규 기반에서 제외. 후속 Univer와 FortuneSheet 비교에 활용.                                                                               |

FortuneSheet의 공식 README는 별도 [FortuneExcel](https://github.com/Corbe30/FortuneExcel) 플러그인을 연결합니다. 플러그인도 MIT로 표시하지만, import/export 지원만으로 복잡한 차트·피벗·조건부 서식의 보존을 보장하지 않습니다. XLSX 단계에서 동일한 샘플과 편집 작업으로 비교해야 합니다.

## 기존 샌드박스에서 가져갈 경험

기존 `automation-platform`의 편집기와 저장 계약을 읽어 아래의 소비 환경을 확인했습니다. 독립 SDK와 플랫폼 호스트 연결의 경계를 정하는 참고이며, 운영 앱 교체를 완료한 결과는 아닙니다.

| 기존 코드                                 | 독립 프로젝트로 가져갈 부분                     | 플랫폼에 남길 부분                               |
| ----------------------------------------- | ----------------------------------------------- | ------------------------------------------------ |
| `hwpx-editor-panel.tsx`                   | 파일 bytes 입력·내보내기, RHWP 초기화·해제 경험 | session 파일 조회, 저장 API, 서버 digest·lease   |
| `docx-office-editor.tsx`                  | bytes 입력, React 엔진 연동                     | 공통 UI는 독립 프로젝트에서 새로 구성            |
| `office-editor-panel.tsx`                 | 내보내기 등록, 수정 상태, 실패 시 초안 유지     | `workAgentApi`, 업로드, 서버 충돌 처리           |
| `document-edit-session.tsx`와 draft store | 복구·저장 상태의 요구사항과 테스트 경험         | 세션별 잠금·인증·버전 목록 API                   |
| XLSX export와 PPTX patch                  | 재현 샘플과 호환성 회귀 조건                    | 버전 업그레이드 전에 임의로 패치를 제거하지 않음 |

기존 플랫폼의 QA 기록에서는 수식·차트의 **파일 보존**과 브라우저 **계산·표시**를 별도로 확인했습니다. PPTX 테마 폰트와 XLSX 줄바꿈 직렬화에도 별도 대응이 있었습니다. 이 조건은 후속 형식의 회귀 대상으로 기록하며, 새 패키지의 통과 결과는 [별도 검증 기록](validation.md)을 기준으로 합니다.

공개 테스트에는 자체 제작 문서 또는 재배포 조건이 확인된 문서를 사용합니다. 업무·고객 문서는 외부 저장소에 포함하지 않고, 필요한 문제를 합성 샘플로 재현합니다.

## 확인한 패키지 버전

검색 결과의 버전 표시와 현재 레지스트리가 달라 npm을 직접 확인했습니다. 아래 값은 조사 시점의 후보이며, RHWP 0.8.6과 EigenPal 2.25.0을 채택해 lockfile로 고정했습니다. RHWP Studio는 npm SDK와 같은 gitHead의 소스로 빌드합니다.

| 패키지                          | 기존 샌드박스 | 조사 시 npm latest | 주요 라이선스 |
| ------------------------------- | ------------- | ------------------ | ------------- |
| `@rhwp/editor`                  | 0.8.6         | 0.8.6              | MIT           |
| `@docx-editor.dev/react`와 core | 2.21.1        | 2.25.0             | Apache-2.0    |
| `pptx-react-viewer`             | 패치된 4.1.4  | 4.22.1             | Apache-2.0    |
| `@office-kit/xlsx`              | 0.22.0        | 0.23.4             | MIT           |
| `@univerjs/core`                | 미사용        | 1.0.3              | Apache-2.0    |
| `@fortune-sheet/react`          | 미사용        | 1.0.4              | MIT           |

버전·게시 시각·integrity·tarball·gitHead는 [npm 메타데이터 기록](research-snapshot.json)에 있습니다. `collect-research-snapshot.ps1`은 기록을 갱신하는 조사 보조 스크립트이며 패키지를 설치하거나 실행하지 않습니다.

## 채택 결과와 후속 검증

첫 구현은 **공통 React UI, RHWP HWPX 어댑터, EigenPal DOCX 어댑터, 개발용 playground, Next.js 소비 예제**로 구성했습니다. 엔진별 원본 문서 모델을 유지하고 저장·명령·상태 연결을 공통화했습니다. 자체 코드는 Apache-2.0이며 각 엔진의 저작권·LICENSE·NOTICE를 유지합니다.

공통 툴바·행간·단위 변환·한글 조합 입력·일반 편집의 변경 감지·원본 형식 저장·재열기·저장 실패·초안 복구와 패키지 소비를 검증했습니다. RHWP의 공식 automation 등록 API로 작은 상태·서식 확장을 구현했으며 upstream 소스를 수정하지 않았습니다. DOCX는 무료 core/React API를 사용합니다. 다음 검증은 실제 한글 앱의 재열기, 실제 OS IME, 다양한 업무 문서와 플랫폼 운영 저장 경로입니다. 작업 순서와 완료 기준은 [구현 계획](implementation-plan.md)에 있습니다.
