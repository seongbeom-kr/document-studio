FROM rust:1.93.1-slim@sha256:c0a38f5662afdb298898da1d70b909af4bda4e0acff2dc52aea6360a9b9c6956
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl git && rm -rf /var/lib/apt/lists/*
RUN rustup target add wasm32-unknown-unknown && rustup component add rustfmt clippy
RUN curl --fail --location https://github.com/wasm-bindgen/wasm-bindgen/releases/download/0.2.127/wasm-bindgen-0.2.127-x86_64-unknown-linux-musl.tar.gz -o /tmp/bindgen.tgz \
    && printf '%s  %s\n' 61d4a7dc85acfa0d2354ccc0b8361928c7e52a746d17f28ebaa795ed3dc1614a /tmp/bindgen.tgz | sha256sum --check \
    && tar -xzf /tmp/bindgen.tgz -C /tmp \
    && cp /tmp/wasm-bindgen-0.2.127-x86_64-unknown-linux-musl/wasm-bindgen /usr/local/bin/ \
    && rm -rf /tmp/wasm-bindgen*
WORKDIR /work
