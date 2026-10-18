import {
  mountDocumentEditor,
  createAgentBridge,
  type MountedDocumentEditor,
} from "@document-studio/browser";
import {
  SaveConflictError,
  type DocumentDraft,
  type EditorDocument,
  type DraftStore,
  type EditorCloseRequest,
} from "@document-studio/core";
import { docxEngine } from "@document-studio/engine-docx";
import { rhwpEngine } from "@document-studio/engine-rhwp";
import "../../../packages/react/src/styles.css";
import { browserAutomationDraftStore } from "@document-studio/react";

const format =
  new URLSearchParams(location.search).get("format") === "hwpx"
    ? "hwpx"
    : "docx";
const engines = [
  docxEngine(),
  rhwpEngine({ studioUrl: "/editor-assets/rhwp/index.html" }),
];
const files = new Map<string, EditorDocument>();
const drafts = new Map<string, DocumentDraft>();
let host: HTMLElement;
let controller: MountedDocumentEditor | null = null;
let removeHost = () => {};
let rerenderHost = () => {};

async function source(id: string) {
  if (!files.has(id)) {
    const response = await fetch(`/samples/blank.${format}`);
    files.set(id, {
      id,
      fileName: `${id}.${format}`,
      format,
      version: "v1",
      bytes: new Uint8Array(await response.arrayBuffer()),
    });
  }
  return files.get(id)!;
}
const store: DraftStore = {
  get: async (key) => drafts.get(key),
  put: async (draft) => {
    api.draftStarted = true;
    if (api.holdDraft)
      await new Promise<void>((resolve) => {
        api.releaseDraft = resolve;
      });
    if (api.failDraft) throw new Error("Test draft storage failure");
    drafts.set(draft.key, structuredClone(draft));
    api.draftEvents.push({ kind: "put", key: draft.key });
  },
  delete: async (key) => {
    api.deleteStarted = true;
    if (api.holdDelete)
      await new Promise<void>((resolve) => {
        api.releaseDelete = resolve;
      });
    if (api.failDelete) throw new Error("Test draft delete failure");
    drafts.delete(key);
    api.draftEvents.push({ kind: "delete", key });
  },
};
const api = {
  controller: () => controller!,
  agent: createAgentBridge(() => controller),
  drafts,
  files,
  failDraft: false,
  failSave: false,
  holdDraft: false,
  draftStarted: false,
  releaseDraft: null as (() => void) | null,
  saves: 0,
  draftEvents: [] as { kind: string; key: string }[],
  holdDelete: false,
  deleteStarted: false,
  failDelete: false,
  releaseDelete: null as (() => void) | null,
  holdClose: false,
  failClose: false,
  captureClose: false,
  closeCalls: 0,
  closed: false,
  closeRequest: undefined as EditorCloseRequest | undefined,
  closeState: undefined as
    | ReturnType<MountedDocumentEditor["getState"]>
    | undefined,
  releaseClose: null as (() => void) | null,
  failAutomation: false,
  async mount(id = "A", noDraft = false) {
    api.closed = false;
    const automationStore = browserAutomationDraftStore();
    controller = await mountDocumentEditor(host, {
      document: await source(id),
      engines,
      draftNamespace: "browser-test",
      automationDraftStore: new URLSearchParams(location.search).has(
        "persistAutomation",
      )
        ? {
            get: automationStore.get,
            delete: automationStore.delete,
            put: async (key, value) => {
              if (api.failAutomation)
                throw new Error("Test automation storage failure");
              await automationStore.put(key, value);
            },
          }
        : undefined,
      draftStore: noDraft ? false : store,
      appearance: new URLSearchParams(location.search).has("closeUI")
        ? "standalone"
        : "embedded",
      onClose: new URLSearchParams(location.search).has("closeUI")
        ? async (request) => {
            api.closeCalls++;
            api.closeRequest = request;
            api.closeState = controller!.getState();
            if (api.holdClose)
              await new Promise<void>((resolve) => {
                api.releaseClose = resolve;
              });
            if (api.failClose) throw new Error("Test host close failure");
            if (api.captureClose) return;
            await controller!.destroy();
            api.closed = true;
          }
        : undefined,
      storage: {
        async save({ document, bytes, expectedVersion }) {
          if (api.failSave) throw new Error("Test server save failure");
          if (files.get(document.id)?.version !== expectedVersion)
            throw new SaveConflictError();
          api.saves++;
          const version = `v${api.saves + 1}`;
          files.set(document.id, {
            ...document,
            bytes: bytes.slice(),
            version,
          });
          return { version };
        },
      },
    });
    return controller.getState();
  },
  async open(id: string) {
    await controller!.update({ document: await source(id) });
  },
  async refreshIdentity() {
    await controller!.update({
      document: { ...(await source(controller!.getState().documentId)) },
    });
  },
  async replaceSameId() {
    const old = await source(controller!.getState().documentId);
    await controller!.update({
      document: { ...old, version: "replacement", bytes: old.bytes.slice() },
    });
  },
  async duplicateMount() {
    await mountDocumentEditor(host, {
      document: await source("duplicate"),
      engines,
    });
  },
  async verifySibling() {
    const siblingHost = document.createElement("div");
    document.body.append(siblingHost);
    const sibling = await mountDocumentEditor(siblingHost, {
      document: await source("sibling"),
      engines,
      draftStore: false,
    });
    try {
      await sibling.whenReady();
      const before = controller!.getState().sessionId;
      await controller!.execute({ id: "insertText", value: "PRIMARY ONLY" });
      const separate = !(await sibling.readDocument()).text.includes(
        "PRIMARY ONLY",
      );
      await sibling.destroy();
      return { separate, stable: before === controller!.getState().sessionId };
    } finally {
      await sibling.destroy();
      siblingHost.remove();
    }
  },
  async closeHost() {
    await controller?.destroy();
    controller = null;
    removeHost();
  },
  rerender() {
    rerenderHost();
  },
};
declare global {
  interface Window {
    browserStudioTest: typeof api;
  }
}

if (new URLSearchParams(location.search).get("host") === "vue") {
  const { createApp, h, ref, onMounted } = await import("vue");
  const app = createApp({
    setup() {
      const element = ref<HTMLElement>();
      const renders = ref(0);
      rerenderHost = () => {
        renders.value++;
      };
      onMounted(() => {
        host = element.value!;
      });
      return () =>
        h("section", [
          h("h1", `Vue host ${renders.value}`),
          h("button", { onClick: rerenderHost }, "호스트 다시 렌더"),
          h("div", { ref: element, id: "editor-host", style: "height:850px" }, [
            h("span", { id: "host-owned" }, "호스트 소유 요소"),
          ]),
        ]);
    },
  });
  app.mount("#root");
  removeHost = () => app.unmount();
} else {
  const root = document.querySelector("#root")!;
  root.innerHTML =
    '<h1>JavaScript host</h1><div id="editor-host" style="height:850px"><span id="host-owned">호스트 소유 요소</span></div>';
  host = root.querySelector<HTMLElement>("#editor-host")!;
  removeHost = () => root.replaceChildren();
}

// Publish only after Vue has committed the host element, just like the plain host.
window.browserStudioTest = api;
