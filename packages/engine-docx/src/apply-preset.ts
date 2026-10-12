import type { Editor } from "@docx-editor.dev/react";
import type { DocxEditorInstance } from "@docx-editor.dev/core/editor";
import {
  mergedProperties,
  mergedParagraphMarkProperties,
  runPropertyEdits,
  runAddressRanges,
} from "@docx-editor.dev/core/store";
import type { OoxmlNode } from "@docx-editor.dev/core/store";
import {
  validateCommand,
  SaveConflictError,
  SelectionConflictError,
  type EditorCommand,
} from "@document-studio/core";
import { nativeCommand, WORD_HIGHLIGHT } from "./commands";
import { paragraphPresetPlan } from "./preset-paragraphs";
import { docxSelectionKey } from "./selection";

/** Pure planning followed by one guarded canonical transaction. All authored bags are preserved. */
export function applyDocxPreset(
  editor: Editor,
  commands: readonly EditorCommand[],
  options: {
    expectedRevision: string;
    expectedSelectionKey?: string;
    assertCurrent(): void;
  },
): void {
  const surface = (editor as DocxEditorInstance).surface;
  if (!surface) throw new Error("편집기를 준비한 뒤 서식을 적용해 주세요.");
  surface.flushPendingInput();
  if (
    options.expectedSelectionKey !== undefined &&
    options.expectedSelectionKey !== docxSelectionKey(editor)
  )
    throw new SelectionConflictError();
  const session = surface.session,
    scope = surface.storyScope(),
    part = session.partFor(scope);
  const selection = surface.state().selection;
  if (!part || !selection)
    throw new Error("서식을 적용할 문단을 선택해 주세요.");
  if (String(editor.getDocumentHandle().revision) !== options.expectedRevision)
    throw new SaveConflictError("서식을 준비하는 동안 문서가 변경됐습니다.");
  type Property = Parameters<typeof mergedProperties>[0][number];
  const runs = new Map<string, Property>();
  let clear = false;
  const toggles = new Map<string, boolean>();
  const put = (
    map: Map<string, Property>,
    name: string,
    attrs: Record<string, string> = {},
  ) => map.set(name, { localName: name, attributes: attrs });
  for (const command of commands) {
    validateCommand(command);
    const native = nativeCommand(command, editor);
    if (!native)
      throw new Error(`서식 묶음에서 지원하지 않는 명령입니다: ${command.id}`);
    const allowed = editor.can(native);
    if (!allowed.ok) throw new Error(allowed.reason);
    switch (command.id) {
      case "fontSize":
        put(runs, "sz", { val: String(Math.round(command.value * 2)) });
        break;
      case "fontFamily":
        put(runs, "rFonts", { ascii: command.value, hAnsi: command.value });
        break;
      case "textColor":
        put(runs, "color", { val: command.value.slice(1) });
        break;
      case "highlightColor":
        put(runs, "highlight", {
          val: WORD_HIGHLIGHT[command.value.slice(1).toLowerCase()]!,
        });
        break;
      case "characterSpacing":
        put(runs, "spacing", { val: String(Math.round(command.value * 20)) });
        break;
      case "characterScale":
        put(runs, "w", { val: String(command.value) });
        break;
      case "bold":
      case "italic":
      case "underline":
      case "strike":
      case "superscript":
      case "subscript": {
        const active = !(
          toggles.get(command.id) ??
          (!clear && editor.isActive(native))
        );
        toggles.set(command.id, active);
        if (active && command.id === "superscript")
          toggles.set("subscript", false);
        if (active && command.id === "subscript")
          toggles.set("superscript", false);
        const name = {
          bold: "b",
          italic: "i",
          underline: "u",
          strike: "strike",
          superscript: "vertAlign",
          subscript: "vertAlign",
        }[command.id];
        put(runs, name, {
          val:
            command.id === "underline"
              ? active
                ? "single"
                : "none"
              : name === "vertAlign"
                ? active
                  ? command.id
                  : "baseline"
                : active
                  ? "1"
                  : "0",
        });
        break;
      }
      case "clearFormatting":
        clear = true;
        runs.clear();
        toggles.clear();
        break;
      case "alignLeft":
      case "alignCenter":
      case "alignRight":
      case "alignJustify":
      case "lineSpacing":
      case "paragraphFormat":
        break;
      case "bulletList":
      case "numberedList":
      case "increaseIndent":
      case "decreaseIndent":
        break;
      default:
        throw new Error(
          `이 명령은 서식 묶음에 사용할 수 없습니다: ${command.id}.`,
        );
    }
  }
  const ids = session.paragraphIdsIn(scope);
  const a = ids.indexOf(selection.anchor.paragraphId),
    b = ids.indexOf(selection.head.paragraphId);
  if (a < 0 || b < 0) throw new Error("선택 문단을 확인할 수 없습니다.");
  const from =
    a < b || (a === b && selection.anchor.offset <= selection.head.offset)
      ? selection.anchor
      : selection.head;
  const to = from === selection.anchor ? selection.head : selection.anchor;
  type Op = Parameters<typeof session.applyTreeOps>[0][number];
  const ops: Op[] = [];
  const find = (node: OoxmlNode, id: string): OoxmlNode | undefined => {
    if (node.id === id) return node;
    if ("children" in node)
      for (const child of node.children) {
        const result = find(child, id);
        if (result) return result;
      }
    return undefined;
  };
  const collapsed =
    a === b && selection.anchor.offset === selection.head.offset;
  const selectedNodes: OoxmlNode[] = [];
  for (const id of ids.slice(Math.min(a, b), Math.max(a, b) + 1)) {
    const node = find(part.root, id);
    if (!node || node.kind !== "paragraph")
      throw new Error("선택 문단이 변경됐습니다.");
    selectedNodes.push(node);
    const length = Math.max(
      0,
      ...[...runAddressRanges(node).values()].map((range) => range.end),
    );
    const start = collapsed ? 0 : id === from.paragraphId ? from.offset : 0;
    const end = collapsed ? length : id === to.paragraphId ? to.offset : length;
    const incoming = [...runs.values()];
    if (clear || incoming.length) {
      for (const edit of runPropertyEdits(part, id, start, end, incoming))
        ops.push({
          op: "setRunProperties",
          paragraphId: id,
          ...edit,
          properties: clear ? incoming : edit.properties,
        });
      if (collapsed)
        ops.push({
          op: "setParagraphMarkProperties",
          paragraphId: id,
          properties: clear
            ? incoming
            : mergedParagraphMarkProperties(part, id, incoming),
        });
    }
  }
  const paragraphPlan = paragraphPresetPlan(
    editor,
    session,
    part,
    selectedNodes,
    commands,
  );
  ops.push(...paragraphPlan.ops);
  options.assertCurrent();
  const result = surface.applyAutomationOps(
    () => {
      options.assertCurrent();
      return ops;
    },
    scope,
    paragraphPlan.packageEdits,
  );
  if (result.rejected)
    throw new Error(
      String(result.reason ?? "문서가 서식 변경을 거절했습니다."),
    );
  editor.focus();
}
