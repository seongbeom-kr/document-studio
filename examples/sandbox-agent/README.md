# 기존 앱에 넣는 연결 예제

`document-pane.tsx`는 샌드박스 앱의 기존 파일 탭·모달 안에서 쓰는 React 편집 컴포넌트입니다. 파일 목록·라우팅·인증·파일 읽기는 소비 앱이 담당하며, 이 예제는 편집 pane과 저장 연결을 제공합니다.

호스트에서 읽은 `EditorDocument`를 전달하고, `storage.ts`의 `SandboxHost`에 기존 `uploadWorkspaceFile`, 파일 갱신, lease 조회와 편집 가능 상태를 연결합니다. 문서의 `version`은 원본 digest이며 `draftNamespace`에는 사용자·세션 식별자를 포함합니다. `host`와 문서 객체는 렌더마다 재생성하지 않습니다.

`SandboxHost.documentId`에는 저장 대상 파일에 대응하는 문서 ID를 지정합니다. 저장할 EditorDocument의 ID와 다르면 업로드를 시작하지 않습니다. 소비 앱이 문서와 저장소를 각각 갱신하는 동안 이전 문서가 다른 파일에 저장되는 일을 막습니다. 실제 프론트 연결에서는 사용자별 namespace와 SDK의 `readOnly`를 편집권 상태에 연결합니다.

```tsx
<SandboxDocumentPane
  ref={editorRef}
  document={openedDocument}
  host={sandboxHost}
  studioUrl="/editor-assets/rhwp/index.html"
  draftNamespace={`sandbox:${userId}:${sessionId}`}
  onDirtyChange={setUnsaved}
  onStateChange={setEditorState}
  readOnly={!hasEditLease}
  onSaved={handleSaved}
  onClose={closeFileTab}
  onAgentChange={setDocumentAgent}
/>
```

위 변수는 소비 앱이 소유합니다. `editorRef`는 `useRef<DocumentEditorHandle>(null)`로 만듭니다. `onAgentChange`에서 받은 bridge는 준비 상태를 확인한 뒤 앱의 기존 에이전트 transport에 연결합니다. 저장소 원본 갱신에 맞춰 컴포넌트 key를 version으로 바꾸지 않습니다.

외부 파일 탭을 바꾸거나 제거할 때는 실제 전환 직전 `editorRef.current.getState()`의 현재 문서 ID와 dirty를 확인합니다. 전환을 결정하면 `await editorRef.current.flushDraft()` 후 탭을 바꿉니다. 실패하면 현재 탭을 유지하고 오류를 표시합니다. 비동기 파일 읽기를 시작한 렌더의 dirty로 전환을 판단하지 않습니다. `DocumentEditor`의 명시적인 '변경 버리고 닫기' 동작은 초안을 삭제하는 별도 선택입니다.

`handleSaved`에는 실제 저장 bytes와 documentId·version·revision·warnings가 전달됩니다. 호스트는 열린 문서와 파일 목록의 bytes·version을 같은 저장본으로 갱신하고 필요하면 서버 목록을 다시 조회합니다. `sandboxSyncWarning`이 있어도 서버 digest를 반환하므로 저장 버전은 진전되고 문서는 저장 완료 상태가 됩니다. 경고는 `warnings`의 `sandbox-sync-pending` 코드로 별도 표시됩니다.

동기화 경고를 받은 파일은 기존 호스트의 샌드박스 동기화 작업에서 재시도합니다. `storage.save()`를 동기화 재시도 수단으로 호출하지 않습니다. 이 예제는 운영 서버의 동기화 endpoint를 새로 정의하거나 자동으로 문서를 재업로드하지 않습니다. 이후 문서를 새로 편집해 저장할 때는 SDK가 마지막 저장 digest를 `expectedVersion`으로 전달합니다.

HWPX 엔진의 정적 JS·WASM은 라이브러리에 포함됩니다. 소비 앱 루트에서 `document-studio-rhwp-assets`를 실행해 기존 정적 파일 디렉터리에 복사합니다. 별도 Document Studio 서버를 띄우지 않습니다.

이 파일은 연결 방법을 보여 주는 소비 예제이며 운영 검증 결과가 아닙니다. 별도 프론트 브랜치의 실제 SDK 연결과 아직 남은 인증·BFF·lease 시험은 [0.2.1 통합 검증 기록](../../docs/review-fixes-0.2.1-2026-10-05.md)에 기록했습니다.
`appearance="embedded"`를 사용하므로 문서 제목·저장·닫기는 호스트 UI가 제공합니다. 저장 버튼은 `await editorRef.current.save()`, 현재 편집본 다운로드는 `exportDocument()`와 `downloadDocument()`를 연결합니다. `onStateChange`의 ready·dirty·busy·saving으로 버튼과 저장 상태를 표시하고, 실제 실행 전 getState()를 다시 확인합니다.
