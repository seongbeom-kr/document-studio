import type {
  Editor,
  EditorCommand as NativeCommand,
} from "@docx-editor.dev/react";
import { commandForSlotValue } from "@docx-editor.dev/core/editor";
import type { CommandId, EditorCommand } from "@document-studio/core";
export const mmToTwips = (mm: number) => Math.round((mm * 1440) / 25.4);
export const WORD_HIGHLIGHT: Record<string, string> = {
  "000000": "black",
  "0000ff": "blue",
  "00ffff": "cyan",
  "00ff00": "green",
  ff00ff: "magenta",
  ff0000: "red",
  ffff00: "yellow",
  ffffff: "white",
  "000080": "darkBlue",
  "008080": "darkCyan",
  "008000": "darkGreen",
  "800080": "darkMagenta",
  "800000": "darkRed",
  "808000": "darkYellow",
  "808080": "darkGray",
  c0c0c0: "lightGray",
};
const highlightLabels: Record<string, string> = {
  black: "검정",
  blue: "파랑",
  cyan: "청록",
  green: "초록",
  magenta: "자홍",
  red: "빨강",
  yellow: "노랑",
  white: "흰색",
  darkBlue: "진한 파랑",
  darkCyan: "진한 청록",
  darkGreen: "진한 초록",
  darkMagenta: "진한 자홍",
  darkRed: "진한 빨강",
  darkYellow: "진한 노랑",
  darkGray: "진한 회색",
  lightGray: "밝은 회색",
};
export const WORD_HIGHLIGHT_CHOICES = Object.entries(WORD_HIGHLIGHT).map(
  ([rgb, name]) => ({
    value: `#${rgb}`,
    label: highlightLabels[name] ?? name,
  }),
);
export function highlightRgb(name: unknown): string | undefined {
  if (typeof name !== "string") return undefined;
  const color = Object.entries(WORD_HIGHLIGHT).find(
    ([, value]) => value.toLowerCase() === name.toLowerCase(),
  );
  return color ? `#${color[0]}` : undefined;
}
export function nativeCommand(
  command: EditorCommand,
  editor: Editor,
): NativeCommand | null {
  const selection = editor.snapshot().selection;
  switch (command.id) {
    case "selectAll":
    case "undo":
    case "redo":
    case "clearFormatting":
      return { type: command.id };
    case "bold":
    case "italic":
    case "underline":
    case "strike":
    case "superscript":
    case "subscript":
      return { type: "toggleMark", mark: command.id };
    case "fontFamily":
      return commandForSlotValue("font.family", command.value);
    case "fontSize":
      return commandForSlotValue("font.size", command.value * 2);
    case "textColor":
      return commandForSlotValue("text.color", command.value.slice(1));
    case "highlightColor": {
      // Word highlighting stores ST_HighlightColor names rather than arbitrary RGB.
      const name = WORD_HIGHLIGHT[command.value.slice(1).toLowerCase()];
      if (!name)
        throw new Error(
          "DOCX 강조색은 Word의 기본 16색만 지원합니다. 예: #ffff00(노랑).",
        );
      return commandForSlotValue("text.highlight", name);
    }
    case "characterSpacing":
      return {
        type: "setMarkAttr",
        mark: "spacing",
        attr: "val",
        value: Math.round(command.value * 20),
      };
    case "characterScale":
      return {
        type: "setMarkAttr",
        mark: "scale",
        attr: "val",
        value: command.value,
      };
    case "lineSpacing":
      return { type: "setLineSpacing", rule: "multiple", value: command.value };
    case "alignLeft":
      return { type: "setAlignment", align: "left" };
    case "alignCenter":
      return { type: "setAlignment", align: "center" };
    case "alignRight":
      return { type: "setAlignment", align: "right" };
    case "alignJustify":
      return { type: "setAlignment", align: "justify" };
    case "bulletList":
      return { type: "toggleList", kind: "bullet" };
    case "numberedList":
      return { type: "toggleList", kind: "ordered" };
    case "increaseIndent":
    case "decreaseIndent":
      return selection
        ? {
            type: "adjustIndent",
            target: selection,
            direction:
              command.id === "increaseIndent" ? "increase" : "decrease",
          }
        : null;
    case "pageBreak":
    case "lineBreak":
      return selection
        ? {
            type: "insertBreak",
            target: selection,
            kind: command.id === "pageBreak" ? "page" : "line",
          }
        : null;
    case "insertText":
      return { type: "pasteWithoutFormatting", text: command.value };
    case "paragraphFormat": {
      const value = command.value;
      return {
        type: "setParagraphFormat",
        ...(value.beforePt !== undefined
          ? { spaceBeforePt: value.beforePt }
          : {}),
        ...(value.afterPt !== undefined ? { spaceAfterPt: value.afterPt } : {}),
        ...(value.leftMm !== undefined
          ? { indentLeftTwips: mmToTwips(value.leftMm) }
          : {}),
        ...(value.rightMm !== undefined
          ? { indentRightTwips: mmToTwips(value.rightMm) }
          : {}),
        ...(value.firstLineMm !== undefined
          ? { indentFirstLineTwips: mmToTwips(value.firstLineMm) }
          : {}),
        ...(value.lineSpacing ? { lineSpacing: value.lineSpacing } : {}),
        ...Object.fromEntries(
          ["keepNext", "keepLines", "widowControl", "pageBreakBefore"]
            .filter((key) => value[key as keyof typeof value] !== undefined)
            .map((key) => [key, value[key as keyof typeof value]]),
        ),
      };
    }
    case "pageSetup": {
      const v = command.value;
      return {
        type: "setPageSetup",
        pageWidth: mmToTwips(v.widthMm),
        pageHeight: mmToTwips(v.heightMm),
        marginTop: mmToTwips(v.topMm),
        marginBottom: mmToTwips(v.bottomMm),
        marginLeft: mmToTwips(v.leftMm),
        marginRight: mmToTwips(v.rightMm),
        orientation: v.orientation,
        scope: v.scope ?? "document",
      };
    }
    case "insertTable":
      return selection
        ? {
            type: "insertTable",
            target: selection,
            rows: command.value.rows,
            cols: command.value.columns,
          }
        : null;
    case "insertRowAbove":
    case "insertRowBelow":
      return {
        type: "insertRow",
        where: command.id === "insertRowAbove" ? "above" : "below",
      };
    case "insertColumnLeft":
    case "insertColumnRight":
      return {
        type: "insertColumn",
        where: command.id === "insertColumnLeft" ? "left" : "right",
      };
    case "deleteRow":
    case "deleteColumn":
    case "deleteTable":
    case "mergeCells":
      return { type: command.id };
    case "splitCell":
      return {
        type: "splitCell",
        rows: command.value.rows,
        cols: command.value.columns,
      };
    case "cellFill":
      return {
        type: "setCellFill",
        color: { kind: "hex", value: command.value.slice(1) },
      };
    case "cellVerticalAlign":
      return {
        type: "setTableCellVerticalAlignment",
        alignment: command.value,
      };
    case "tableBorders":
      return command.value.scope === "none"
        ? { type: "setTableBorders", scope: "none", target: "all" }
        : {
            type: "setTableBorders",
            scope: command.value.scope,
            spec: {
              style: "single",
              size: Math.round(command.value.widthPt * 8),
              color: { kind: "hex", value: command.value.color.slice(1) },
            },
          };
    case "insertImage":
      return {
        type: "insertImage",
        data: command.value.bytes,
        mime: command.value.mimeType,
        widthPoints: ((command.value.widthMm ?? 40) * 72) / 25.4,
        heightPoints: ((command.value.heightMm ?? 30) * 72) / 25.4,
        description: command.value.alt,
        expectedPackageRevision: editor.getDocumentHandle().revision,
      };
    case "showParagraphMarks":
      return { type: "toggleParagraphMarks" };
    case "zoom":
      return null;
  }
}
export function probeCommand(id: CommandId): EditorCommand {
  switch (id) {
    case "fontFamily":
      return { id, value: "Arial" };
    case "fontSize":
      return { id, value: 11 };
    case "lineSpacing":
      return { id, value: 1.6 };
    case "zoom":
      return { id, value: 1 };
    case "characterSpacing":
      return { id, value: 0 };
    case "characterScale":
      return { id, value: 100 };
    case "textColor":
    case "highlightColor":
    case "cellFill":
      return { id, value: "#000000" };
    case "paragraphFormat":
      return { id, value: { afterPt: 0 } };
    case "pageSetup":
      return {
        id,
        value: {
          widthMm: 210,
          heightMm: 297,
          topMm: 20,
          bottomMm: 20,
          leftMm: 20,
          rightMm: 20,
          orientation: "portrait",
        },
      };
    case "insertTable":
    case "splitCell":
      return { id, value: { rows: 2, columns: 2 } };
    case "cellVerticalAlign":
      return { id, value: "top" };
    case "tableBorders":
      return { id, value: { scope: "all", color: "#000000", widthPt: 0.5 } };
    case "insertText":
      return { id, value: "text" };
    case "insertImage":
      return {
        id,
        value: {
          bytes: new Uint8Array([137, 80, 78, 71]),
          mimeType: "image/png",
        },
      };
    default:
      return { id };
  }
}
