<p align="center">
  <img src="docs/assets/banner.svg" alt="Document Studio — 앱에 넣어 쓰는 HWPX·DOCX 문서 편집기 SDK" width="1280" />
</p>

<p align="center"><strong>내 앱의 디자인으로. HWPX와 DOCX를 한 곳에서. 사람과 에이전트가 같은 API로.</strong></p>

<p align="center">
  <a href="https://github.com/seongbeom-kr/document-studio/actions/workflows/verify.yml"><img src="https://github.com/seongbeom-kr/document-studio/actions/workflows/verify.yml/badge.svg?branch=main" alt="Verify CI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-6d8fe0?style=flat" alt="Apache-2.0 license" /></a>
  <a href="packages/core"><img src="https://img.shields.io/badge/TypeScript-typed_API-3178c6?style=flat" alt="TypeScript API" /></a>
  <a href="docs/releases/0.3.0.md"><img src="https://img.shields.io/badge/release-0.3.0-287d68?style=flat" alt="Document Studio 0.3.0" /></a>
</p>

<p align="center">
  <a href="#시작하기">시작하기</a> · <a href="docs/integration.md">통합 가이드</a> · <a href="#에이전트-api">에이전트 API</a> · <a href="docs/feature-support.md">지원 기능</a> · <a href="#기여하기">기여하기</a>
</p>

<p align="center"><strong>한국어</strong> · <a href="README.en.md">English</a></p>

---

**Document Studio**는 웹 프론트 앱에 넣어 쓰는 오픈소스 문서 편집기 SDK입니다. HWPX·DOCX 편집, 문단·표 서식, 업무 자동화, 저장·초안 복구를 공통 UI와 TypeScript API로 연결합니다. React 컴포넌트 또는 일반 JavaScript·Vue용 DOM API를 사용할 수 있습니다.

> **0.3.0 릴리즈:** 소스 빌드와 tarball로 설치합니다. npm registry에는 아직 게시하지 않았습니다. [릴리즈 범위와 설치 안내](docs/releases/0.3.0.md)를 확인하고, 아래의 로컬 playground에서 직접 실행할 수 있습니다.

## 화면으로 보기

![HWPX 문서와 선택한 표 열의 변경 전후 값·제외 셀을 함께 보여주는 Document Studio](docs/assets/editor-hwpx.png)

_실제 SDK 실행 화면 · 가상 보고서의 금액에는 쉼표를 제안하고, 앞자리 0이 있는 식별자와 날짜는 제외합니다. 적용 전 변경 내용을 확인할 수 있습니다._

<details>
<summary><strong>DOCX 편집 화면도 보기</strong></summary>

![DOCX 보고서와 공통 문단 서식 도구](docs/assets/editor-docx.png)

_같은 툴바와 속성 패널로 DOCX의 문단·행간·페이지·표를 편집합니다. 두 형식의 조판이 완전히 같다는 뜻은 아닙니다._

</details>

## 앱에 맞추고, 문서에 집중하세요

- **내 앱의 UI에 연결합니다.** `appearance="embedded"`, `ui.containers`, `ui.theme`, React `slots`로 기존 헤더·버튼·패널에 편집기를 배치합니다.
- **버튼과 에이전트가 같은 경로를 씁니다.** 사람이 누르는 기능을 공통 컨트롤러로 제공하고, 에이전트 명령은 문서·세션·revision·선택 범위를 확인합니다.
- **변경과 저장을 구분합니다.** 표 가공은 변경·제외 셀을 먼저 보여줍니다. 원본 저장, 입력 초안 보관, 생성 사본 반출은 별도 상태로 관리합니다.

| 하고 싶은 일         | 제공하는 기능                                                                 |
| -------------------- | ----------------------------------------------------------------------------- |
| 문서 서식 맞추기     | 글꼴·크기·강조, 문단·행간·들여쓰기, 페이지 설정, 표·그림, 검색·치환           |
| 표 자료 정리하기     | 선택한 열의 쉼표·문자열 치환·접두/접미사·공백 정리, 변경 미리보기와 일괄 Undo |
| 반복 업무 줄이기     | 날짜·기간 삽입, 보고서 서식, 표·명단 등 문서 생성 도구                        |
| 서식으로 사본 만들기 | 사용자 HWPX·DOCX 서식 + CSV/TSV, 필드 연결·파일명 검사·메일머지               |
| 편집본 보관하기      | 원본 형식 내보내기, 저장 충돌 처리, 초안 복구, 미보관 생성 사본 종료 보호     |
| 에이전트에 연결하기  | 명령·스키마 조회, 검색·선택, 보호 조건을 확인하는 편집·저장 API               |

[형식별 지원·제한 →](docs/feature-support.md) · [범정부 오피스 기능 대응 →](docs/government-office-reference.md)

## 시작하기

**Node.js 24.13+ · Yarn 4 · Git**이 필요합니다. 먼저 로컬 playground를 실행해 보세요.

```sh
git clone https://github.com/seongbeom-kr/document-studio.git
cd document-studio
corepack enable
yarn install --immutable
yarn assets:prepare
yarn build
yarn fixtures:generate
yarn dev:playground
```

브라우저에서 **http://127.0.0.1:4173**을 엽니다. Playground는 SDK를 살펴보는 개발 예제입니다. 자신의 앱에 넣을 때는 [tarball 생성·설치 안내](docs/release-guide.md)를 따르세요.

HWPX를 사용하는 소비 앱에는 설치된 패키지의 정적 런타임 자산을 복사합니다.

```sh
npx document-studio-rhwp-assets public/editor-assets/rhwp
```

## 앱에 연결

### React

React 19 앱에서 사용할 수 있습니다. 문서·저장 어댑터와 사용자·작업 공간별 초안 namespace는 호스트가 전달합니다.

```tsx
"use client";

import type { EditorDocument, DocumentStorage } from "@document-studio/core";
import { DocumentEditor } from "@document-studio/react";
import { docxEngine } from "@document-studio/engine-docx";
import { rhwpEngine } from "@document-studio/engine-rhwp";
import "@document-studio/react/styles.css";

const engines = [
  docxEngine(),
  rhwpEngine({ studioUrl: "/editor-assets/rhwp/index.html" }),
];

export function OfficeEditor(props: {
  document: EditorDocument;
  storage: DocumentStorage;
  draftNamespace: string;
}) {
  return (
    <div style={{ height: "80vh", minHeight: 480 }}>
      <DocumentEditor {...props} engines={engines} appearance="embedded" />
    </div>
  );
}
```

<details>
<summary><strong>일반 JavaScript·Vue에서는 DOM API 사용하기</strong></summary>

호스트에서 React 코드를 작성할 필요가 없습니다. `browser` 패키지가 내부 React 런타임을 의존성으로 설치합니다. 아래는 TypeScript 예제입니다.

```ts
import type { EditorDocument, DocumentStorage } from "@document-studio/core";
import { mountDocumentEditor } from "@document-studio/browser";
import { docxEngine } from "@document-studio/engine-docx";
import { rhwpEngine } from "@document-studio/engine-rhwp";
import "@document-studio/browser/styles.css";

export async function attachEditor(
  container: HTMLElement,
  document: EditorDocument,
  storage: DocumentStorage,
  draftNamespace: string,
) {
  const editor = await mountDocumentEditor(container, {
    document,
    storage,
    draftNamespace,
    engines: [
      docxEngine(),
      rhwpEngine({ studioUrl: "/editor-assets/rhwp/index.html" }),
    ],
  });
  await editor.whenReady();
  return editor;
}
```

컨테이너에 높이를 지정하세요. 문서 교체는 `await editor.update({ document: nextDocument })`, DOM 제거 전에는 `await editor.destroy()`를 사용합니다. [Vue 예제와 DOM 연결 계약](docs/integration.md#dom-api로-연결)을 참고하세요.

</details>

**저장·종료 연결도 함께 구현하세요.** `EditorDocument`는 안정적인 `id`, `fileName`, `format`, `bytes`와 선택적인 `version`을 갖습니다. 저장 어댑터는 `expectedVersion`을 원자적으로 확인하고 새 `version`을 반환해야 합니다. React 호스트는 라우트·탭을 제거하기 전에 `flushDraft()`를 기다립니다. 미보관 생성 사본이 있으면 다운로드 보관 확인 또는 명시적 폐기가 필요합니다.

[저장·복구·문서 전환 가이드 →](docs/integration.md) · [생성 사본 보관 계약 →](docs/generated-output-lifecycle-0.2.23.txt)

## 에이전트 API

**조회 → 검색·선택 → 명령 실행 → 결과 확인 → 저장.** 에이전트 브리지는 현재 편집기와 같은 컨트롤러를 사용합니다. 다음은 이미 선택된 문단의 행간을 150%로 바꾸는 예제입니다.

```ts
import {
  createAgentBridge,
  type EditorController,
} from "@document-studio/core";

export async function setSelectedParagraphSpacing(editor: EditorController) {
  const agent = createAgentBridge(() => editor);
  const state = agent.getState();
  if (!state.selectionKey) throw new Error("먼저 편집할 범위를 선택하세요.");

  await agent.execute({
    documentId: state.documentId,
    expectedSessionId: state.sessionId,
    expectedRevision: state.revision,
    expectedSelectionKey: state.selectionKey,
    command: { id: "lineSpacing", value: 1.5 },
  });
}
```

`listCommands()`로 현재 지원·활성 명령과 입력 스키마를 확인할 수 있습니다. `execute()`는 편집 명령이며 서버 저장은 별도 `commit()` 경로로 연결합니다. LLM 서비스·인증·권한·transport는 호스트가 담당합니다.

[에이전트 연결과 저장 계약 →](docs/integration.md) · [표 열 가공 →](docs/table-column-editing-0.2.21.txt) · [빠른 작업·메일머지 →](docs/office-workflows-0.2.22.txt)

## 패키지 구성

| 패키지                                                 | 역할                                        |
| ------------------------------------------------------ | ------------------------------------------- |
| [`@document-studio/core`](packages/core)               | 공통 문서·제어·저장소 계약, 에이전트 브리지 |
| [`@document-studio/react`](packages/react)             | React 편집 UI, 호스트 UI에 연결하는 슬롯    |
| [`@document-studio/browser`](packages/browser)         | 일반 JavaScript·Vue 등의 DOM 연결           |
| [`@document-studio/engine-docx`](packages/engine-docx) | DOCX 엔진 어댑터                            |
| [`@document-studio/engine-rhwp`](packages/engine-rhwp) | HWP 5.x·HWPX 엔진 어댑터와 자체 호스팅 자산 |

## 지원 범위와 검증

현재 편집 대상은 **HWP 5.x·HWPX·DOCX**입니다. HWP 5.x는 beta.5부터 공통 UI와 글꼴 경로를 사용하고 원본 형식으로 저장합니다. 암호·배포 제한·DRM·전자서명 HWP와 HWP 3.x는 지원하지 않으며, 내보내기에서 내용 손실이 보고되면 저장을 차단합니다. 서식 일괄 생성은 DOCX·HWPX 대상이며, PPTX·XLSX 편집은 아직 지원하지 않습니다. 별도 편집기 서버 없이 실행하지만, 앱의 파일 목록·인증·저장소는 직접 연결해야 합니다.

**0.2.23 검증 기록:** SDK 단위 **459개**, Chrome·Edge E2E **830개**, tarball을 설치한 별도 Next.js·JavaScript·Vue 소비 앱 검증을 통과했습니다. 이 수치는 해당 버전의 기록이며 현재 CI 상태는 상단 배지에서 확인합니다.

실제 업무 문서 전체의 호환성, 한컴 설치본과 동일한 조판, 물리 IME, 소비 앱의 운영 저장·모델 연결은 별도로 확인해야 합니다. [검증 결과와 한계](docs/review-fixes-0.2.23.txt)를 공개하고 있습니다.

<details>
<summary><strong>개발 검증 명령 보기</strong></summary>

```sh
yarn typecheck
yarn test
yarn test:e2e
yarn audit:licenses
yarn audit:security
yarn build
yarn verify:packages
```

로컬 E2E는 설치된 Chrome·Edge를 사용합니다. CI용 Chromium 설정과 소비 검증 환경은 [배포 안내](docs/release-guide.md)에서 확인하세요.

</details>

## 기여하기

**문서 호환성, 앱 연결 예제, 접근성, 문서화**에 대한 기여를 환영합니다.

- **문제를 발견했나요?** [이슈 만들기](https://github.com/seongbeom-kr/document-studio/issues/new)에 재현 단계와 공개 가능한 최소 문서를 남겨 주세요.
- **원하는 기능이 있나요?** 문서 형식, 작업 흐름, 기대 결과를 함께 제안해 주세요.
- **직접 개선하고 싶나요?** [기여 가이드](CONTRIBUTING.md)를 읽고 PR을 보내 주세요. 버튼과 SDK API, 내보내기·재열기 검증을 함께 살펴봅니다.
- **프로젝트가 유용한가요?** Star로 관심을 표시하고, 어떤 앱에 연결하려는지 이슈로 알려 주세요.

업무·고객 문서와 인증 정보는 공개 이슈에 올리지 마세요. 보안 제보는 [보안 정책](SECURITY.md)을 따릅니다.

## 함께 만드는 오픈소스

### 기본 글꼴을 함께 배포하기

SDK에는 **Noto Sans KR·Noto Serif KR의 보통/굵게** 글꼴 팩이 포함됩니다.
글꼴은 외부 CDN 대신 앱의 정적 자산에서 읽습니다. HWPX 자산 복사 명령은
인접한 `editor-assets/fonts` 디렉터리에도 공통 팩을 함께 복사합니다.
DOCX만 사용하는 앱은 다음 명령으로 준비할 수 있습니다.

```sh
document-studio-font-assets public/editor-assets/fonts
```

다른 자산 경로는 `docxEngine({ fontBaseUrl })`,
`rhwpEngine({ studioUrl, fontBaseUrl })`로 지정합니다. 편집기 하단의 글꼴
상태와 에이전트 `getContext().fonts`에서 대체 결과와 자산 오류를 확인할 수 있습니다.
문서의 원래 글꼴명은 유지하며, 원본 글꼴이 없는 경우 모양·줄바꿈이 달라질 수 있습니다.
기본 팩은 전용 기호·고정폭 글꼴을 포함하지 않습니다.

PDF 서버에도 같은 팩과 버전을 설치해야 합니다. 파일별 해시, 원본 출처,
변환 내역과 **OFL-1.1** 고지는 패키지의 `dist/fonts/`에 포함됩니다.
SDK 코드는 Apache-2.0을 유지합니다. [글꼴 구성과 서버 연결](docs/fonts.md)

문서 엔진은 [RHWP](https://github.com/edwardkim/rhwp)와 [EigenPal DOCX Editor](https://github.com/eigenpal/docx-editor)를 기반으로 합니다. 사용 버전과 고지는 [라이선스 안내](docs/licensing.md)에 정리했습니다.

Document Studio 자체 코드는 **[Apache-2.0](LICENSE)**입니다. 의존성의 MIT·Apache-2.0·BSD-3-Clause 등의 라이선스는 각각 유지되며, 배포 시 [NOTICE](NOTICE)와 패키지의 `dist/licenses/` 고지를 함께 제공해야 합니다.
