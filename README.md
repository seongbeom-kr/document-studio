# Document Studio

기존 React·Next.js 앱 안에 넣어 쓰는 **HWPX·DOCX 편집 컴포넌트와 SDK**입니다. 별도 저장소에서 개발·배포하는 오픈소스 라이브러리이며, 샌드박스 에이전트 같은 소비 앱이 패키지를 import해 사용합니다.

RHWP와 EigenPal DOCX Editor를 형식별 엔진으로 연결하고 공통 편집 UI, 서식 명령, 저장 연결과 초안 복구를 제공합니다. 파일 목록·라우팅·인증은 소비 앱이 담당합니다. `apps/playground`는 개발·회귀 테스트를 위한 비공개 예제 workspace입니다.

현재 0.2.12의 지원 형식은 HWPX·DOCX입니다. 패키지 이름은 가칭이며 GitHub와 npm에는 아직 공개하지 않았습니다. 로컬 workspace와 배포용 tarball로 사용할 수 있습니다. 기능별 범위는 [지원표](docs/feature-support.md), 테스트 근거는 [확장 검증 기록](docs/practical-validation.md)에 있습니다.

## 라이브러리 빌드

Node 24.13 이상, Yarn 4, Git이 필요합니다. RHWP의 고정 소스와 npm WASM을 연결하므로 Rust 컴파일러는 필요하지 않습니다.

```sh
corepack enable
yarn install
yarn assets:prepare
yarn build
```

`yarn build`는 아래 네 SDK 패키지만 빌드합니다. HWPX JS·WASM 런타임은 `.build/rhwp-studio`에서 생성해 엔진 패키지에 포함합니다. 소비 앱은 `document-studio-rhwp-assets`로 자신의 정적 파일 디렉터리에 복사해 사용합니다. 별도 Document Studio 서버가 필요하지 않습니다.

## 패키지 구성

| 패키지                         | 역할                                          |
| ------------------------------ | --------------------------------------------- |
| `@document-studio/core`        | 문서·명령·저장·초안 계약과 에이전트 명령 설명 |
| `@document-studio/react`       | 공통 UI, React 편집기, 에이전트 bridge        |
| `@document-studio/engine-docx` | DOCX 엔진 연결과 지연 로딩                    |
| `@document-studio/engine-rhwp` | HWPX 엔진 연결과 자체 호스팅 Studio 자산      |

엔진은 원본 형식의 문서 모델을 유지합니다. HWPX와 DOCX 전체를 공통 HTML 모델로 변환하지 않습니다. React는 소비 앱의 peer dependency이며, SDK는 Next.js의 router·인증·설정 서비스에 의존하지 않습니다.

## React에서 사용

```tsx
import { useRef } from "react";
import type { EditorDocument, DocumentStorage } from "@document-studio/core";
import {
  DocumentEditor,
  type DocumentEditorHandle,
} from "@document-studio/react";
import { docxEngine } from "@document-studio/engine-docx";
import { rhwpEngine } from "@document-studio/engine-rhwp";
import "@document-studio/react/styles.css";

const engines = [
  docxEngine(),
  rhwpEngine({ studioUrl: "/editor-assets/rhwp/index.html" }),
];

export function EmbeddedEditor({
  document,
  storage,
}: {
  document: EditorDocument;
  storage?: DocumentStorage;
}) {
  const editorRef = useRef<DocumentEditorHandle>(null);
  return (
    <DocumentEditor
      ref={editorRef}
      document={document}
      engines={engines}
      appearance="embedded"
      draftNamespace="my-app:user-id"
      storage={storage}
    />
  );
}
```

`id`는 안정적인 문서 id, `version`은 저장소가 확인한 원본 버전입니다. props의 문서를 렌더마다 새 객체로 만들지 않습니다. 편집기 컴포넌트의 `key`에 원본 version을 넣어 강제 재마운트하지 않습니다. 열린 문서의 원본을 props로 교체하면 현재 편집본을 보존하고, 사용자가 명시적으로 새 원본을 열도록 합니다. 자신의 저장 완료 버전은 원본 교체와 구분합니다. Next.js에서는 `"use client"` 컴포넌트에서 사용합니다.

RHWP 자산은 패키지의 `document-studio-rhwp-assets` 명령으로 앱의 정적 파일 디렉터리에 복사합니다. 외부 데모를 기본 서버로 사용하지 않습니다. 공개 빌드에는 upstream의 예제 문서·사진과 서비스 워커를 포함하지 않습니다. 기본 폰트는 브라우저와 시스템 폰트 환경에 따라 대체될 수 있습니다.

`appearance="embedded"`는 SDK의 문서 제목·저장·닫기 헤더를 생략합니다. 소비 앱이 기존 헤더와 버튼을 유지하고 `editorRef.current.save()`·`exportDocument()`를 연결합니다. `onStateChange`는 준비·미저장·작업 중·저장 중 상태를 전달하므로 호스트 버튼의 상태도 함께 갱신할 수 있습니다. `getState()`로 실행 직전 상태를 다시 확인합니다. `--primary`, `--primary-foreground`, `--background`, `--foreground`, `--border`, `--muted`, `--muted-foreground`, `--radius` CSS 변수와 상속 글꼴을 사용합니다.

문단·표·그림·페이지 속성은 오른쪽 패널에서 편집합니다. 1100px 이하의 편집기에서는 도구를 아래에 배치합니다. 찾기 버튼 또는 문서 안에서 Ctrl+F로 공통 검색을 열 수 있습니다. 문단 속성은 현재 선택 상태를 따르며 바꾼 항목만 적용합니다. 혼합/미확인 값은 빈 값으로 표시합니다. HWPX 조회는 현재 커서 문단 기준이라는 제한을 표시합니다.

## 저장소 연결

도구 탭은 방향키·Home·End로 이동합니다. `도구 크게 보기`는 문서 영역 안에서 입력 공간을 넓히며 Escape로 접고, 한 번 더 누르면 도구를 닫고 열기 버튼으로 포커스를 돌립니다. 구조가 있는 자동화 미리보기는 읽기 전용이며 `원본 입력 수정` 후 미리보기를 다시 생성합니다.

자동화 입력은 문서 bytes와 별개입니다. 기본값은 현재 편집 세션의 메모리이며 닫을 때 미보관 입력을 경고하고 JSON 다운로드를 제공합니다. 닫기·새로고침 후에도 복구하려면 `browserAutomationDraftStore()`를 `useMemo` 등으로 안정적으로 만들고 `automationDraftStore`에 전달합니다. `draftNamespace`는 사용자·작업공간별로 격리해야 하며 문서 ID는 SDK가 더합니다. 이 옵션은 해당 브라우저의 IndexedDB에 입력과 옵션을 보관하며 서버나 다른 기기에 전송하지 않습니다. 저장 실패는 화면과 `getState().automationDraftPending`에 남고 재시도할 수 있습니다. `save()`는 로컬 입력 보관을 시도하되 실패해도 문서를 저장합니다. `onSaved.automationDraft`와 `warnings`, `getState().automationDraftReady/automationDraftPending/automationDraftError`로 별도 결과를 확인하세요. `flushAutomationDraft()`는 문서 업로드 없이 입력 보관만 재시도합니다. 종료·전환 전에는 `flushDraft()`를 기다리거나 저장 뒤 자동화 입력이 ready이고 pending이 아닌지 확인해야 합니다. 메모리에만 남은 수정 입력은 명시적인 다운로드·폐기 결정을 받아야 합니다. 저장소 객체/namespace를 열린 편집 세션 중 임의 교체하지 말고 소유자 변경 시 종료 절차 후 재마운트하세요. 로그아웃 시 로컬 보관 자료 정리 정책은 호스트가 담당합니다.

`storage.save()`가 문서 bytes와 `expectedVersion`을 받아 저장된 새 `version`을 반환합니다. 충돌은 `SaveConflictError`로 반환합니다. 서버는 원자적으로 원본 버전을 확인해야 합니다. 성공 후 파일 목록 갱신 실패는 문서 저장 실패와 구분해서 표시합니다.

저장이 완료됐지만 후속 동기화가 지연된 경우에는 `{ version, warnings: [{ code, message }] }`를 반환합니다. SDK는 새 version과 저장 완료 상태를 반영하고 경고를 별도로 표시합니다. 호스트는 `onSaved`와 `getState().warnings`에서 경고를 확인할 수 있습니다. 샌드박스 동기화 재시도는 호스트의 동기화 작업으로 처리하며 문서를 다시 업로드하는 저장 재시도와 구분합니다.

`onSaved`에는 실제 저장한 `bytes`, `documentId`, `fileName`, `format`, `revision`, `version`, `warnings`가 전달됩니다. 소비 앱이 문서 목록을 보관한다면 이 bytes와 version으로 해당 문서를 함께 갱신해야 재열기 때 최신 편집본을 유지할 수 있습니다. `storage`가 없는 다운로드 저장도 새 로컬 version을 제공합니다. `download:`로 시작하는 로컬 version은 서버 digest가 아닙니다.

## 문서 전환과 초안 보관

자동화 원본/추가 입력은 각각 `AUTOMATION_FIELD_LIMIT`(1,000,000)까지 보관합니다. JavaScript 문자열의 UTF-16 길이 기준이며 `validateAutomationDraftState()`로 같은 계약을 검사할 수 있습니다. 초과 입력은 자르지 않고 현재 화면에 유지하며 길이·오류·다운로드를 제공합니다. `flushDraft()`는 전환을 거절하고 기존 정상 초안을 유지합니다. `save()`는 문서 저장과 별도로 입력 보관 경고를 반환하므로 문서 재업로드 없이 한도를 맞춰 `flushAutomationDraft()`를 재시도할 수 있습니다. 이전 버전의 큰 보관 자료는 원본 JSON을 내려받거나 `보관자료를 편집해 복구`로 모든 기능의 입력을 함께 불러와 수정할 수 있습니다. 길이 외에 형식까지 잘못된 기록은 원본 다운로드와 명시적인 폐기 경로를 제공합니다.

업무 자동화의 입력·추가 인수·셀 변환·열 구분은 현재 편집 세션에서 기능별로 기억합니다. 속성 탭을 바꾸거나 도구를 닫아도 유지되며, 다른 문서/새 편집 세션에는 전달되지 않습니다. 기본 예제는 최초 진입 또는 명시적인 `예제로 초기화`에서만 채웁니다. 이 폼 상태는 서버/브라우저 저장소에 기록하지 않습니다.

자동화 결과의 새 파일 저장은 호스트가 `onCreateDocument(document)`로 연결합니다. 기존 문서의 최신 편집본을 저장하거나 초안으로 보존한 뒤 생성 파일을 업로드하고, 목록 갱신과 문서 전환을 완료합니다. 콜백 실패 시 같은 결과를 재시도하면 동일한 생성 document id를 사용합니다. 호스트는 업로드 완료와 목록/열기 실패를 구분해 중복 파일을 만들지 않아야 합니다. 연결하지 않은 호스트에는 새 문서 저장 미지원 안내가 표시됩니다.

소비 앱이 탭을 바꾸거나 편집기를 제거하기 전에 최신 미저장 상태를 확인하고, 전환을 결정하면 `flushDraft()`를 기다립니다. 3초 간격의 자동 초안 저장만으로 최근 입력을 보장할 수는 없습니다.

저장 후 닫기와 에이전트로 제어를 넘기는 경로는 `await editor.save({ onlyIfDirty: true })`로 진행 중인 명령을 기다린 뒤 저장합니다. 명령이 끝나기 전에는 `dirty`가 false일 수 있으므로 호출 전에 dirty만 검사해 저장을 생략하지 않습니다. 처리 중에는 `getState().busy`와 `pendingCommands`에 상태가 노출됩니다. 저장이 성공한 뒤에도 같은 `sessionId`인지, 미저장 변경이나 동기화 경고가 남았는지, 자동화 입력 복구가 완료됐고 보관 대기가 없는지 확인하고 종료합니다. 명령·저장 실패는 현재 편집기를 유지합니다. 변경이 없는 세션은 업로드를 생략합니다.

저장 뒤 편집권 해제나 서버 응답을 기다리는 전환은 먼저 `const unlock = await editor.acquireInputLock()`을 호출합니다. 이 잠금은 native 입력과 새 SDK 편집 명령을 막고, 잠금 전에 시작한 명령과 마지막 `save()`는 완료할 수 있게 합니다. 저장이 끝나도 잠금을 유지하므로 전환 도중 입력이 유실되지 않습니다. 성공하면 기존 편집기를 제거하거나 다음 문서를 열고, 실패해 현재 편집을 계속할 때는 `await unlock()`으로 해제합니다. 잠금은 중첩할 수 있으며 원래 편집 세션에만 적용됩니다. `readOnly` 권한과 함께 적용되므로 잠금 해제가 읽기 전용 권한을 바꾸지는 않습니다. 커스텀 엔진은 `EngineViewProps.inputBlocked`와 `EditorSession.setInputBlocked()`로 내부 iframe/입력창의 차단을 구현해야 합니다.

DOCX·HWPX는 처음 열 때 100%로 시작합니다. 이후 같은 세션의 재렌더링은 사용자가 선택한 배율을 초기화하지 않습니다. 문서 확대 선택에는 페이지 너비 맞춤이 포함됩니다. 사용자가 선택하면 현재 문서 영역 폭과 쪽 크기를 기준으로 배율을 다시 계산합니다. 1100px 이하의 편집기에서는 속성 도구를 아래에 배치해 문서 폭을 유지합니다.

```ts
async function confirmDocumentSwitch(nextDocument: EditorDocument) {
  const editor = editorRef.current;
  if (!editor) throw new Error("편집기를 준비하는 중입니다.");
  await editor.flushDraft();
  setOpenedDocument(nextDocument);
}
```

`flushDraft()`는 진행 중인 명령·자동 초안 저장을 기다리고 최신 내용을 다시 내보내 초안 트랜잭션 완료까지 기다립니다. 이 동안 편집을 잠시 막습니다. 실패하면 예외를 반환하므로 호스트가 현재 문서를 유지하고 오류를 표시해야 합니다. 편집기 준비 중·저장 진행 중이거나, 미저장 내용이 있는데 `draftStore={false}`이면 전환 준비를 거절합니다. 초안 보관은 서버 저장을 뜻하지 않으며 dirty 상태를 지우지 않습니다. 다음 재열기에서 초안 복구를 선택할 수 있습니다.

파일 읽기나 API 응답을 기다린 뒤에는 이전 렌더의 dirty 값을 사용하지 않습니다. 실제 전환 직전에 현재 문서 ID와 `editorRef.current.getState()`를 다시 확인합니다. 다운로드 저장 후 목록의 bytes·version을 갱신하는 동작과 전환 전 초안 보관은 [playground](apps/playground/src/main.tsx)에서 확인할 수 있습니다. 예제 목록은 해당 브라우저 세션의 메모리에 있으며 영구 파일 관리 서비스는 아닙니다.

샌드박스 에이전트의 기존 파일 탭·모달에 넣는 [React 편집 pane](examples/sandbox-agent/document-pane.tsx)과 [저장 연결](examples/sandbox-agent/storage.ts)을 제공합니다. 사용법은 [호스트 연결 안내](examples/sandbox-agent/README.md)에 있습니다. 기존 `uploadWorkspaceFile`과 BFF·lease·`complete-edit`를 재사용합니다. 저장 연결의 단위 테스트는 호출 계약을 확인한 범위이며 운영 샌드박스 앱을 교체한 상태는 아닙니다.

대상 문서를 열 때와 '새 원본 열기'로 승인된 전환 모두 같은 초안 복구 절차를 거칩니다. 손상된 초안은 다운로드하거나 명시적으로 버리고 정상 원본을 열 수 있으며 자동으로 삭제하지 않습니다. 열린 문서에서 `draftStore={false}`로 바꾸면 새 초안 쓰기를 중지합니다. 일시적인 직렬화 revision 오류는 다시 저장할 수 있고, 서버 version 충돌만 원본 확인이 필요한 충돌 상태로 처리합니다.

## 에이전트 연결

```ts
import { createAgentBridge } from "@document-studio/react";

const agent = createAgentBridge(() => editorRef.current);
const state = agent.getState();
const commands = agent.listCommands();

await agent.execute({
  documentId: state.documentId,
  expectedRevision: state.revision,
  expectedSelectionKey: state.selectionKey!,
  expectedSessionId: state.sessionId,
  command: { id: "lineSpacing", value: 1.6 },
});
```

글자 크기는 pt, 행간은 배수, 확대는 비율입니다. `lineSpacing: 1.6`이 160%입니다. 에이전트는 명령의 지원·활성화 상태와 입력 범위를 확인할 수 있습니다. 대상 문서 ID와 revision이 현재 문서와 맞지 않으면 거절합니다. 문서가 바뀌어도 같은 숫자 revision만으로 실행하지 않습니다. LLM·MCP·네트워크 transport는 호스트가 연결합니다.

HWPX의 서식 조회는 캐럿 기준, DOCX의 서식 조회는 엔진의 선택 상태 기준입니다. `selectionStateScope`로 구분합니다. 여러 명령을 순서대로 호출하는 기능은 전체를 하나의 undo transaction으로 묶는다고 보장하지 않습니다.

검색 조건·문서 revision·편집 세션을 바꾸면 기존 결과와 선택은 무효화됩니다. 늦게 도착한 검색과 선택 응답도 현재 조건에 반영하지 않습니다. DOCX 강조색은 Word의 16색 중 선택하며, 엔진의 `CommandState.valueChoices`와 `valueSchema`로 허용값을 조회할 수 있습니다. 글자색과 HWPX 강조색은 자유 RGB 입력을 지원합니다.

`applyPreset()`은 각 명령 전후에 현재 문서·세션·권한을 확인합니다. 실행 중 권한이 철회되면 후속 명령을 중단하며 `PresetApplicationError.completedCommands`와 `totalCommands`로 확인된 적용 단계를 반환합니다. 이미 적용된 단계는 편집본에 남으므로 호스트는 오류를 표시하고 사용자가 복구 또는 재적용을 선택할 수 있게 해야 합니다.

## 개발용 예제와 검증

SDK 화면을 개발·검증할 때만 playground를 실행합니다. 아래 주소는 예제 서버이며 라이브러리 사용에 필요한 별도 서비스가 아닙니다.

```sh
yarn fixtures:generate
yarn dev:playground
```

예제 주소는 `http://127.0.0.1:4173`입니다. SDK를 테스트하는 문서 목록·파일 입력·빠른 서식 예제를 포함합니다. 예제를 production build하려면 `yarn build:playground`를 사용합니다.

```sh
yarn typecheck
yarn test
yarn test:e2e
yarn audit:licenses
yarn build
yarn verify:packages
```

로컬 E2E는 설치된 Chrome·Edge를 사용합니다. CI 환경에서는 Playwright Chromium을 사용합니다. 브라우저 입력·한글 IME 프로토콜·서식·실제 XML 내보내기·여러 페이지·표와 그림·저장 실패·충돌·초안 복구·외부 원본 교체·단축키·모바일 폭을 확인합니다. `verify:packages`는 네 라이브러리 tarball을 별도 npm 소비 앱에 설치하고 Next.js production build와 실제 임베드 화면의 편집·다운로드를 검사합니다. `.build/packs`에서 설치용 tarball을 확인할 수 있습니다. 소비 앱 검증에는 로컬 포트 4176을 사용하며 검증 후 서버를 종료합니다.

Windows에서 전체 E2E의 개발 모듈 요청을 줄이려면 `DOCUMENT_STUDIO_TEST_SERVER=bundle`과 비어 있는 `DOCUMENT_STUDIO_TEST_PORT`를 지정합니다. 시험 화면을 먼저 번들한 정적 서버에서 같은 케이스를 실행합니다. 실행 예시는 [소비·검증 안내](docs/release-guide.md), 0.2.8 입력 잠금·호스트 전환 수정은 [수정 기록](docs/review-fixes-0.2.8-2026-10-07.txt)에 있습니다.

Microsoft Word가 설치된 Windows에서는 [선택적 native 검증](tests/native/word-validation.ps1)으로 브라우저에서 내보낸 DOCX를 독립적으로 확인할 수 있습니다. 검증 문서는 자체 생성한 문서만 사용합니다. 실행 결과와 미검증 범위는 [검증 기록](docs/validation.md)에 정리합니다.

## 지원 범위

기본 편집·서식·저장 보호에 문단 세부 설정, 페이지 설정, 표 생성·행열 편집·셀 서식, 그림 삽입, 문서 읽기·검색·치환과 보고서 생성·업무 자동화를 제공합니다. 공통 편집 도구와 형식별 무료 확장 도구를 선택할 수 있습니다. 엔진이 거절하는 기능은 비활성화하거나 오류를 반환하며, DOCX 셀 병합·분할은 고정 엔진의 실행 결과상 공통 명령으로 사용할 수 없습니다.

HWP·PPTX·XLSX 편집과 정확한 HWPX 혼합 서식 집계는 후속 범위입니다. 최신 범정부 오피스 공개 가이드의 업무 기능을 자체 구현한 SDK이며, Windows 전용 자동화와 전체 1,000여 기능의 동등 제품이라고 표시하지 않습니다. 지원·제한·남은 기능은 [최신 참고 기능 대응표](docs/government-office-reference.md)에 기록합니다. 실제 업무 문서 전체의 글꼴·조판 호환성은 추가 검증이 필요합니다.

## 라이선스와 기여

자체 코드는 Apache-2.0입니다. RHWP·docx·fflate는 MIT, EigenPal 기본 엔진과 React adapter는 Apache-2.0, CanvasKit은 BSD-3-Clause입니다. 상용 Pro·editor-api 패키지는 포함하지 않습니다. [LICENSE](LICENSE), [NOTICE](NOTICE), 배포물의 `dist/licenses/`를 유지합니다. 검사 범위와 원본 라이선스 파일이 누락된 의존성의 처리 근거는 [라이선스 기록](docs/licensing.md)에 있습니다.

문제를 제보할 때는 공개 가능한 최소 문서, 사용한 명령, 기대·실제 결과, 브라우저와 엔진 버전을 함께 남깁니다. 업무·고객 문서는 저장소에 올리지 않습니다. 지원 기능 변경은 UI·에이전트 API·저장 결과 검증을 함께 갱신합니다.

[오픈소스 조사](docs/open-source-research.md), [구현 계획](docs/implementation-plan.md), [범정부 오피스 참고](docs/government-office-reference.md).

0.2.12의 `agent.execute`/`agent.applyPreset`은 `expectedSelectionKey`도 필수입니다.
`select` 완료 후 `getState()`에서 전체 범위 토큰을 다시 가져오세요. 문서 revision만으로 선택 위치를 보장하지 않습니다.
`agent.inspect(target)`는 내보낸 문서의 본문 표/셀/그림/용지 치수를 조회합니다. 주소는 해당 snapshot에서만 유효하며 실제 인쇄 배치와 글자 서식 검증은 포함하지 않습니다.
`agent.commit({...target, operationId})`은 저장 version, SHA-256, 저장 revision, 저장 위치 종류와 로컬 입력 상태를 반환합니다. 같은 요청 ID는 이 브리지 수명 안에서 동일 receipt를 재사용합니다. 탭 재연결까지 보장하려면 호스트가 receipt를 영속화해야 합니다. 비동기 에이전트 그림 삽입은 안전한 권한/범위 계약을 제공할 때까지 거절됩니다.
실제 General 에이전트의 인증된 명령 transport와 실행 trace는 아직 별도 통합 과제입니다. 위 API 제공과 LLM의 실제 업무 완료를 구분합니다.
