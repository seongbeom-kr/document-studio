import { createHash } from "node:crypto";

export const RHWP_LIFECYCLE_PATCH = Object.freeze({
  engineVersion: "0.8.6",
  sourceFile: "npm/editor/index.js",
  inputSha256:
    "c9fab3743e713c46fd72c20f798333a4e70021ed7fcc7bdc56f0e144dd7b9431",
  change:
    "Accept an origin/source/attempt-bound runtime boot signal before full iframe load; expose the created frame for bounded initialization diagnostics; abort loading, transport negotiation, ready polling and chrome setup with complete cleanup.",
});

// Bundle this checked modification of MIT-licensed @rhwp/editor. Consumers do
// not need a patched node_modules tree or a package-manager-specific override.
export function patchRhwpLifecycle(code) {
  if (
    createHash("sha256").update(code).digest("hex") !==
    RHWP_LIFECYCLE_PATCH.inputSha256
  )
    throw new Error(
      "RHWP source changed; review its initialization patch before building.",
    );
  const start = code.indexOf("  el.appendChild(iframe);");
  const end = code.indexOf("\n}\n", start);
  code =
    code.slice(0, start) +
    `  const signal = options.signal;
  let transport;
  let rejectLoad;
  const aborted = () => signal?.reason ?? new DOMException('Editor initialization cancelled', 'AbortError');
  const onAbort = () => {
    rejectLoad?.(aborted());
    transport?.destroy();
    iframe.remove();
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    signal?.throwIfAborted();
    options.onFrameCreated?.(iframe);
    options.onInitializationStage?.('iframe-loading');
    await new Promise((resolve, reject) => {
      const frameUrl = new URL(studioUrl);
      const bootId = frameUrl.searchParams.get('documentStudioBootId');
      const cleanup = () => {
        iframe.removeEventListener('load', onLoad);
        iframe.removeEventListener('error', onError);
        window.removeEventListener('message', onRuntime);
        rejectLoad = undefined;
      };
      const finish = (via) => { cleanup(); options.onFrameReady?.(via); resolve(); };
      const onLoad = () => finish('load');
      const onRuntime = (event) => {
        if (bootId && event.source === iframe.contentWindow && event.origin === frameUrl.origin
          && event.data?.bootId === bootId) {
          if (event.data.type === 'document-studio:frame-ready') finish('runtime');
          if (event.data.type === 'document-studio:boot') options.onFrameObservation?.(event.data);
        }
      };
      const onError = () => { cleanup(); reject(new Error('Editor iframe failed to load')); };
      rejectLoad = (error) => { cleanup(); reject(error); };
      iframe.addEventListener('load', onLoad, { once: true });
      iframe.addEventListener('error', onError, { once: true });
      window.addEventListener('message', onRuntime);
      try {
        el.appendChild(iframe);
        options.onFrameObservation?.({event:'frame-attached',width:el.clientWidth,height:el.clientHeight});
      } catch (error) { rejectLoad(error); }
    });
    signal?.throwIfAborted();
    options.onInitializationStage?.('transport-connecting');
    transport = new EditorTransport(iframe, studioUrl, {
      requestTimeoutMs: options.requestTimeoutMs,
      handshakeTimeoutMs: options.handshakeTimeoutMs,
    });
    await transport.connect();
    signal?.throwIfAborted();
    options.onInitializationStage?.('engine-starting', transport._legacy ? 'legacy' : 'message-port');
    const editor = new RhwpEditor(iframe, transport);
    await editor._waitReady(signal);
    signal?.throwIfAborted();
    return editor;
  } catch (error) {
    transport?.destroy();
    iframe.remove();
    throw error;
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }` +
    code.slice(end);
  const readyStart = code.indexOf("  async _waitReady() {");
  const readyEnd = code.indexOf("\n  }", readyStart) + 4;
  code =
    code.slice(0, readyStart) +
    `  async _waitReady(signal) {
    for (let i = 0; i < 30; i++) {
      signal?.throwIfAborted();
      try {
        if (await this._request('ready')) return;
      } catch (error) {
        signal?.throwIfAborted();
      }
      await new Promise((resolve, reject) => {
        const finish = () => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
        };
        const onAbort = () => { finish(); reject(signal.reason); };
        const timer = setTimeout(() => { finish(); resolve(); }, 500);
        signal?.addEventListener('abort', onAbort, { once: true });
        if (signal?.aborted) onAbort();
      });
    }
    throw new Error('Editor initialization timeout');
  }` +
    code.slice(readyEnd);
  const studioStart = code.indexOf("export async function createStudio(");
  code =
    code.slice(0, studioStart) +
    `export async function createStudio(container, options = {}) {
  const studio = await createEditor(container, options);
  const signal = options.signal;
  const onAbort = () => studio.destroy();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    signal?.throwIfAborted();
    options.onInitializationStage?.('controls-connecting');
    if (options.chrome) await studio.chrome.set(options.chrome);
    for (const id of options.plugins ?? []) {
      signal?.throwIfAborted();
      await studio.plugins.load(id);
    }
    signal?.throwIfAborted();
    return studio;
  } catch (error) {
    studio.destroy();
    throw error;
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}
`;
  return code;
}

export function rhwpLifecyclePatch() {
  let applied = false;
  return {
    name: "document-studio-rhwp-initialization",
    transform(code, id) {
      if (
        !id
          .split("?")[0]
          .replaceAll("\\", "/")
          .endsWith("/@rhwp/editor/index.js")
      )
        return;
      applied = true;
      return { code: patchRhwpLifecycle(code), map: null };
    },
    generateBundle() {
      if (!applied)
        throw new Error("RHWP initialization patch was not bundled.");
    },
  };
}
