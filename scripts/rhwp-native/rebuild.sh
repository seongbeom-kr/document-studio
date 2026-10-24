#!/bin/sh
# Linux/WSL + Docker. This only rebuilds the downstream native core, not Studio.
set -eu
sdk_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
docker build -t document-studio-rhwp-native:1.93.1 "$sdk_root/scripts/rhwp-native"
docker run --rm \
  -v document-studio-rhwp-native-rebuild:/work \
  -v "$sdk_root/third_party/rhwp-core:/output" \
  document-studio-rhwp-native:1.93.1 sh -eu -c '
    source_dir=$(mktemp -d /work/source.XXXXXX)
    cd "$source_dir"
    git init -q
    git remote add origin https://github.com/edwardkim/rhwp.git
    git sparse-checkout init --no-cone
    git sparse-checkout set --no-cone /Cargo.toml /Cargo.lock /build.rs /rust-toolchain.toml /src/ /crates/ /tools/rhwp-subsecond/ /tools/batch-convert/ /bindings/Native/ /tools/llm_verifier/verdict_protocol/ /tools/llm_verifier/claim_bind/ /tools/llm_verifier/criteria_decomp/ /saved/blank2010.hwp /examples/pr599_png_gateway.rs
    git fetch --depth=1 --filter=blob:none origin e8800c8def63449808a4092798442652ed460552
    git checkout --detach FETCH_HEAD
    git apply --check /output/paragraph-overlay.patch
    git apply /output/paragraph-overlay.patch
    rustfmt --check --edition 2021 --config skip_children=true src/renderer/layout.rs
    export CARGO_TARGET_DIR=/work/target
    cargo clippy --lib --locked --target wasm32-unknown-unknown -- -D warnings
    cargo build --lib --release --locked --target wasm32-unknown-unknown
    wasm-bindgen /work/target/wasm32-unknown-unknown/release/rhwp.wasm --target web --out-dir /output
  '
printf '%s\n' 'Rebuilt assets. Review differences and refresh provenance hashes before assets:prepare.'
