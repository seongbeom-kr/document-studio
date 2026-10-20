# 공개 SDK 라이선스 기록

자체 코드의 선택 라이선스는 Apache-2.0입니다. third-party 코드는 원래 라이선스와 저작권 고지를 유지합니다. 정부 실행 파일·코드·서식·외부 폰트·고객 문서·상용 DOCX Pro/editor-api 모듈을 포함하지 않습니다. 자체 fixture와 PNG/SVG는 프로젝트가 생성했습니다.

| 구성                | 고정 버전·출처                                                                                      | 조건                                            |
| ------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| RHWP core/editor    | 0.8.6, [고정 소스](https://github.com/edwardkim/rhwp/tree/e8800c8def63449808a4092798442652ed460552) | MIT, 원본 저작권·permission 유지                |
| EigenPal core/react | 2.25.0, [공식 저장소](https://github.com/eigenpal/docx-editor)                                      | Apache-2.0, 제공 license/notices 유지. Pro 제외 |
| docx                | 9.8.1, [공식 저장소](https://github.com/dolanmiu/docx)                                              | MIT, 보고서 생성                                |
| fflate              | 0.8.3, [공식 저장소](https://github.com/101arrowz/fflate)                                           | MIT, ZIP parts 조회                             |
| CanvasKit WASM      | 0.42.0, [공식 Skia CanvasKit](https://github.com/google/skia/tree/main/modules/canvaskit)           | BSD-3-Clause, 원본 LICENSE 포함                 |

## BSD-3-Clause와 CanvasKit

BSD-3-Clause는 소스·바이너리의 사용, 수정, 재배포를 허용하며 다음 세 조건을 둡니다.

1. 소스 재배포에는 원본 저작권, 라이선스 조건, 면책 문구를 유지합니다.
2. 바이너리 재배포에도 같은 고지를 문서 또는 함께 제공하는 자료에 포함합니다.
3. 저작권자·기여자의 이름을 사전 허락 없이 파생 제품의 보증이나 홍보에 사용하지 않습니다.

상업적 사용을 금지하거나 소비 앱의 소스 공개를 요구하는 조건은 없습니다. [OSI의 BSD-3-Clause 원문](https://opensource.org/license/bsd-3-clause)과 [Apache 재단의 허용 라이선스 목록](https://www.apache.org/legal/resolved.html#category-a)에서 확인할 수 있습니다. 자체 코드를 Apache-2.0으로 배포하면서 BSD-3-Clause 의존성을 함께 배포할 수 있습니다. 의존성의 원래 라이선스를 Apache-2.0으로 바꾸는 것은 아닙니다.

CanvasKit은 RHWP Studio가 선택적으로 사용하는 문서 출력 엔진입니다. 문서의 글자·표·그림을 브라우저의 문서 영역에 그리는 역할이며, 별도 앱이나 저장 서비스가 아닙니다. 고정 RHWP 소스의 `rhwp-studio/src/view/render-backend.ts`에서 기본값은 **브라우저 Canvas2D**입니다. `renderer=canvaskit` 또는 `renderer=auto`를 지정할 때 CanvasKit 경로를 선택하거나 평가합니다. SDK는 이 옵션을 강제로 설정하지 않습니다. 기본 실행 여부와 별개로 CanvasKit JS/WASM이 정적 배포 자산에 포함되므로 고지를 유지합니다.

설치된 `canvaskit-wasm@0.42.0`은 Google 저작권과 BSD-3-Clause 원문을 제공합니다. 그 의존성 `@webgpu/types@0.1.21`도 BSD-3-Clause입니다. Rust 목록에도 BSD 의존성이 있습니다. README에서 CanvasKit 설명을 줄여도 이 고지와 배포물의 원문은 삭제하지 않습니다.

## 2026-10-15 점검 결과와 배포 조건

현재 고정된 의존성 선언과 보관된 고지 범위에서는 자체 Apache-2.0 배포를 막는 라이선스 충돌을 발견하지 않았습니다. `yarn audit:licenses`는 npm 102개와 Rust 외부 의존성 393개를 검사했습니다. 아래 선택은 이 배포에 적용하며 원래의 복수 라이선스 고지는 보존합니다.

0.2.17 네 tarball에서 프로젝트 `LICENSE`·`NOTICE`, 의존성 목록, 통합 고지가 현재 원본과 바이트 단위로 일치함을 확인했습니다. CanvasKit의 원본 BSD 고지도 포함되어 있습니다. HWPX 정적 자산의 RHWP 라이선스와 추가 고지도 확인했으며, 라이선스 정책을 포함한 기존 관련 단위 테스트 40개가 통과했습니다. 이 점검은 패키지 고지 검증이며 새로운 업무 문서 호환성 시험은 아닙니다.

| 의존성               | 원래 라이선스 식                       | 적용 조건               |
| -------------------- | -------------------------------------- | ----------------------- |
| jszip 3.10.2         | MIT OR GPL-3.0-or-later                | MIT 선택                |
| r-efi 5.3.0 / 6.0.0  | MIT OR Apache-2.0 OR LGPL-2.1-or-later | MIT 선택                |
| pako 1.0.11          | MIT AND Zlib                           | MIT와 Zlib 모두 유지    |
| encoding_rs 0.8.35   | (Apache-2.0 OR MIT) AND BSD-3-Clause   | MIT와 BSD-3-Clause 유지 |
| unicode-ident 1.0.24 | (MIT OR Apache-2.0) AND Unicode-3.0    | MIT와 Unicode-3.0 유지  |

`OR`는 선택 가능한 라이선스입니다. 위 목록에 GPL·LGPL 문자열이 있다는 이유만으로 그 조건이 프로젝트 전체에 적용되는 것은 아닙니다. `AND`는 함께 충족해야 하므로 한쪽 고지만 지워서는 안 됩니다. 나머지 복수 라이선스도 검사 정책에서 허용한 선택지를 사용하고 제공된 원문은 모두 보관합니다.

배포자는 프로젝트의 `LICENSE`·`NOTICE`, 각 패키지의 `dist/licenses/`, HWPX 정적 자산의 라이선스 파일과 `licenses/`를 함께 제공합니다. 앱 번들러가 `node_modules`의 고지 파일을 최종 앱에 복사하지 않는다면 앱의 배포 자료나 오픈소스 고지에 별도로 포함해야 합니다. 수정해서 번들한 EigenPal·RHWP 부분의 변경 사실은 `NOTICE`와 각 엔진의 `dist/native-patch.json`에 기록합니다. Apache-2.0의 배포·변경 고지 조건은 [원문 4조](https://www.apache.org/licenses/LICENSE-2.0#redistribution)를 따릅니다.

## 검사 방법과 한계

`yarn audit:licenses`는 설치된 SDK production 의존성·필수 peer와 번들 RHWP Studio 의존성을 순회합니다. 이번 결과는 자체 네 패키지를 포함한 npm 102개입니다. 라이선스 식의 AND는 모두 충족해야 하며 OR에서는 허용되는 permissive 선택지가 있어야 합니다. 미확인 식·금지 라이선스·빠진 고지·유료 모듈은 gate를 실패시킵니다.

고정 RHWP Cargo.lock의 외부 항목은 393개(레지스트리 392개·고정 Git 1개)입니다. `.crate` SHA-256을 lock checksum과 비교하고 고지를 보관했습니다. Git 의존성 svg2pdf는 고정 commit `2caeb0a038f9128b79833d803b94c2667565c4da`의 archive와 license를 기록했습니다. [Rust inventory](../third_party/rust-sbom.json)는 optional/native-only 의존성까지 포함하는 보수적 목록입니다. WASM linker의 실제 포함 항목을 독립 추출한 결과는 아닙니다. upstream 요약의 243개와 현재 lock의 수가 달라 실제 lock 기준으로 기록합니다.

일부 npm/14개 Rust archive는 standalone LICENSE를 포함하지 않습니다. README에 전체 MIT 고지가 있으면 유지하고, 그렇지 않으면 release commit의 원본 license를 보완합니다. 그것도 없는 react-remove-scroll-bar와 일부 Rust 항목은 원본 package/README/author·source header·license 선언과 선택한 표준 조건(SPDX license-list-data v3.27.0)을 함께 보관합니다. 표준 license의 copyright placeholder는 새 저작권 주장이 아닙니다. 이 근거와 archive/commit은 목록에 남깁니다.

준비 원본은 `third_party/`, build 집계는 `.build/licenses/sbom.json`과 `THIRD_PARTY_NOTICES.txt`입니다. 네 SDK tarball의 `dist/licenses/`, HWPX 정적 자산의 `studio/licenses/`에도 포함됩니다. npm 소비 시험이 해당 파일과 CanvasKit 고지를 확인합니다. RHWP WASM 내부 upstream blank-document seed/fallback 직렬화 리소스는 upstream MIT 배포의 일부이며 NOTICE에 기재합니다.

이 기록은 확인한 출처·라이선스 선택·고지 보관 근거입니다. 모든 저작권 권리관계나 prebuilt WASM/CanvasKit 내부 linkage를 법률 감사로 보증하는 문서는 아닙니다. 기관 프로그램의 배포 조건을 자체 Apache 라이선스로 바꾸지 않습니다. 새 의존성·폰트·자산을 넣으면 원본 조건을 다시 확인해야 합니다.

```sh
yarn audit:licenses
yarn build
yarn verify:packages
```

upstream dependency가 바뀌면 `scripts/prepare-rust-licenses.mjs`로 checksum·고지를 다시 준비하고 검토합니다. 누락 npm 고지는 pinned name/version으로 `scripts/prepare-npm-license.mjs`를 실행합니다. 준비 단계에는 네트워크가 필요하지만 감사와 build는 보관된 근거를 사용합니다. 소스는 [GitHub 저장소](https://github.com/seongbeom-kr/document-studio)에 공개했으며 npm registry 게시 전입니다.

0.2.7의 DOCX 패키지는 Apache-2.0 EigenPal 2.25.0의 무료 core/react/i18n JavaScript를 번들합니다. `scripts/docx-paint-patch.mjs`는 원본 chunk SHA-256과 변경 지점의 유일성을 검증한 뒤 인라인 그림의 paint 시작 좌표와 shaped text advance를 보정합니다. 변경 사실과 원본 commit/path는 NOTICE, 배포 패키지의 `dist/native-patch.json`에 남깁니다. 원본 npm 라이선스/고지와 기존 SBOM은 각 패키지에 유지합니다. 유료 Pro/editor-api 코드는 포함하지 않습니다.

0.2.17의 HWPX 패키지는 MIT `@rhwp/editor@0.8.6`의 초기화 취소·정리 경로를 수정해 번들합니다. `scripts/rhwp-lifecycle-patch.mjs`가 고정 입력 digest를 검사하고 변경 이력을 남깁니다. 원본 MIT 고지는 유지하며 Rust/WASM 바이너리는 변경하지 않습니다.

## 0.2.18 범용 브라우저 패키지

`@document-studio/browser` 추가 후 production·필수 peer·번들 의존성 검사는 자체 다섯 패키지를 포함해 npm 105개입니다. Rust 고정 목록은 393개로 유지됩니다. browser 패키지가 내부 React 19 런타임과 TypeScript 소비에 필요한 `@types/react`를 의존성으로 제공합니다. 이들의 라이선스는 MIT이며 원문 고지를 배포물에 포함합니다. Vue 3.5.44(MIT)는 소비 예제와 검증용 의존성이며 SDK 런타임 번들에 추가하지 않습니다.

## 0.2.32 Kordoc 참고 구현

직접 도입한 파일은 Kordoc 4.22.15, commit `6f9ef253cc66bb30c8b26fe87811d2c5832de995`의 `src/hwpx/paste-clean.ts` 한 개다. MIT 저작권/허가 고지와 해당 규칙의 참고 원전 hwp-auto-docfit의 MIT 고지를 `third_party/kordoc/`에 보관한다. 원본 출처·LF 정규화 SHA-256·수정 내역은 같은 디렉토리의 `provenance.json`에 기록한다. 감사 스크립트가 고지 존재를 검사하고 모든 패키지의 `dist/licenses/THIRD_PARTY_NOTICES.txt`에 포함한다.

기존 Apache-2.0 프로젝트 안에서 이 파일의 원 MIT 조건을 유지한다. Kordoc 패키지 전체, Node 파서, native 라이브러리, OCR 코드·모델은 설치하거나 번들하지 않았다. 선택적 OCR 모델에 관한 upstream 라이선스 검토 사항을 이번 배포 의존성에 포함시키지 않는다. 에이전트 참조·미리보기·결과 검증은 설계 참고 후 작성한 SDK 자체 구현이다.
