# 공개 SDK 라이선스 기록

자체 코드의 선택 라이선스는 Apache-2.0입니다. third-party 코드는 원래 라이선스와 저작권 고지를 유지합니다. 정부 실행 파일·코드·서식·외부 폰트·고객 문서·상용 DOCX Pro/editor-api 모듈을 포함하지 않습니다. 자체 fixture와 PNG/SVG는 프로젝트가 생성했습니다.

| 구성                | 고정 버전·출처                                                                                      | 조건                                            |
| ------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| RHWP core/editor    | 0.8.6, [고정 소스](https://github.com/edwardkim/rhwp/tree/e8800c8def63449808a4092798442652ed460552) | MIT, 원본 저작권·permission 유지                |
| EigenPal core/react | 2.25.0, [공식 저장소](https://github.com/eigenpal/docx-editor)                                      | Apache-2.0, 제공 license/notices 유지. Pro 제외 |
| docx                | 9.8.1, [공식 저장소](https://github.com/dolanmiu/docx)                                              | MIT, 보고서 생성                                |
| fflate              | 0.8.3, [공식 저장소](https://github.com/101arrowz/fflate)                                           | MIT, ZIP parts 조회                             |
| CanvasKit WASM      | 0.42.0, [공식 Skia CanvasKit](https://github.com/google/skia/tree/main/modules/canvaskit)           | BSD-3-Clause, 원본 LICENSE 포함                 |

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

upstream dependency가 바뀌면 `scripts/prepare-rust-licenses.mjs`로 checksum·고지를 다시 준비하고 검토합니다. 누락 npm 고지는 pinned name/version으로 `scripts/prepare-npm-license.mjs`를 실행합니다. 준비 단계에는 네트워크가 필요하지만 감사와 build는 보관된 근거를 사용합니다. GitHub/npm 실제 게시 대상과 공개 이름은 아직 정해지지 않았습니다.

0.2.7의 DOCX 패키지는 Apache-2.0 EigenPal 2.25.0의 무료 core/react/i18n JavaScript를 번들합니다. `scripts/docx-paint-patch.mjs`는 원본 chunk SHA-256과 변경 지점의 유일성을 검증한 뒤 인라인 그림의 paint 시작 좌표와 shaped text advance를 보정합니다. 변경 사실과 원본 commit/path는 NOTICE, 배포 패키지의 `dist/native-patch.json`에 남깁니다. 원본 npm 라이선스/고지와 기존 SBOM은 각 패키지에 유지합니다. 유료 Pro/editor-api 코드는 포함하지 않습니다.
