# 패키지 빌드와 소비

`0.3.0-beta.1`부터 공개 후보는 명시적 prerelease 버전을 사용합니다. npm에 게시할 때는 `beta` dist-tag로 분리하며, `latest`를 베타로 이동하지 않습니다. 현재 작업은 GitHub 소스와 로컬 tarball 검증이며 npm registry 게시는 별도입니다. 정식 출시는 API 안정성·실제 호스트 통합·업무 문서 호환성 검증 이후 `1.0.0-rc.*`를 거쳐 `1.0.0`으로 진행합니다. 번호 변경만으로 정식 수용 검사를 통과한 것으로 간주하지 않습니다.

React 연결은 기존 네 SDK 패키지를 사용합니다. DOM 연결은 `@document-studio/browser`를 함께 설치합니다. 별도 Document Studio 서비스는 필요하지 않습니다. `apps/playground`는 private 개발 예제입니다. 호스트는 사용자·문서 ID·저장소 version·초안 namespace·문서 전환·파일 목록을 소유합니다.

로컬 검증 tarball은 `.build/packs/core.tgz`, `react.tgz`, `engine-docx.tgz`, `engine-rhwp.tgz`, `browser.tgz`입니다. React 소비 앱에서 앞의 네 파일을 함께 설치하고 RHWP 자산을 자신의 public 디렉터리에 복사합니다. 각각의 immutable hash 파일은 검증 cache 구분용이며 최신 패키지는 고정 이름 파일입니다.

[README의 준비·빌드](../README.md#시작하기)를 마친 뒤 `yarn verify:packages`를 실행하면 다섯 tarball을 생성하고 별도 소비 앱에서 검증합니다. 브라우저 검증 없이 tarball만 만들려면 각 workspace에서 `yarn pack --out <출력 파일의 절대 경로>`를 실행할 수 있습니다. 예: `yarn workspace @document-studio/core pack --out /absolute/output/core.tgz`. 패키지를 같은 소스 버전에서 함께 생성하세요.

```sh
npm install /path/to/core.tgz /path/to/react.tgz /path/to/engine-docx.tgz /path/to/engine-rhwp.tgz
npx document-studio-rhwp-assets public/editor-assets/rhwp
```

DOM 호스트에서는 위 설치에 `/path/to/browser.tgz`를 추가하고 `@document-studio/browser/styles.css`를 import합니다. React 런타임과 선언 파일은 browser 패키지의 의존성으로 설치됩니다. 일반 JS/Vue 예제는 `examples/browser/`이며 빌드한 패키지와 RHWP 자산을 사용합니다.

React 컴포넌트 연결에서는 React 19와 React DOM 19가 host peer입니다. `@document-studio/react/styles.css`를 import하고 안정적인 document id와 원본 bytes/version을 전달합니다. 현재 문서의 version으로 `key`를 만들지 않습니다. 문서 ID가 바뀌는 host 전환은 `flushDraft()`를 기다린 뒤 수행합니다. `onSaved`의 bytes와 version을 함께 목록에 반영합니다. 새 보고서 factory의 `onCreateDocument`도 같은 전환 정책을 사용합니다.

0.2.4의 저장 후 종료 경로는 `save({ onlyIfDirty: true })`를 항상 기다립니다. SDK는 새 입력을 막고 진행 중인 명령을 기다린 뒤 dirty를 판단합니다. 호스트는 성공 후 sessionId와 권한, dirty, 동기화 경고를 다시 확인합니다. 동일 digest 저장도 승인된 바이트 내용과 현재 세션을 확인해 원본 props 갱신을 받아들입니다. 같은 version의 다른 내용은 계속 전환 승인이 필요합니다.

에이전트는 `createAgentBridge()`로 지원/활성 명령·valueSchema를 조회합니다. documentId·expectedSessionId·expectedRevision으로 쓰기를 보호합니다. 0.2.3부터 쓰기 요청의 expectedSessionId는 필수이며 getState()/search()가 반환한 sessionId를 전달합니다. 같은 원본 버전으로 다시 열어도 새 세션 ID를 발급합니다. expectedVersion을 전달하면 저장소 버전도 검증합니다. 그림의 JSON byte 배열은 host transport에서 Uint8Array로 변환합니다. DOCX·HWPX 모두 바꾸기는 하나의 native undo 단계입니다. 기본 엔진의 preset은 하나의 native 작업으로 실행합니다. 외부 엔진의 순차 fallback은 전체 하나의 Undo가 아닙니다.

소스는 [GitHub 저장소](https://github.com/seongbeom-kr/document-studio)에 공개했으며 npm registry 게시 전입니다. npm 공개 전에는 scope 소유권과 package metadata를 확인하고 검증된 버전·자산·notice·lock을 사용합니다. 실제 registry 게시 후에도 같은 외부 소비 시험을 실행합니다. 최신 저장·전환·초기화·에이전트 계약은 [호스트 통합 안내](integration.md), 지원 범위와 근거는 [검증 기록](practical-validation.md), [기능 범위](feature-support.md), [정부 기능 대응](government-office-reference.md), [라이선스](licensing.md)를 참고하세요.

이 버전의 파일 처리·저장 보호와 공개 패키지 근거는 갖췄지만, 기관 업무 문서 도입 전 실제 corpus와 한컴 native·물리 IME·운영 저장 계약을 확인해야 합니다. Windows 전용 정부 오피스의 전체 기능을 동일하게 제공하는 완료판으로 홍보하지 않습니다.

0.2.5에서는 검색 조건, 문서 revision, 편집 세션이 바뀌면 이전 결과와 선택을 무효화하고 늦은 응답을 버립니다. DOCX 강조색은 엔진의 `CommandState.valueChoices`와 `valueSchema`로 16색을 안내합니다. `createAgentBridge().listCommands()`도 엔진별 schema를 반환합니다. 글자색과 HWPX 강조색은 자유 RGB 입력을 유지합니다.

서식 preset은 각 명령 전후에 세션, 원본, 권한과 현재 명령 지원 여부를 확인합니다. 읽기 전용으로 한 번 전환되면 권한이 곧 복구되어도 진행 중 preset은 중단됩니다. `PresetApplicationError`의 `completedCommands`와 `totalCommands`로 중단 지점을 확인합니다. 0.2.6 기본 엔진은 한 번 Undo/Redo와 적용 거절 시 롤백을 제공합니다. 외부 엔진이 executePreset을 제공하지 않는 경우 순차 fallback이 적용되며 이미 확인된 단계는 남을 수 있습니다. 연결 실패는 실행 결과가 불확실할 수 있으므로 문서 상태를 먼저 확인합니다.

Windows에서 전체 브라우저 회귀 시험을 실행할 때는 `DOCUMENT_STUDIO_TEST_SERVER=bundle`을 사용하면 테스트 화면을 먼저 번들하고 정적 서버에서 실행합니다. 개발 모듈별 요청과 HMR 연결을 줄이며 테스트 케이스와 검증값은 그대로 유지합니다. `DOCUMENT_STUDIO_TEST_PORT`로 비어 있는 전용 포트를 지정합니다. 번들 모드는 기존 서버를 재사용하지 않습니다.

```powershell
$env:DOCUMENT_STUDIO_TEST_SERVER = 'bundle'
$env:DOCUMENT_STUDIO_TEST_PORT = '4182'
yarn test:e2e
```

0.2.6은 소수 둘째 자리 표시와 원래 수치 보존, 기능별 자동화 입력과 `listAutomationForms()`, 그림 원본 비율 유지·본문 폭 맞춤을 제공합니다. RHWP JS 이력 묶음은 고정 MIT 소스를 SDK 빌드 플러그인으로 확장하며 SHA-256을 runtime provenance에 기록합니다. 공개에 필요한 기존 notice와 의존성 라이선스는 각 tarball에 포함합니다.

0.2.7은 자동화 입력을 기능별·편집 세션별로 보관하고 예제를 명시적으로 초기화합니다. 생성 도중 원본이나 권한이 바뀌면 이전 결과의 호스트 콜백을 취소하며, 호스트 콜백 실패 후 같은 미리보기의 재시도에는 같은 생성 문서 ID를 전달합니다. 샌드박스 연결은 저장 완료 파일을 재업로드하지 않고 동기화·목록 갱신·열기만 재시도합니다.

0.2.8은 HWPX 내부 입력 차단, 중첩 가능한 `acquireInputLock()`과 편집 세션별 잠금 수명을 추가합니다. 샌드박스는 마지막 저장부터 lease 해제·문서 전환까지 잠금을 유지하고, 이전 문서의 늦은 저장 콜백이 현재 미저장 상태를 바꾸지 않도록 검증합니다. 검증 범위와 재현 시험은 [0.2.8 수정 기록](review-fixes-0.2.8-2026-10-07.txt)에 있습니다.
