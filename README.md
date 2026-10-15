# Document Studio

React·Next.js 앱에 넣어 쓰는 **HWPX·DOCX 문서 편집기 SDK**입니다. RHWP와 EigenPal DOCX Editor를 연결해 공통 편집 UI, 서식 명령, 저장·초안 복구와 에이전트 API를 제공합니다.

소비 앱이 파일 목록·인증·저장소를 담당합니다. 별도 편집기 서버 없이 실행하며, `appearance="embedded"`로 기존 앱의 헤더·버튼·테마에 연결할 수 있습니다.

## 지원 기능

- 글자·문단 서식, 행간, 페이지 설정, 표·그림, 검색·치환
- 원본 형식으로 내보내기, 저장 충돌 처리, 초안 복구
- 보고서 생성·업무 자동화와 문서·세션·선택 범위를 확인하는 에이전트 명령

현재 지원 형식은 HWPX·DOCX입니다. HWP·PPTX·XLSX 편집은 아직 지원하지 않습니다. 형식별 차이와 제한은 [기능 지원표](docs/feature-support.md)에서 확인하세요.

## 패키지

| 패키지                         | 역할                            |
| ------------------------------ | ------------------------------- |
| `@document-studio/core`        | 문서·명령·저장소 계약           |
| `@document-studio/react`       | React 편집 UI와 에이전트 브리지 |
| `@document-studio/engine-docx` | DOCX 엔진                       |
| `@document-studio/engine-rhwp` | HWPX 엔진과 자체 호스팅 자산    |

## 시작하기

소스를 빌드하려면 Node.js 24.13 이상, Yarn 4, Git이 필요합니다. 소비 앱은 React 19를 사용합니다. npm 배포 전이므로 현재는 소스 빌드와 tarball로 설치합니다.

```sh
git clone https://github.com/seongbeom-kr/document-studio.git
cd document-studio
corepack enable
yarn install
yarn assets:prepare
yarn build
```

네 패키지의 tarball 생성·설치는 [배포 안내](docs/release-guide.md)를 따릅니다. HWPX를 사용할 앱에서는 설치 후 런타임 자산을 복사합니다.

```sh
npx document-studio-rhwp-assets public/editor-assets/rhwp
```

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

Next.js에서는 `"use client"` 컴포넌트에서 사용합니다. `document`의 ID·원본 버전을 안정적으로 유지하고 `draftNamespace`를 사용자·작업공간별로 지정하세요. 저장 콜백, 전환 전 `flushDraft()`, 초기화 재시도와 에이전트 연결은 [호스트 통합 안내](docs/integration.md)에 설명합니다.

## 개발과 검증

```sh
yarn fixtures:generate
yarn dev:playground
```

개발 예제는 `http://127.0.0.1:4173`에서 실행합니다.

```sh
yarn typecheck
yarn test
yarn test:e2e
yarn audit:licenses
yarn build
yarn verify:packages
```

`verify:packages`는 tarball을 별도 Next.js 앱에 설치해 빌드·브라우저 동작을 검사합니다. 테스트 환경과 실행 옵션은 [배포 안내](docs/release-guide.md)를 참고하세요.

## 라이선스

자체 코드는 [Apache-2.0](LICENSE)입니다. 의존성에는 MIT·Apache-2.0·BSD-3-Clause 등의 라이선스가 각각 적용됩니다. 배포 시 [NOTICE](NOTICE)와 패키지의 `dist/licenses/` 고지를 함께 유지하세요. 구성 요소별 조건과 검사 범위는 [라이선스 안내](docs/licensing.md)에 정리했습니다.

## 문서와 기여

- [호스트 앱 통합](docs/integration.md) · [연결 예제](examples/sandbox-agent/README.md)
- [지원 기능](docs/feature-support.md) · [범정부 오피스 기능 대응](docs/government-office-reference.md)
- [검증 기록](docs/practical-validation.md) · [최근 수정·검증 결과](docs/review-fixes-0.2.17-2026-10-15.txt)

버그 제보에는 공개 가능한 최소 재현 문서, 기대·실제 결과와 브라우저 버전을 포함해 주세요. 업무·고객 문서는 올리지 마세요.
