import { createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import {
  mountDocumentEditor,
  type MountedDocumentEditor,
} from "@document-studio/browser";
import {
  DocumentEditor,
  type DocumentEditorProps,
  type DocumentEditorHandle,
  type EditorUIContext,
  type EditorUIOptions,
} from "@document-studio/react";
import { docxEngine } from "@document-studio/engine-docx";
import { rhwpEngine } from "@document-studio/engine-rhwp";
import type { DocumentDraft, EditorDocument } from "@document-studio/core";
import "../../../packages/react/src/styles.css";

const parameters = new URLSearchParams(location.search);
const format = parameters.get("format") === "hwpx" ? "hwpx" : "docx";
const mode = parameters.get("host") ?? "browser";
const element = (id: string) => document.getElementById(id)!;
let root: Root | undefined;
let browser: MountedDocumentEditor | undefined;
const ref = createRef<DocumentEditorHandle>();
const drafts = new Map<string, DocumentDraft>();
let options: DocumentEditorProps;
let toolbarMode = "extend";
let currentContext: EditorUIContext;
let saved: EditorDocument;
const api = {
  state: () => controller().getState(),
  read: () => controller().readDocument(),
  execute: (value: string) => controller().execute({ id: "insertText", value }),
  failSave: false,
  failDraft: false,
  holdDraft: false,
  draftStarted: false,
  releaseDraft: null as (() => void) | null,
  saves: 0,
  closeResult: "" as string,
  beginClose() {
    api.closeResult = "pending";
    void api.close().then(
      () => {
        api.closeResult = "closed";
      },
      () => {
        api.closeResult = "failed";
      },
    );
  },
  async mount() {
    const response = await fetch(`/samples/blank.${format}`);
    saved = {
      id: "ui-document",
      fileName: `ui.${format}`,
      format,
      bytes: new Uint8Array(await response.arrayBuffer()),
      version: "1",
    };
    options = {
      document: saved,
      engines: [
        docxEngine(),
        rhwpEngine({ studioUrl: "/editor-assets/rhwp/index.html" }),
      ],
      appearance: "embedded",
      draftNamespace: "ui-test",
      draftStore: {
        get: async (key) => drafts.get(key),
        put: async (draft) => {
          api.draftStarted = true;
          if (api.holdDraft)
            await new Promise<void>((resolve) => {
              api.releaseDraft = resolve;
            });
          if (api.failDraft) throw new Error("UI test draft failure");
          drafts.set(draft.key, draft);
        },
        delete: async (key) => {
          drafts.delete(key);
        },
      },
      storage: {
        async save({ document: source, bytes }) {
          if (api.failSave) throw new Error("UI test storage failure");
          api.saves++;
          saved = {
            ...source,
            bytes: bytes.slice(),
            version: String(api.saves + 1),
          };
          return { version: saved.version! };
        },
      },
      ui: {
        containers: {
          toolbar: element("top"),
          statusBar: element("bottom"),
          tools: element("side"),
        },
        theme: {
          accent: "#6c3be9",
          background: "#ffffff",
          text: "#25212f",
          border: "#d9d5e4",
          radius: "4px",
        },
      },
      ...(mode === "react"
        ? {
            slots: {
              toolbar: (context: EditorUIContext) => {
                currentContext = context;
                if (toolbarMode === "throw")
                  throw new Error("Host toolbar render failure");
                return (
                  <div className="host-toolbar">
                    <button
                      type="button"
                      disabled={!context.snapshot.ready}
                      onClick={() => context.openTools("automation")}
                    >
                      앱 자동화
                    </button>
                    <button
                      type="button"
                      disabled={!context.snapshot.commands.bold?.enabled}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() =>
                        void context.execute({ id: "bold" }).catch(() => {})
                      }
                    >
                      앱 굵게
                    </button>
                    {toolbarMode === "extend" && context.defaultContent}
                  </div>
                );
              },
              statusBar: (context: EditorUIContext) => (
                <div>
                  <p className="host-status" role="status">
                    앱 상태: {context.snapshot.dirty ? "미저장" : "변경 없음"}
                  </p>
                  {context.defaultContent}
                </div>
              ),
            },
          }
        : {}),
    };
    if (mode === "react") {
      root = createRoot(element("editor"));
      paint();
    } else {
      const { slots: _slots, ...plain } = options;
      browser = await mountDocumentEditor(element("editor"), plain);
    }
  },
  async ui(patch: EditorUIOptions) {
    options = { ...options, ui: patch };
    await update();
  },
  async relocate(destination: "side" | "alternative" | "dock") {
    await api.ui({
      ...options.ui,
      containers: {
        ...options.ui?.containers,
        tools: destination === "dock" ? undefined : element(destination),
      },
    });
  },
  async theme() {
    await api.ui({
      ...options.ui,
      theme: {
        accent: "#005c53",
        background: "#20252b",
        text: "#f3f4f5",
        border: "#69747f",
        panel: "#252b32",
        fontFamily: "monospace",
      },
    });
  },
  async readonly(value: boolean) {
    options = { ...options, readOnly: value };
    await update();
  },
  async rerender() {
    options = {
      ...options,
      ui: { ...options.ui, theme: { ...options.ui?.theme } },
    };
    await update();
  },
  async toolbar(value: string) {
    toolbarMode = value;
    await update();
  },
  async invalidTarget() {
    await api.ui({
      ...options.ui,
      containers: {
        ...options.ui?.containers,
        tools: document.createElement("div"),
      },
    });
  },
  async save() {
    await controller().save();
  },
  async exported() {
    return [...(await controller().exportDocument()).bytes];
  },
  async close() {
    if (browser) await browser.destroy();
    else {
      await controller().flushDraft();
      root?.unmount();
    }
  },
  async reopen() {
    const copy = { ...saved, bytes: saved.bytes.slice(), id: "reopened" };
    options = { ...options, document: copy };
    if (browser) await browser.update({ document: copy });
    else {
      await controller().flushDraft();
      paint();
    }
  },
  customCommand: () =>
    currentContext.execute({ id: "insertText", value: "CUSTOM" }),
};
function controller() {
  return browser ?? ref.current!;
}
function paint() {
  flushSync(() =>
    root!.render(
      createElement(DocumentEditor, {
        ...options,
        key: options.document.id,
        ref,
      }),
    ),
  );
}
async function update() {
  if (browser)
    await browser.update({ ui: options.ui, readOnly: options.readOnly });
  else paint();
}
declare global {
  interface Window {
    uiStudioTest: typeof api;
  }
}
window.uiStudioTest = api;
