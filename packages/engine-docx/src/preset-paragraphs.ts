import {
  directParagraphProperties,
  ensureListDefinition,
  ensureNumberingLevel,
  type OoxmlNode,
} from "@docx-editor.dev/core/store";
import type { DocxEditorInstance } from "@docx-editor.dev/core/editor";
import type { Editor } from "@docx-editor.dev/react";
import type { EditorCommand } from "@document-studio/core";
import { mmToTwips } from "./commands";
type Session = NonNullable<DocxEditorInstance["surface"]>["session"];
type Part = NonNullable<ReturnType<Session["partFor"]>>;
type Op = Parameters<Session["applyTreeOps"]>[0][number];
type Options = NonNullable<Parameters<Session["applyTreeOps"]>[4]>;
type Property = ReturnType<typeof directParagraphProperties>[number];
const child = (
  node: OoxmlNode | undefined,
  name: string,
): OoxmlNode | undefined =>
  node && "children" in node
    ? node.children.find((n) => "localName" in n && n.localName === name)
    : undefined;
const attr = (node: OoxmlNode | undefined, name: string): string | undefined =>
  node && "attributes" in node
    ? node.attributes.find((a) => a.localName === name)?.value
    : undefined;
export function paragraphPresetPlan(
  editor: Editor,
  session: Session,
  part: Part,
  nodes: readonly OoxmlNode[],
  commands: readonly EditorCommand[],
): { ops: Op[]; packageEdits: Options["packageEdits"] } {
  const ops: Op[] = [],
    packageEdits: Array<NonNullable<Options["packageEdits"]>[number]> = [];
  let planned = session.currentPackage();
  const definitions = new Map<number, string>();
  const activated = new Map<
    number,
    { kind: "bullet" | "ordered"; enabled: boolean }
  >();
  const active = {
    bullet: editor.isActive({ type: "toggleList", kind: "bullet" }),
    ordered: editor.isActive({ type: "toggleList", kind: "ordered" }),
  };
  commands.forEach((command, index) => {
    if (command.id === "clearFormatting") {
      active.bullet = false;
      active.ordered = false;
    }
    if (command.id === "bulletList" || command.id === "numberedList") {
      const kind = command.id === "bulletList" ? "bullet" : "ordered",
        enabled = !active[kind];
      active.bullet = kind === "bullet" && enabled;
      active.ordered = kind === "ordered" && enabled;
      activated.set(index, { kind, enabled });
      if (enabled) {
        const definition = ensureListDefinition(planned, kind);
        if (!definition) throw new Error("목록 정의를 만들 수 없습니다.");
        planned = definition.pkg;
        definitions.set(index, definition.numId);
        packageEdits.push((pkg) => {
          const next = ensureListDefinition(pkg, kind);
          if (!next || next.numId !== definition.numId)
            throw new Error("목록 정의가 변경됐습니다.");
          return next.pkg;
        });
      }
    }
  });
  for (const node of nodes) {
    const props = new Map(
      directParagraphProperties(part, node.id).map((p) => [p.localName, p]),
    );
    const num = child(child(node, "pPr"), "numPr");
    let numId = attr(child(num, "numId"), "val") ?? null,
      level = Number(attr(child(num, "ilvl"), "val") ?? 0),
      numberingChanged = false;
    let kind: "bullet" | "ordered" = editor.isActive({
      type: "toggleList",
      kind: "bullet",
    })
      ? "bullet"
      : "ordered";
    let changed = false;
    const put = (name: string, attributes: Record<string, string>) => {
      props.set(name, { localName: name, attributes });
      changed = true;
    };
    commands.forEach((command, index) => {
      switch (command.id) {
        case "clearFormatting":
          props.clear();
          numId = null;
          level = 0;
          numberingChanged = true;
          changed = true;
          break;
        case "alignLeft":
        case "alignCenter":
        case "alignRight":
        case "alignJustify":
          put("jc", {
            val: {
              alignLeft: "left",
              alignCenter: "center",
              alignRight: "right",
              alignJustify: "both",
            }[command.id],
          });
          break;
        case "lineSpacing":
          put("spacing", {
            ...props.get("spacing")?.attributes,
            line: String(Math.round(command.value * 240)),
            lineRule: "auto",
          });
          break;
        case "paragraphFormat": {
          const v = command.value,
            spacing = { ...props.get("spacing")?.attributes },
            indent = { ...props.get("ind")?.attributes };
          if (v.beforePt !== undefined)
            spacing.before = String(Math.round(v.beforePt * 20));
          if (v.afterPt !== undefined)
            spacing.after = String(Math.round(v.afterPt * 20));
          if (v.lineSpacing) {
            spacing.line = String(
              Math.round(
                v.lineSpacing.value *
                  (v.lineSpacing.rule === "multiple" ? 240 : 20),
              ),
            );
            spacing.lineRule = {
              multiple: "auto",
              exact: "exact",
              atLeast: "atLeast",
            }[v.lineSpacing.rule];
          }
          if (Object.keys(spacing).length) put("spacing", spacing);
          if (v.leftMm !== undefined) indent.left = String(mmToTwips(v.leftMm));
          if (v.rightMm !== undefined)
            indent.right = String(mmToTwips(v.rightMm));
          if (v.firstLineMm !== undefined) {
            indent.firstLine = String(Math.max(0, mmToTwips(v.firstLineMm)));
            indent.hanging = String(Math.max(0, -mmToTwips(v.firstLineMm)));
          }
          if (Object.keys(indent).length) put("ind", indent);
          for (const key of [
            "keepNext",
            "keepLines",
            "widowControl",
            "pageBreakBefore",
          ] as const)
            if (v[key] !== undefined) put(key, { val: v[key] ? "1" : "0" });
          break;
        }
        case "bulletList":
        case "numberedList": {
          const activation = activated.get(index)!;
          kind = activation.kind;
          numId = activation.enabled ? definitions.get(index)! : null;
          level = 0;
          numberingChanged = true;
          break;
        }
        case "increaseIndent":
        case "decreaseIndent": {
          const delta = command.id === "increaseIndent" ? 1 : -1;
          if (numId && numId !== "0") {
            const next = level + delta;
            if (next < 0 || next > 8)
              throw new Error("목록 들여쓰기 단계는 0~8입니다.");
            const extended = ensureNumberingLevel(planned, numId, next, kind);
            if (!extended)
              throw new Error("이 목록의 들여쓰기 단계를 변경할 수 없습니다.");
            planned = extended;
            const id = numId,
              target = next,
              listKind = kind;
            packageEdits.push((pkg) => {
              const changed = ensureNumberingLevel(pkg, id, target, listKind);
              if (!changed) throw new Error("목록 정의가 변경됐습니다.");
              return changed;
            });
            level = next;
            numberingChanged = true;
          } else {
            const indent = { ...props.get("ind")?.attributes };
            indent.left = String(
              Math.max(0, Number(indent.left ?? 0) + delta * 720),
            );
            put("ind", indent);
          }
          break;
        }
      }
    });
    if (changed)
      ops.push({
        op: "setParagraphProperties",
        paragraphId: node.id,
        properties: [...props.values()] as Property[],
      });
    if (numberingChanged)
      ops.push({ op: "setListNumbering", paragraphId: node.id, numId, level });
  }
  return { ops, packageEdits };
}
