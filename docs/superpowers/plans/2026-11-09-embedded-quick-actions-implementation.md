# Embedded Quick Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 플랫폼 안에서 문서를 보면서 빠른 작업을 선택하고, 날짜 결과와 적용 버튼을 스크롤 없이 확인할 수 있게 한다.

**Architecture:** 기존 `DocumentEditor → EditorRegion → EditingTools → QuickActionTools` 경로에 빠른 작업 전용 패널을 구성한다. `QuickActionTools`는 선택한 작업과 결과만 렌더링하고, 기존 `AutomationSession`과 `createQuickActionEditor`가 입력 보관 및 적용을 담당한다.

**Tech Stack:** React, TypeScript, SDK CSS 컨테이너 쿼리, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-09-embedded-quick-actions-design.md` 검토용 초안.

## Global Constraints

- SDK React 패키지에서 작업하고 플랫폼의 기존 `context.openTools("quick")`와 `ui.containers.tools` 계약을 사용한다.
- 기본 작업은 `날짜·기간`이다. 기본 날짜 선택은 `오늘`, `이번 주`, `다음 주`이고 그 외 날짜와 설정은 `더보기`에 둔다.
- 1100px 이하에서는 하단 배치, 그보다 넓으면 옆 배치다. 하단 패널은 작업 영역의 45%와 220px 중 작은 값으로 제한한다.
- 320×400px 이상인 작업 영역에서 기본 날짜 버튼과 날짜 결과·적용을 스크롤 없이 확인한다.
- 결과와 `적용`은 패널의 스크롤 영역 바깥에 둔다. 미리보기와 적용을 기존 코어 API로 호출하고 서버 저장은 기존 경로를 따른다.
- 입력은 `QUICK_ACTION_DRAFT_NAME` 아래의 기존 `AutomationSession`에 저장한다. 문서·세션·버전·선택 검증과 단일 적용 가드를 유지한다.

## Review Focus

- 넓은 브라우저 안에 560px 편집기가 있을 때에도 문서와 실제로 누를 수 있는 날짜 결과가 동시에 보여야 한다. Task 2의 기하 시험.
- 확대된 업무 자동화에서 빠른 작업으로 들어오면 문서가 보여야 하고 `Esc`는 진입 버튼으로 돌아가야 한다. Task 1의 전환 시험.
- 미리보기 뒤의 선택 변경이나 읽기 전용 전환은 이전 결과 적용을 막아야 한다. Task 2의 선택·권한 회귀 시험.
- 긴 원고와 반복 적용 클릭에도 적용 버튼이 보여야 하고 문서 변경은 한 번만 일어나야 한다. Task 2의 긴 원고 시험.
- 패널을 닫거나 문서를 바꿨을 때 저장한 입력과 이전 미리보기의 수명이 섞이지 않아야 한다. Task 2의 복구 회귀 시험.

## Task 1. 빠른 작업이 문서를 가리지 않도록 SDK 패널 배치 변경

**Files**

- Modify `packages/react/src/document-editor.tsx` — 도구 진입, 확대 상태, 포커스 복귀.
- Modify `packages/react/src/editing-tools.tsx` — 빠른 작업의 패널 헤더와 전체 도구 복귀.
- Modify `packages/react/src/styles.css` — 컨테이너 폭 기반 배치와 패널 높이.
- Modify `apps/playground/src/ui-harness.tsx` — 플랫폼과 같은 `context.openTools("quick")` 버튼 추가.
- Create `tests/e2e/embedded-quick-actions.spec.ts` — 플랫폼과 비슷한 편집 영역에서 브라우저 동작 검증.
- Modify `tests/e2e/embedded-preview-width.spec.ts`, `tests/e2e/ui-slots.spec.ts` — 일괄 생성 진입 및 외부 도구 슬롯 검증.

**Interfaces**

- `DocumentEditor` 내부 `showTools(tab: EditorToolTab, trigger?: HTMLElement): void`를 기본 빠른 작업 버튼과 호스트의 `EditorUIContext.openTools`가 함께 사용한다. 선택 탭 설정은 내부 `selectToolsTab(label: string): void`로 모아 빠른 작업 진입 시 확대를 해제한다.
- `EditingTools` 내부 props에 `compactQuickActions?: boolean`을 추가한다. `appearance === "embedded"`에서만 활성화하고 현재 탭이 빠른 작업일 때 루트에 `data-quick-actions="compact"`를 붙인다. 나머지 도구는 기존 구조를 사용한다. 빠른 작업 본문은 기존 `QuickActionTools` 경로를 유지한다.

- [ ] **RED.** `embedded-quick-actions.spec.ts`에 DOCX·HWPX 각각 `quick actions leaves expanded automation and returns focus`를 추가한다. `/harness.html`에서 `embedded = true`인 560×514px 편집기를 열고 `업무 자동화`의 `data-expanded="true"`를 확인한다. `빠른 작업` 버튼을 누른 뒤 `.ds-editing-tools`의 `data-expanded`가 `false`, 문서 본문 높이가 양수이며 패널과 겹치지 않음, `문서 도구` 진입 시 `문단` 탭을 선택함을 확인한다. 다시 빠른 작업을 열고 패널 안에서 `Esc`를 눌러 닫힌 상태와 빠른 작업 버튼 포커스를 확인한다.
- [ ] **RED.** `ui-harness.tsx`의 커스텀 툴바에 `앱 빠른 작업` 버튼을 추가해 `context.openTools("quick")`을 호출한다. `ui-slots.spec.ts`에 `host quick action keeps the tool slot and returns focus`를 추가한다. `#top`의 버튼으로 연 빠른 작업이 외부 `#side` 안에 표시되고, `닫기` 후 `앱 빠른 작업` 버튼이 다시 포커스를 받는지 확인한다. 빠른 작업 헤더의 `문서 도구`가 있어야 한다.
- [ ] PowerShell에서 `$env:DOCUMENT_STUDIO_TEST_SERVER='bundle'; yarn test:e2e embedded-quick-actions.spec.ts ui-slots.spec.ts --project=chrome`을 실행한다. 기존 확대 상태가 빠른 작업에도 이어지거나 `문서 도구`가 없어 새 시험이 실패해야 한다.
- [ ] `document-editor.tsx`에서 빠른 작업으로 들어가는 두 버튼 경로와 전체 도구 탭 전환에 같은 탭 설정을 적용한다. 확대 해제는 상태에서 처리한다. 기본 버튼은 `event.currentTarget`, 호스트 버튼은 기존 `activeElement` 경로로 복귀 대상을 기록한다. `editing-tools.tsx`의 자동 확대 대상에서 빠른 작업을 빼고, 내장 빠른 작업에 제목·`문서 도구`·닫기만 남긴다. 기존 `편집 도구 닫기` 접근성 이름을 재사용한다.
- [ ] `styles.css`의 컨테이너 쿼리에서 내장 빠른 작업의 하단 패널에 `flex-basis: min(220px, 45%)`와 같은 높이 상한을 적용한다. 외부 도구 포털은 호스트 컨테이너의 배치 규칙을 따른다. `embedded-preview-width.spec.ts`에서 일괄 생성에 들어가는 사용자 경로를 업데이트한다.
- [ ] 같은 시험에 `automation-workspace.spec.ts`, `embedded-ui.spec.ts`, `embedded-preview-width.spec.ts`, `ui-slots.spec.ts`를 추가해 실행한다. 빠른 작업 전환과 기존 자동화 확대 및 외부 도구 이동 시험이 통과해야 한다.
- [ ] 커밋 `feat: dock embedded quick actions beside the document`.

## Task 2. 선택한 작업의 결과와 적용을 함께 표시

**Files**

- Modify `packages/react/src/quick-actions-tools.tsx` — 작업 선택, 접힌 설정, 결과와 적용, 상태 안내.
- Modify `packages/react/src/styles.css` — 결과 영역과 스크롤 영역 분리.
- Modify `tests/e2e/embedded-quick-actions.spec.ts` — 날짜·선택·긴 원고의 실제 사용 흐름.
- Modify `tests/e2e/quick-action-recovery.spec.ts`, `tests/e2e/beomoffice-workflows.spec.ts`, `tests/e2e/agent-session-tools.spec.ts` — 새 작업 선택 경로로 기존 복구·가드 시험 갱신.

**Interfaces**

- `QuickActionTools`의 기존 props를 사용한다. 내부 작업 상태는 `"date" | "preset" | "cleanPaste"`이며 기본값은 `"date"`다. 기존 `actions.preview(request: QuickActionRequest): QuickActionPreview`와 `actions.apply({ previewId, operationId }): Promise<QuickActionReceipt>`를 그대로 호출한다.
- UI에서 기존 `빠른 작업 미리보기` 이름을 결과 영역에 유지하고, 실행 버튼의 이름은 `적용`으로 맞춘다. 날짜 입력은 기존 접근성 이름을 유지한다.

- [ ] **RED.** 같은 시험에 DOCX·HWPX 각각 `today shows the result and apply without scrolling in a narrow host`를 추가한다. 1366×900px 브라우저에서 플랫폼 사례인 1023×646px 내장 편집기와 560px 내장 편집기를 검증한다. 가장 좁은 경우 작업 영역을 320×400px로 제한한다. 고정 기준일 `2026-11-09`와 공문 형식으로 `오늘`을 누른 후 `2026. 11. 9.(월)`과 `적용`이 패널 및 브라우저 사각형 안에 들어오고, `elementFromPoint`가 적용 버튼을 맞히며 스크롤이 증가하지 않음을 확인한다. 좁은 경우 문서 본문 높이가 작업 영역의 55% 이상인지 확인한다. 미리보기 전후에 문서 내용과 `selectionKey`가 같아야 한다.
- [ ] **RED.** `long cleanup keeps apply reachable and inserts once`를 추가한다. 긴 여러 줄 원고를 입력해 미리보기 후 결과와 적용 버튼이 상세 스크롤 바깥에 있는지 확인한다. 적용을 연속 요청해도 정리된 원고가 한 번만 들어가고, 한 번 되돌리면 적용 전 텍스트로 복귀하는지 확인한다. 기존 서식 UI 시험에는 선택 변경 후 `적용` 비활성화 및 새 미리보기 후 적용을 유지한다. 내장 시험에는 미리보기 이후 `window.documentStudioTest.readOnly = true` 및 `rerender()`로 권한을 바꾸면 `적용`이 비활성화되는 경우를 추가한다.
- [ ] `$env:DOCUMENT_STUDIO_TEST_SERVER='bundle'; yarn test:e2e embedded-quick-actions.spec.ts --project=chrome`을 실행한다. 현재 배치에서 좁은 영역의 날짜 결과·적용 버튼이 한 화면에 들어오지 않아 새 시험이 실패해야 한다.
- [ ] `QuickActionTools`에서 세 작업 종류 중 선택한 것만 그린다. 날짜의 나머지 옵션과 입력 관리는 접어서 표시한다. 본문에 옵션과 긴 미리보기 상세를 두고 결과 요약 및 `적용`을 별도 하단 영역에 둔다. 날짜 값은 잘림 없이 줄바꿈하고, 원고 요약과 선택 문구는 한 줄로 제한한다. 전체 원고 결과와 줄별 변경은 본문 스크롤에서 제공한다. 결과 요약과 적용 완료·실패를 `aria-live="polite"`로 알린다.
- [ ] 기존 draft read/write와 입력 필드 유효성 검사를 이어 사용한다. 작업 종류·입력 변경 및 컴포넌트 재마운트 시 미리보기를 초기화한다. UI의 적용 가능 판단에 미리보기의 `documentId`, `sessionId`, `revision`, `selectionKey` 및 현재 읽기 전용 상태를 반영한다. 기존 `quick-ui:${previewId}` 및 동기 `running` 잠금을 재사용한다. 완료 시 포커스가 사라질 적용 버튼에만 있었다면 미리보기 버튼으로 복귀한다.
- [ ] 기존 시험을 새 경로에 맞춘다. 원고 입력은 `원고 정리`를, 날짜 설정은 `날짜·기간 → 더보기`를 먼저 선택한다. 기존 탭 및 패널 닫기, 다른 문서 전환, 보관 오류 이후의 입력 보존 검증은 유지한다. 테스트의 `적용` 로케이터는 결과 영역에 한정한다.
- [ ] `$env:DOCUMENT_STUDIO_TEST_SERVER='bundle'; yarn test:e2e embedded-quick-actions.spec.ts quick-action-recovery.spec.ts beomoffice-workflows.spec.ts agent-session-tools.spec.ts --project=chrome`과 `yarn test tests/unit/quick-actions.test.ts`, `yarn typecheck`, `yarn build`를 실행한다. 새 흐름과 기존 미리보기·적용·복구가 모두 통과해야 한다. Edge에서도 `embedded-quick-actions.spec.ts`를 실행한다.
- [ ] 커밋 `feat: surface quick action results next to the document`.

## 플랫폼 적용 전 확인

- [ ] 기존 SDK 패키징 절차로 소비용 빌드를 만들고, 검증용 플랫폼 프론트에서 기존 `openTools("quick")` 진입으로 연다. 브라우저 시험과 별도로 검증용 HWP 문서에서 채팅을 나란히 둔 채, 좁은 편집 폭과 문서 크게 보기 상태를 확인한다.
- [ ] `오늘` 선택 후 날짜와 적용 버튼이 함께 보이고 문서의 커서나 선택 범위를 확인할 수 있는지 점검한다. 적용 → 한 번 되돌리기 → 명시적으로 저장하는 순서로 검증용 문서의 편집 상태와 파일 저장이 구분되는지 확인한다. 키보드로 열기·선택·적용·닫기와 실제 진입 버튼으로의 포커스 복귀도 확인한다.
- [ ] SDK 코드의 변경과 플랫폼 소비 검증 결과를 함께 리뷰한다. 공유 개발 서버 패키지 반영은 별도 릴리스 단계로 다룬다.
