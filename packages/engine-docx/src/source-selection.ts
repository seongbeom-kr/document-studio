import type { OoxmlNode, OoxmlPart } from "@docx-editor.dev/core/store";
import type { Editor } from "@docx-editor.dev/react";
import type { DocxEditorInstance } from "@docx-editor.dev/core/editor";
import {
  sourceBytesHash,
  type SourceAddress,
  type SourceSelection,
} from "@document-studio/core";
const ns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const textOf = (node: OoxmlNode, text = false): string => {
  if (node.kind === "textValue") return text ? node.value : "";
  if (node.namespaceUri === ns && ["br", "cr"].includes(node.localName))
    return "\n";
  if (node.namespaceUri === ns && node.localName === "tab") return "\t";
  return node.children
    .filter((n) => !("localName" in n && n.localName === "p"))
    .map((n) => textOf(n, text || node.localName === "t"))
    .join("");
};
export function docxSourceIndex(part: OoxmlPart) {
  const result: {
    nodeId: string;
    address: Extract<SourceAddress, { format: "docx" }>;
    text: string;
  }[] = [];
  const visit = (
    node: OoxmlNode,
    path: Extract<SourceAddress, { format: "docx" }>["path"],
    index: number,
  ) => {
    if (!("localName" in node)) return;
    const next = [
      ...path,
      { namespace: node.namespaceUri, name: node.localName, index },
    ];
    if (node.namespaceUri === ns && node.localName === "p")
      result.push({
        nodeId: node.id,
        address: {
          format: "docx",
          part: part.name.replace(/^\//, ""),
          path: next,
        },
        text: textOf(node),
      });
    const ordinals = new Map<string, number>();
    for (const child of node.children)
      if ("localName" in child) {
        const key = JSON.stringify([child.namespaceUri, child.localName]),
          ordinal = ordinals.get(key) ?? 0;
        ordinals.set(key, ordinal + 1);
        visit(child, next, ordinal);
      }
  };
  visit(part.root, [], 0);
  return result;
}
export function createDocxSourceSelection(
  editor: Editor,
  bytes: Uint8Array,
  readOnly: () => boolean,
  root: () => HTMLElement | null,
) {
  const instance = editor as DocxEditorInstance,
    revision = editor.getDocumentHandle().revision,
    hash = sourceBytesHash(bytes);
  let paragraphHighlight: string | undefined,
    active = true;
  const paint = () => {
    const paragraphs = Array.from(
      root()?.querySelectorAll<HTMLElement>(
        ".docx-paragraph-fragment[data-paragraph-id]",
      ) ?? [],
    );
    for (const paragraph of paragraphs)
      paragraph.classList.toggle(
        "ds-template-anchor",
        paragraph.dataset.paragraphId === paragraphHighlight,
      );
    return paragraphs.some((p) => p.dataset.paragraphId === paragraphHighlight);
  };
  const observer = new MutationObserver(() => paint());
  if (root()) observer.observe(root()!, { childList: true, subtree: true });
  const check = () => {
    if (
      !active ||
      !readOnly() ||
      editor.getDocumentHandle().revision !== revision
    )
      throw new Error("TEMPLATE_SELECTION_READ_ONLY_REQUIRED");
    const surface = instance.surface;
    if (!surface) throw new Error("TEMPLATE_SELECTION_UNSUPPORTED");
    const part = surface.session.partFor({ kind: "body" });
    if (!part) throw new Error("TEMPLATE_SELECTION_UNSUPPORTED");
    return { surface, index: docxSourceIndex(part) };
  };
  return {
    dispose() {
      active = false;
      observer.disconnect();
      paragraphHighlight = undefined;
      paint();
    },
    async captureSourceSelection(): Promise<SourceSelection> {
      const { surface, index } = check();
      if (
        surface.storyScope().kind !== "body" ||
        surface.drawingSelectionIntent().kind === "pointer" ||
        editor.getSelectedImage() ||
        editor.getTableCellSelection()
      )
        throw new Error("TEMPLATE_SELECTION_UNSUPPORTED");
      const range = surface.state().selection;
      if (!range || range.anchor.paragraphId !== range.head.paragraphId)
        throw new Error("TEMPLATE_SELECTION_SINGLE_PARAGRAPH");
      const found = index.find((p) => p.nodeId === range.anchor.paragraphId);
      if (!found) throw new Error("TEMPLATE_SELECTION_UNSUPPORTED");
      const start = Math.min(range.anchor.offset, range.head.offset),
        end = Math.max(range.anchor.offset, range.head.offset),
        sourceHash = await hash;
      check();
      return {
        sourceHash,
        address: found.address,
        text: found.text,
        ...(start !== end ? { start, end } : {}),
      };
    },
    async highlightSourceSelection(selection: SourceSelection | null) {
      const { index } = check();
      if (selection && selection.sourceHash !== (await hash))
        throw new Error("TEMPLATE_SELECTION_STALE");
      check();
      editor.clearHighlights("document-studio-template");
      editor.clearAnchorHighlight({ animation: false });
      paragraphHighlight = undefined;
      paint();
      if (!selection) return;
      const found = index.find(
        (p) => JSON.stringify(p.address) === JSON.stringify(selection.address),
      );
      if (!found || found.text !== selection.text)
        throw new Error("TEMPLATE_SELECTION_PROVENANCE");
      editor.scrollToBlock(found.nodeId);
      if (selection.start === undefined) paragraphHighlight = found.nodeId;
      const shown =
        selection.start === undefined
          ? paint()
          : editor.setHighlights(
              "document-studio-template",
              [
                {
                  blockId: found.nodeId,
                  start: selection.start,
                  length: selection.end! - selection.start,
                  expectedText: found.text.slice(
                    selection.start,
                    selection.end,
                  ),
                },
              ],
              {
                color: "#2563eb30",
                className: "ds-template-range",
                priority: 30,
              },
            ).applied === 1;
      if (!shown) throw new Error("TEMPLATE_SELECTION_UNSUPPORTED");
    },
  };
}
