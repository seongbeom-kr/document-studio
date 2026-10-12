import { createDocxEditor } from "@docx-editor.dev/core/editor";
import { applyDocxPreset } from "../../../packages/engine-docx/src/apply-preset";
import type { EditorCommand } from "@document-studio/core";
import "@docx-editor.dev/core/styles/editor.css";
const response = await fetch("/samples/rich.docx");
if (!response.ok) throw new Error("Missing native DOCX fixture");
const bytes = new Uint8Array(await response.arrayBuffer());
const container = document.getElementById("probe")!;
container.style.cssText =
  "height:100vh;width:100%;position:relative;overflow:auto";
const editor = createDocxEditor({ container, document: bytes });
declare global {
  interface Window {
    nativePresetProbe: {
      ready(): boolean;
      execute(command: EditorCommand): void;
      apply(commands: EditorCommand[], injectFailure?: boolean): void;
      save(): Promise<number[]>;
    };
  }
}
window.nativePresetProbe = {
  ready: () =>
    !editor.snapshot().isOpening &&
    !editor.snapshot().isLoading &&
    !!editor.surface,
  execute: (command) => {
    if (
      command.id === "selectAll" ||
      command.id === "undo" ||
      command.id === "redo"
    ) {
      const result = editor.exec({ type: command.id });
      if (!result.ok) throw new Error(result.reason);
    }
  },
  apply: (commands, injectFailure = false) => {
    const session = editor.surface!.session,
      original = session.applyTreeOps;
    if (injectFailure)
      session.applyTreeOps = (ops, before, after, scope, options) =>
        original.call(
          session,
          [
            ...ops,
            {
              op: "setParagraphProperties",
              paragraphId: "missing-paragraph",
              properties: [],
            },
          ],
          before,
          after,
          scope,
          options,
        );
    try {
      applyDocxPreset(editor, commands, {
        expectedRevision: String(editor.getDocumentHandle().revision),
        assertCurrent: () => {},
      });
    } finally {
      session.applyTreeOps = original;
    }
  },
  save: async () => Array.from(new Uint8Array(await editor.save())),
};
