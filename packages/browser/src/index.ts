import { createElement, useLayoutEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  DocumentEditor,
  type DocumentEditorProps,
} from "@document-studio/react";
import {
  SaveConflictError,
  type EditorController,
  type EditorControllerState,
} from "@document-studio/core";

export { createAgentBridge } from "@document-studio/core";
export type {
  EditorController,
  EditorControllerState,
} from "@document-studio/core";
export type BrowserEditorOptions = DocumentEditorProps;
export type BrowserEditorUpdate = Partial<
  Pick<
    DocumentEditorProps,
    | "document"
    | "readOnly"
    | "appearance"
    | "presets"
    | "onStateChange"
    | "onDirtyChange"
    | "onSaved"
    | "onClose"
    | "onCreateDocument"
    | "creationLocation"
  >
>;

export interface MountedDocumentEditor extends EditorController {
  /** Resolves after props are committed, not after the native engine is ready. */
  update(patch: BrowserEditorUpdate): Promise<void>;
  /** Preserves drafts before unmounting. On failure the editor remains mounted. */
  destroy(): Promise<void>;
  whenReady(options?: {
    signal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<EditorControllerState>;
}

const mounts = new WeakSet<HTMLElement>();
const updateKeys = new Set([
  "document",
  "readOnly",
  "appearance",
  "presets",
  "onStateChange",
  "onDirtyChange",
  "onSaved",
  "onClose",
  "onCreateDocument",
  "creationLocation",
]);

function CommitBoundary({
  children,
  committed,
}: {
  children: ReactNode;
  committed(): void;
}) {
  useLayoutEffect(committed, [committed]);
  return children;
}

/** React is an implementation detail; the host supplies a DOM element and ordinary options. */
export async function mountDocumentEditor(
  container: HTMLElement,
  initialOptions: BrowserEditorOptions,
): Promise<MountedDocumentEditor> {
  const ElementClass = container?.ownerDocument?.defaultView?.HTMLElement;
  if (!ElementClass || !(container instanceof ElementClass))
    throw new TypeError("편집기를 넣을 HTML 요소가 필요합니다.");
  if (mounts.has(container))
    throw new Error("이 요소에는 이미 편집기가 연결돼 있습니다.");
  if (!initialOptions?.document || !initialOptions.engines?.length)
    throw new TypeError("문서와 편집 엔진이 필요합니다.");
  mounts.add(container);
  // Own one child only: never clear the host's other content.
  const surface = container.ownerDocument.createElement("div");
  surface.className = "ds-browser-mount";
  surface.style.cssText = "width:100%;height:100%;min-width:0;min-height:0;";
  container.append(surface);
  let options = {
    ...initialOptions,
    appearance: initialOptions.appearance ?? "embedded",
  };
  let handle: EditorController | null = null;
  let disposed = false;
  let transitioning = false;
  let sourceEpoch = 0;
  let destroyTask: Promise<void> | null = null;
  let renderFailure: unknown;
  let pendingRender:
    | { resolve(): void; reject(error: unknown): void }
    | undefined;
  const listeners = new Set<() => void>();
  const publish = () => {
    for (const listener of listeners) listener();
  };
  let root: Root;
  try {
    root = createRoot(surface, {
      identifierPrefix: `document-studio-${crypto.randomUUID()}-`,
      onUncaughtError(error) {
        renderFailure = error;
        pendingRender?.reject(error);
        pendingRender = undefined;
        publish();
      },
    });
  } catch (error) {
    surface.remove();
    mounts.delete(container);
    throw error;
  }
  const current = (allowTransition = false) => {
    if (disposed) throw new Error("편집기가 종료됐습니다.");
    if (renderFailure) throw renderFailure;
    if (transitioning && !allowTransition)
      throw new Error("편집기를 전환하는 중입니다.");
    if (!handle) throw new Error("편집기를 준비하는 중입니다.");
    return handle;
  };
  const render = () =>
    new Promise<void>((resolve, reject) => {
      pendingRender = { resolve, reject };
      const rendered = options;
      root.render(
        createElement(CommitBoundary, {
          committed() {
            if (!handle) {
              reject(new Error("편집기 제어 연결을 준비하지 못했습니다."));
              return;
            }
            pendingRender = undefined;
            resolve();
            publish();
          },
          children: createElement(DocumentEditor, {
            ...rendered,
            // Only an explicitly requested source change that passed protect() gets a new lifetime.
            key: sourceEpoch,
            ref: (value: EditorController | null) => {
              handle = value;
            },
            onStateChange(snapshot) {
              publish();
              rendered.onStateChange?.(snapshot);
            },
          }),
        }),
      );
    });
  const protect = async () => {
    const editor = current(true);
    const before = editor.getState();
    const unlock = before.ready ? await editor.acquireInputLock() : undefined;
    try {
      await editor.flushDraft();
      if (current(true).getState().sessionId !== before.sessionId)
        throw new SaveConflictError("전환 준비 중 편집 세션이 변경됐습니다.");
    } finally {
      // surface remains inert and public commands remain blocked until the transition finishes.
      await unlock?.();
    }
  };
  try {
    await render();
  } catch (error) {
    root.unmount();
    surface.remove();
    mounts.delete(container);
    throw error;
  }

  const controller: MountedDocumentEditor = {
    getState: () => current(true).getState(),
    execute: async (...args) => current().execute(...args),
    exportDocument: async () => current().exportDocument(),
    flushDraft: async () => current().flushDraft(),
    flushAutomationDraft: async () => current().flushAutomationDraft(),
    retryInitialization: () => current().retryInitialization?.(),
    save: async (...args) => current().save(...args),
    commit: async (...args) => {
      const editor = current();
      if (!editor.commit)
        throw new Error("저장 확정 계약을 지원하지 않습니다.");
      return editor.commit(...args);
    },
    acquireInputLock: async () => current().acquireInputLock(),
    readDocument: async () => current().readDocument(),
    search: async (...args) => current().search(...args),
    selectMatch: async (...args) => current().selectMatch(...args),
    replace: async (...args) => current().replace(...args),
    applyPreset: async (...args) => current().applyPreset(...args),
    async update(patch) {
      current();
      if (!patch || Object.keys(patch).some((key) => !updateKeys.has(key)))
        throw new TypeError(
          "엔진·저장소·소유자 설정을 바꾸려면 종료 후 새 편집기를 연결하세요.",
        );
      if ("document" in patch && !patch.document)
        throw new TypeError("문서가 필요합니다.");
      const next = patch.document;
      const switching =
        next !== undefined &&
        (next.id !== options.document.id ||
          next.fileName !== options.document.fileName ||
          next.format !== options.document.format ||
          next.version !== options.document.version ||
          next.bytes !== options.document.bytes);
      transitioning = true;
      surface.inert = true;
      try {
        if (switching) await protect();
        options = { ...options, ...patch };
        if (switching) sourceEpoch++;
        await render();
        if ("readOnly" in patch && current(true).getState().ready) {
          // Wait for the native iframe's permission gate, not just the outer DOM update.
          const release = await current(true).acquireInputLock();
          await release();
        }
      } finally {
        transitioning = false;
        surface.inert = false;
        publish();
      }
    },
    destroy() {
      if (disposed) return Promise.resolve();
      if (destroyTask) return destroyTask;
      if (transitioning)
        return Promise.reject(new Error("편집기를 전환하는 중입니다."));
      transitioning = true;
      surface.inert = true;
      destroyTask = (async () => {
        try {
          await protect();
          root.unmount();
          disposed = true;
          surface.remove();
          mounts.delete(container);
        } finally {
          transitioning = false;
          surface.inert = false;
          destroyTask = null;
          publish();
          if (disposed) listeners.clear();
        }
      })();
      return destroyTask;
    },
    whenReady({ signal, timeoutMs = 45000 } = {}) {
      if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 180000)
        return Promise.reject(
          new RangeError("준비 대기 시간은 1~180000ms여야 합니다."),
        );
      const epoch = sourceEpoch;
      return new Promise((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const finish = (error?: unknown, state?: EditorControllerState) => {
          clearTimeout(timer);
          listeners.delete(check);
          signal?.removeEventListener("abort", abort);
          if (error) reject(error);
          else resolve(state!);
        };
        const abort = () =>
          finish(
            signal?.reason ??
              new DOMException("대기를 취소했습니다.", "AbortError"),
          );
        const check = () => {
          try {
            if (epoch !== sourceEpoch)
              throw new SaveConflictError("준비 대기 중 문서가 변경됐습니다.");
            const state = current(true).getState();
            if (state.initialization?.status === "failed")
              throw Object.assign(
                new Error(state.initialization.error.message),
                state.initialization.error,
              );
            if (
              !transitioning &&
              state.ready &&
              state.documentId === options.document.id
            )
              finish(undefined, state);
          } catch (error) {
            finish(error);
          }
        };
        if (signal?.aborted) {
          abort();
          return;
        }
        listeners.add(check);
        signal?.addEventListener("abort", abort, { once: true });
        timer = setTimeout(
          () => finish(new Error("편집기 준비 대기 시간이 초과됐습니다.")),
          timeoutMs,
        );
        check();
      });
    },
  };
  return controller;
}
