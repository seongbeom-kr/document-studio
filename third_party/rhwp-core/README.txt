RHWP native layout patch — Document Studio 0.3.0-beta.6

MIT licensed RHWP 0.8.6, source commit:
https://github.com/edwardkim/rhwp/tree/e8800c8def63449808a4092798442652ed460552
Original MIT copyright and license are retained in LICENSE.

paragraph-overlay.patch corrects a native layout anchor. An inline table advances
the flow cursor, but a following non-inline, paragraph-relative, front-of-text
picture must retain its host paragraph's anchor. This changes layout, including
paint and object selection bounds; source object properties are not rewritten.
Paper/page-relative positioning, inline pictures, and other wrapping modes retain
their existing paths. It does not claim general HWP/Word layout equivalence.

rhwp.js, rhwp.d.ts, rhwp_bg.wasm and rhwp_bg.wasm.d.ts are matching generated
outputs. The generated JS bindings are byte-identical to upstream npm 0.8.6.
The WASM is compiled from the pinned source plus the included patch with Rust
1.93.1, default features, cargo build --lib --release --locked --target
wasm32-unknown-unknown and wasm-bindgen 0.2.127 --target web. No optimizer pass
outside the locked release build was applied. provenance.json records hashes.

To rebuild from Linux or WSL with Docker:
  sh scripts/rhwp-native/rebuild.sh
Review generated differences and update provenance.json sha256 values after a
deliberate rebuild. Then run yarn assets:prepare, yarn typecheck, yarn test,
yarn build, yarn verify:packages and the RHWP browser regression suites.
Normal SDK builds use the audited generated assets and do not need Rust/Docker.
The SDK build and license gate validate asset hashes and retain these notices.

Regression source: fixtures/paragraph-overlay.hwpx (project-owned synthetic data),
scripts/generate-overlay-fixture.mjs, tests/unit/rhwp-native-layout.test.ts and
tests/e2e/paragraph-overlay.spec.ts. Customer documents remain local and are not
part of this repository.

2026-11-05: The pinned source patch also preserves HWP5 lineage on HWP5 -> HWPX -> HWP
roundtrips. Do not add /RhwpHwpxOrigin when META-INF/rhwp-hwp5-origin is already present.
Genuine HWPX sources still receive the original marker. This prevents switching the
reopened pagination profile. No generated HWP binary is rewritten after export.
Rebuild uses Rust1.93.1, wasm-bindgen0.2.127, wasm32-unknown-unknown, locked release
default features for the rhwp library. Generate upstream ignored test harnesses first,
or omit only their unused target declarations in an isolated library-build manifest.
The SDK packaged-runtime lineage regression and native all-page roundtrip checks apply.
