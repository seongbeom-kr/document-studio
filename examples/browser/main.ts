import {
  mountDocumentEditor,
  type MountedDocumentEditor,
} from "@document-studio/browser";
import {
  detectFormat,
  browserDraftStore,
  createAgentBridge,
} from "@document-studio/core";
import { docxEngine } from "@document-studio/engine-docx";
import { rhwpEngine } from "@document-studio/engine-rhwp";
import "@document-studio/browser/styles.css";

let editor: MountedDocumentEditor | undefined;
const engines = [
  docxEngine(),
  rhwpEngine({ studioUrl: "/editor-assets/rhwp/index.html" }),
];
const draftStore = browserDraftStore();
if (new URLSearchParams(location.search).get("verify") === "true")
  Object.assign(window, {
    documentStudioExample: {
      inspect: () => {
        if (!editor) throw new Error("Open a document first.");
        const agent = createAgentBridge(() => editor ?? null),
          state = agent.getState();
        return agent.inspect({
          documentId: state.documentId,
          expectedSessionId: state.sessionId,
        });
      },
    },
  });

async function openFile(host: HTMLElement, file: File) {
  const document = {
    id: file.name,
    fileName: file.name,
    format: detectFormat(file.name),
    bytes: new Uint8Array(await file.arrayBuffer()),
  };
  if (editor) await editor.update({ document });
  else
    editor = await mountDocumentEditor(host, {
      document,
      engines,
      draftStore,
      draftNamespace: "browser-example:local-user",
      ui: {
        containers: {
          toolbar: documentElement("editor-toolbar"),
          statusBar: documentElement("editor-status"),
          tools: documentElement("editor-tools"),
        },
        theme: { accent: "#6c3be9", radius: "4px" },
      },
    });
  await editor.whenReady();
}
function documentElement(id: string): HTMLElement {
  return window.document.getElementById(id)!;
}

if (new URLSearchParams(location.search).get("host") === "vue") {
  const { createApp, h, ref } = await import("vue");
  createApp({
    setup() {
      const host = ref<HTMLElement>();
      const status = ref("문서를 선택하세요.");
      const busy = ref(false);
      const run = async (action: () => Promise<unknown>) => {
        if (busy.value) return;
        busy.value = true;
        status.value = "처리 중…";
        try {
          await action();
          status.value = "완료";
        } catch (error) {
          status.value = String(error);
        } finally {
          busy.value = false;
        }
      };
      return () =>
        h("section", [
          h("h1", "Vue 앱의 문서 편집기"),
          h("label", [
            "문서 파일",
            h("input", {
              type: "file",
              accept: ".docx,.hwpx,.hwp",
              disabled: busy.value,
              onChange: (event: Event) => {
                const file = (event.target as HTMLInputElement).files?.[0];
                if (file && host.value)
                  void run(() => openFile(host.value!, file));
              },
            }),
          ]),
          h(
            "button",
            {
              disabled: busy.value || !editor,
              onClick: () =>
                run(async () => {
                  await editor?.save();
                }),
            },
            "저장하고 다운로드",
          ),
          h(
            "button",
            {
              disabled: busy.value || !editor,
              onClick: () =>
                run(async () => {
                  // Await before a parent route/component removes the host node.
                  await editor?.destroy();
                  editor = undefined;
                }),
            },
            "초안 보관 후 닫기",
          ),
          h("p", { role: "status" }, status.value),
          h("section", { class: "document-layout" }, [
            h("header", { id: "editor-toolbar" }),
            h("div", { ref: host, class: "document-surface" }),
            h("aside", { id: "editor-tools", "aria-label": "문서 도구 영역" }),
            h("footer", { id: "editor-status" }),
          ]),
        ]);
    },
  }).mount("#app");
} else {
  const root = document.querySelector<HTMLElement>("#app")!;
  root.innerHTML =
    '<h1>JavaScript 앱의 문서 편집기</h1><label>문서 파일<input type="file" accept=".docx,.hwpx,.hwp"></label><button id="save">저장하고 다운로드</button><button id="close">초안 보관 후 닫기</button><p role="status">문서를 선택하세요.</p><section class="document-layout"><header id="editor-toolbar"></header><div id="editor" class="document-surface"></div><aside id="editor-tools" aria-label="문서 도구 영역"></aside><footer id="editor-status"></footer></section>';
  const host = root.querySelector<HTMLElement>("#editor")!;
  const status = root.querySelector('[role="status"]')!;
  const input = root.querySelector("input")!;
  const save = root.querySelector<HTMLButtonElement>("#save")!;
  const close = root.querySelector<HTMLButtonElement>("#close")!;
  let busy = false;
  const controls = () => {
    input.disabled = busy;
    save.disabled = close.disabled = busy || !editor;
  };
  controls();
  const run = async (action: () => Promise<unknown>) => {
    if (busy) return;
    busy = true;
    controls();
    status.textContent = "처리 중…";
    try {
      await action();
      status.textContent = "완료";
    } catch (error) {
      status.textContent = String(error);
    } finally {
      busy = false;
      controls();
    }
  };
  input.onchange = (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) void run(() => openFile(host, file));
  };
  save.onclick = () =>
    void run(async () => {
      await editor?.save();
    });
  close.onclick = () =>
    void run(async () => {
      await editor?.destroy();
      editor = undefined;
    });
}
