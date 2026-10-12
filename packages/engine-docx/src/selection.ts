import type { Editor } from "@docx-editor.dev/react";
import type { DocxEditorInstance } from "@docx-editor.dev/core/editor";
/** getState().selection omits offsets in this pinned engine; use the public surface range. */
export function docxSelectionKey(editor: Editor): string {
  const surface = (editor as DocxEditorInstance).surface;
  return JSON.stringify(
    surface
      ? {
          scope: surface.storyScope(),
          range: surface.state().selection,
          drawing: surface.drawingSelectionIntent(),
        }
      : null,
  );
}
