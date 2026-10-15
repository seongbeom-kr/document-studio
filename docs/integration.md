# 호스트 앱 통합 안내

React 19 앱에 Document Studio를 연결할 때 필요한 저장·전환·복구·에이전트 계약입니다. 빌드와 설치는 [README](../README.md), 패키지 소비는 [배포 안내](release-guide.md)를 참고하세요.

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

## 저장소와 자동화 입력 보관

도구 탭은 방향키·Home·End로 이동합니다. `도구 크게 보기`는 문서 영역 안에서 입력 공간을 넓히며 Escape로 접고, 한 번 더 누르면 도구를 닫고 열기 버튼으로 포커스를 돌립니다. 구조가 있는 자동화 미리보기는 읽기 전용이며 `원본 입력 수정` 후 미리보기를 다시 생성합니다.

자동화 입력은 문서 bytes와 별개입니다. 기본값은 현재 편집 세션의 메모리이며 닫을 때 미보관 입력을 경고하고 JSON 다운로드를 제공합니다. 닫기·새로고침 후에도 복구하려면 `browserAutomationDraftStore()`를 `useMemo` 등으로 안정적으로 만들고 `automationDraftStore`에 전달합니다. `draftNamespace`는 사용자·작업공간별로 격리해야 하며 문서 ID는 SDK가 더합니다. 이 옵션은 해당 브라우저의 IndexedDB에 입력과 옵션을 보관하며 서버나 다른 기기에 전송하지 않습니다. 저장 실패는 화면과 `getState().automationDraftPending`에 남고 재시도할 수 있습니다. `save()`는 로컬 입력 보관을 시도하되 실패해도 문서를 저장합니다. `onSaved.automationDraft`와 `warnings`, `getState().automationDraftReady/automationDraftPending/automationDraftError`로 별도 결과를 확인하세요. `flushAutomationDraft()`는 문서 업로드 없이 입력 보관만 재시도합니다. 종료·전환 전에는 `flushDraft()`를 기다리거나 저장 뒤 자동화 입력이 ready이고 pending이 아닌지 확인해야 합니다. 메모리에만 남은 수정 입력은 명시적인 다운로드·폐기 결정을 받아야 합니다. 저장소 객체/namespace를 열린 편집 세션 중 임의 교체하지 말고 소유자 변경 시 종료 절차 후 재마운트하세요. 로그아웃 시 로컬 보관 자료 정리 정책은 호스트가 담당합니다.

`storage.save()`가 문서 bytes와 `expectedVersion`을 받아 저장된 새 `version`을 반환합니다. 충돌은 `SaveConflictError`로 반환합니다. 서버는 원자적으로 원본 버전을 확인해야 합니다. 성공 후 파일 목록 갱신 실패는 문서 저장 실패와 구분해서 표시합니다.

저장이 완료됐지만 후속 동기화가 지연된 경우에는 `{ version, warnings: [{ code, message }] }`를 반환합니다. SDK는 새 version과 저장 완료 상태를 반영하고 경고를 별도로 표시합니다. 호스트는 `onSaved`와 `getState().warnings`에서 경고를 확인할 수 있습니다. 샌드박스 동기화 재시도는 호스트의 동기화 작업으로 처리하며 문서를 다시 업로드하는 저장 재시도와 구분합니다.

`onSaved`에는 실제 저장한 `bytes`, `documentId`, `fileName`, `format`, `revision`, `version`, `warnings`가 전달됩니다. 소비 앱이 문서 목록을 보관한다면 이 bytes와 version으로 해당 문서를 함께 갱신해야 재열기 때 최신 편집본을 유지할 수 있습니다. `storage`가 없는 다운로드 저장도 새 로컬 version을 제공합니다. `download:`로 시작하는 로컬 version은 서버 digest가 아닙니다.

## 문서 전환과 초기화

자동화 원본/추가 입력은 각각 `AUTOMATION_FIELD_LIMIT`(1,000,000)까지 보관합니다. JavaScript 문자열의 UTF-16 길이 기준이며 `validateAutomationDraftState()`로 같은 계약을 검사할 수 있습니다. 초과 입력은 자르지 않고 현재 화면에 유지하며 길이·오류·다운로드를 제공합니다. `flushDraft()`는 전환을 거절하고 기존 정상 초안을 유지합니다. `save()`는 문서 저장과 별도로 입력 보관 경고를 반환하므로 문서 재업로드 없이 한도를 맞춰 `flushAutomationDraft()`를 재시도할 수 있습니다. 이전 버전의 큰 보관 자료는 원본 JSON을 내려받거나 `보관자료를 편집해 복구`로 모든 기능의 입력을 함께 불러와 수정할 수 있습니다. 길이 외에 형식까지 잘못된 기록은 원본 다운로드와 명시적인 폐기 경로를 제공합니다.

업무 자동화의 입력·추가 인수·셀 변환·열 구분은 현재 편집 세션에서 기능별로 기억합니다. 속성 탭을 바꾸거나 도구를 닫아도 유지되며, 다른 문서/새 편집 세션에는 전달되지 않습니다. 기본 예제는 최초 진입 또는 명시적인 `예제로 초기화`에서만 채웁니다. 기본값은 메모리 보관이며, 브라우저 저장소 복구는 위의 `automationDraftStore` 설정을 따릅니다.

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

`flushDraft()`는 진행 중인 명령·자동 초안 저장을 기다리고 최신 내용을 다시 내보내 초안 트랜잭션 완료까지 기다립니다. 이 동안 편집을 잠시 막습니다. 실패하면 예외를 반환하므로 호스트가 현재 문서를 유지하고 오류를 표시해야 합니다. 이미 편집을 시작한 세션이 준비되지 않았거나 저장 진행 중인 경우, 미저장 내용이 있는데 `draftStore={false}`이면 전환 준비를 거절합니다. 초안 보관은 서버 저장을 뜻하지 않으며 dirty 상태를 지우지 않습니다. 다음 재열기에서 초안 복구를 선택할 수 있습니다.

파일 읽기나 API 응답을 기다린 뒤에는 이전 렌더의 dirty 값을 사용하지 않습니다. 실제 전환 직전에 현재 문서 ID와 `editorRef.current.getState()`를 다시 확인합니다. 다운로드 저장 후 목록의 bytes·version을 갱신하는 동작과 전환 전 초안 보관은 [playground](../apps/playground/src/main.tsx)에서 확인할 수 있습니다. 예제 목록은 해당 브라우저 세션의 메모리에 있으며 영구 파일 관리 서비스는 아닙니다.

샌드박스 에이전트의 기존 파일 탭·모달에 넣는 [React 편집 pane](../examples/sandbox-agent/document-pane.tsx)과 [저장 연결](../examples/sandbox-agent/storage.ts)을 제공합니다. 사용법은 [호스트 연결 안내](../examples/sandbox-agent/README.md)에 있습니다. 예제는 호스트의 파일 업로드·편집권 계약을 연결하는 참고 구현입니다. 실제 인증·권한·원자적 버전 확인과 동기화 동작은 소비 앱에서 검증해야 합니다.

대상 문서를 열 때와 '새 원본 열기'로 승인된 전환 모두 같은 초안 복구 절차를 거칩니다. 손상된 초안은 다운로드하거나 명시적으로 버리고 정상 원본을 열 수 있으며 자동으로 삭제하지 않습니다. 열린 문서에서 `draftStore={false}`로 바꾸면 새 초안 쓰기를 중지합니다. 일시적인 직렬화 revision 오류는 다시 저장할 수 있고, 서버 version 충돌만 원본 확인이 필요한 충돌 상태로 처리합니다.

초기화가 한 번도 완료되지 않은 문서의 `flushDraft()`는 문서 내보내기 없이 종료 준비를 할 수 있습니다. 기존 복구 초안은 삭제하지 않으며 자동화 입력 보관은 여전히 기다립니다. 준비 완료 후 편집 중인 세션의 보호 규칙은 그대로 적용됩니다.

HWPX 엔진은 iframe 첫 응답부터 연결·WASM 준비·문서 열기까지 기본 30초의 전체 제한 시간을 적용합니다. `rhwpEngine({ studioUrl, initializationTimeoutMs: 60000 })`처럼 1,000~120,000ms 범위에서 조정할 수 있습니다. 시간 초과·실패 시 iframe과 대기 요청을 취소하고 ‘편집기 다시 시도’를 표시합니다. 문서 초기 검증 worker의 제한 시간은 별도로 적용됩니다.

`getState().initialization`과 `onStateChange`는 `loading`(validating/connecting/opening), `failed`(code/message/retryable), `ready`를 구분합니다. `ready=false`인 동안 문서 명령과 저장은 실행하지 마세요. `retryInitialization()`은 실패한 초기화만 새 세션으로 다시 시작하며 준비된 편집본을 교체하지 않습니다. 에이전트는 `agent.retryInitialization({ documentId, expectedSessionId, expectedVersion })`를 호출한 뒤 상태를 다시 읽어야 합니다. 재시도에도 실패할 수 있으므로 호스트가 횟수·총 대기 한도를 관리해야 합니다.

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

`agent.execute`/`agent.applyPreset`은 `expectedSelectionKey`도 필수입니다.
`select` 완료 후 `getState()`에서 전체 범위 토큰을 다시 가져오세요. 문서 revision만으로 선택 위치를 보장하지 않습니다.
`agent.inspect(target)`는 내보낸 문서의 본문 표/셀/그림/용지 치수를 조회합니다. 주소는 해당 snapshot에서만 유효하며 실제 인쇄 배치와 글자 서식 검증은 포함하지 않습니다.

중첩 표의 속성과 셀 주소는 각 표에 독립적으로 반환합니다. 바깥 셀 텍스트에는 중첩 표의 텍스트를 중복해서 넣지 않습니다. 현재 셀의 텍스트 run을 연결하며, 중첩 표 내용은 별도 표의 셀에서 확인하세요. DOCX 세로 병합은 원본 merge 상태를 반환하고 전체 rowSpan 추론은 제공하지 않습니다.
`agent.commit({...target, operationId})`은 저장 version, SHA-256, 저장 revision, 저장 위치 종류와 로컬 입력 상태를 반환합니다. 같은 요청 ID는 이 브리지 수명 안에서 동일 receipt를 재사용합니다. 탭 재연결까지 보장하려면 호스트가 receipt를 영속화해야 합니다. 비동기 에이전트 그림 삽입은 안전한 권한/범위 계약을 제공할 때까지 거절됩니다.
인증된 에이전트 transport와 실행 trace 수집은 호스트가 구현합니다. 브리지 API 제공만으로 실제 LLM의 문서 작업 완료를 보장하지 않습니다.

## DOM API로 연결

0.2.18부터 `@document-studio/browser`가 `mountDocumentEditor(element, options)`를 제공합니다. React 코드는 SDK 내부에 있으며 호스트는 DOM 요소와 일반 객체·함수를 전달합니다. `@document-studio/browser/styles.css`를 import하고 호스트 요소에 높이를 지정하세요. Vue 예제는 `examples/browser/main.ts`의 `?host=vue` 경로입니다.

- `mountDocumentEditor()`는 공개 controller 연결까지 기다립니다. 문서 검증·native 초기화 완료는 `whenReady({ signal, timeoutMs })`로 기다립니다. 기본 45초, 지정 범위는 1~180,000ms이며 대기 취소는 편집기를 종료하지 않습니다.
- `update({ document })`는 현재 입력을 잠그고 `flushDraft()`가 완료된 뒤 새 편집 수명을 엽니다. 실패하면 기존 문서가 유지됩니다. 새 문서의 기존 초안은 정상 복구 UI를 거칩니다. 같은 id·fileName·format·version·bytes 참조의 객체 갱신과 UI 설정 갱신은 세션을 다시 만들지 않습니다.
- `update({ readOnly })`는 준비된 엔진의 내부 입력 잠금 응답까지 기다립니다. 지원하는 나머지 갱신은 appearance·presets·호스트 콜백·creationLocation입니다. 엔진·저장소·draftNamespace 등 소유권 설정 변경은 기존 controller를 종료하고 새로 mount하세요.
- `destroy()`는 최신 문서 초안과 자동화 입력의 종료 준비를 기다립니다. 저장소 실패·미보관 입력은 거절하며 편집기를 유지합니다. 동시 destroy는 같은 요청을 공유하고 종료 후 반복 호출은 허용합니다. 성공 후 편집 명령은 거절됩니다.
- 전환 중 새 명령·다른 update/destroy는 거절합니다. 저장 중 문서 전환은 먼저 저장이 끝나야 합니다. `onSaved`에서는 호스트 파일 목록을 갱신하고, 문서를 새로 열 필요가 있으면 `save()` 완료 후 update하세요.
- 같은 DOM 요소의 중복 mount는 거절합니다. SDK는 자신이 만든 자식 영역만 관리하며 호스트의 다른 요소를 지우지 않습니다.

Vue의 `onBeforeUnmount`나 다른 프레임워크의 unmount callback은 비동기 초안 보관이 끝날 때까지 DOM 제거를 자동으로 기다려 주지 않습니다. 라우터의 종료 guard 또는 사용자가 누르는 닫기 함수에서 **먼저 `await editor.destroy()`가 성공한 뒤** 컴포넌트/DOM을 제거하세요. 실패하면 화면을 유지하고 사용자가 저장·복구할 수 있게 해야 합니다. 페이지 강제 종료까지 보장하는 계약은 아닙니다.

`EditorController`, `EditorControllerState`, 저장 영수증과 `createAgentBridge`는 `@document-studio/core`에서 가져올 수 있습니다. 기존 React의 `DocumentEditorHandle`과 브리지 export는 호환됩니다. `const agent = createAgentBridge(() => editor)`로 DOM controller에도 같은 문서·세션·revision·선택 보호를 사용합니다. 이 브리지는 브라우저에 연결된 controller를 제어하며 서버에서 화면 없이 실행하는 Office 엔진이나 실제 LLM transport를 제공하지 않습니다.

## 앱의 UI 구성에 연결

0.2.19의 `ui.containers`는 툴바·상태 표시·추가 편집 도구를 앱이 만든 HTML 요소에 배치합니다. React와 DOM API에서 같은 옵션을 사용합니다. `tools`에는 문단·표·그림·찾기·보고서·업무 자동화 탭이 들어갑니다. 지정하지 않은 영역은 편집기 내부의 기본 위치에 표시합니다.

```ts
const ui = {
  containers: {
    toolbar: document.getElementById("document-toolbar")!,
    statusBar: document.getElementById("document-status")!,
    tools: document.getElementById("document-properties")!,
  },
  theme: { accent: "#6c3be9", radius: "4px", fontFamily: "inherit" },
};
// React: <DocumentEditor {...options} ui={ui} />
// DOM: await mountDocumentEditor(host, { ...options, ui });
await editor.update({ ui: { ...ui, theme: { ...ui.theme, accent: "#005c53" } } });
```

대상은 같은 document에 연결된 호스트 소유 HTMLElement여야 합니다. SDK 내부 요소나 분리된 DOM을 지정하면 거절합니다. 대상의 기존 자식은 유지하고 SDK가 만든 영역만 추가·이동·제거합니다. 배치나 테마 변경으로 엔진을 재마운트하지 않으며, 도구 영역 이동에도 입력 중인 폼과 포커스를 유지합니다. 오류·저장 경고·초안 복구·확인창은 편집기 본체에 남습니다. 종료 전 `destroy()`를 기다린 뒤 앱의 대상 DOM을 제거하세요. React 호스트도 상위 라우트가 DOM을 제거하기 전에 `flushDraft()`로 종료를 준비해야 합니다.

`update({ ui })`는 `ui` 객체 전체를 교체합니다. 일부 테마나 대상만 바꿀 때는 위 예제처럼 유지할 설정도 함께 전달하세요.

외부 `tools`의 크기와 화면 전환은 호스트가 소유합니다. SDK의 도킹 크기 슬라이더·자동 전체 확장은 적용하지 않습니다. 좁은 화면에서는 원본 입력이 가려지지 않도록 충분한 높이와 세로 스크롤을 제공하세요. [일반 JavaScript·Vue 예제](../examples/browser/main.ts)는 도구 영역을 조건부로 열고 모바일에서 520px 높이로 문서 아래에 배치합니다. 이 수치는 모든 글꼴·배율·호스트에서의 최소 높이를 보증하는 값은 아닙니다.

`ui.theme`의 선택 항목은 `accent`, `accentForeground`, `background`, `panel`, `text`, `muted`, `border`, `radius`, `fontFamily`입니다. 색과 길이는 CSS 값으로 전달하며, 편집기와 분리된 영역에 함께 적용됩니다. `appearance="embedded"`는 기본적으로 앱의 `--primary`, `--foreground`, `--background`, `--border`, `--radius` 등 디자인 토큰을 따릅니다. 문서 내용 자체의 글꼴·색·용지 확대를 바꾸는 옵션은 아닙니다.

React 앱은 `slots.toolbar`와 `slots.statusBar`로 자체 컴포넌트를 사용합니다.

```tsx
import type { EditorUISlots } from "@document-studio/react";

const slots: EditorUISlots = {
  toolbar: ({ defaultContent, openTools }) => (
    <div className="my-document-toolbar">
      <MyButton onClick={() => openTools("automation")}>업무 자동화</MyButton>
      {defaultContent}
    </div>
  ),
  statusBar: ({ snapshot, setZoom }) => (
    <div>
      <span>{snapshot.pageCount}쪽</span>
      <MyButton onClick={() => setZoom(1)}>100%</MyButton>
    </div>
  ),
};
```

슬롯은 `snapshot`, `readOnly`, `defaultContent`, `execute`, `openTools`, `closeTools`, `toolsOpen`, `nativeTools`, `setNativeTools`, `fitWidth`, `setZoom`를 받습니다. `execute`는 공개 controller와 같은 권한·저장·선택 검사를 거치며 Promise 실패를 앱이 표시해야 합니다. 각 버튼의 활성화 상태는 `snapshot.commands`에서 확인하세요. `openTools`의 탭은 `text`, `paragraph`, `table`, `image`, `page`, `search`, `presets`, `automation`입니다. `setZoom`은 배수 또는 `"width"`를 받습니다.

슬롯의 렌더링이 실패하면 해당 영역의 기본 UI로 복구하고 편집기에 오류를 표시합니다. 문서 엔진은 유지됩니다. DOM API는 React 슬롯 함수를 받지 않습니다. 일반 JavaScript·Vue에서는 영역을 배치하고 자체 버튼을 기존 controller의 `execute`/`save`와 연결하세요. 브리지·저장 계약과 실제 LLM transport 범위는 기존과 같습니다.
