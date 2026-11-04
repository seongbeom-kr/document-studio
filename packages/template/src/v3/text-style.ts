import {
  inlineTokens,
  parent,
  elements,
  NS,
  type Element,
  type Node,
} from "../xml";
import { writeRange } from "../render";
import type { TemplateFormat } from "../types";

export interface StyledUnitV3<S> {
  char: number;
  style: S;
}
export interface TextChangeV3 {
  start: number;
  end: number;
  text: string;
}

/** Retain unchanged styled affixes; changed text uses the replaced body style, not a marker's size. */
export function styledReplacementV3<S>(
  units: readonly StyledUnitV3<S>[],
  change: TextChangeV3,
  key: (style: S) => string,
) {
  const original = units
    .slice(change.start, change.end)
    .map((unit) => String.fromCharCode(unit.char))
    .join("");
  if (original === change.text) return null;
  const before = [...original],
    after = [...change.text];
  let prefix = 0,
    suffix = 0;
  while (
    prefix < Math.min(before.length, after.length) &&
    before[prefix] === after[prefix]
  )
    prefix++;
  while (
    suffix < Math.min(before.length, after.length) - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  )
    suffix++;
  const start = change.start + before.slice(0, prefix).join("").length;
  const end = change.end - (suffix ? before.slice(-suffix).join("").length : 0);
  const text = after.slice(prefix, suffix ? -suffix : undefined).join("");
  let chosen = units[start]?.style ?? units[start - 1]?.style;
  const weights = new Map<string, { weight: number; style: S }>();
  for (const unit of units.slice(start, end)) {
    if (/\s/u.test(String.fromCharCode(unit.char))) continue;
    const id = key(unit.style),
      current = weights.get(id);
    if (current) current.weight++;
    else weights.set(id, { weight: 1, style: unit.style });
  }
  let largest = 0;
  for (const entry of weights.values())
    if (entry.weight > largest) {
      largest = entry.weight;
      chosen = entry.style;
    }
  return { start, end, text, style: chosen };
}

function styleKey(node: Node, format: TemplateFormat) {
  const run = parent(node, format === "docx" ? "r" : "run", NS[format]);
  if (!run) return "";
  return JSON.stringify([
    Array.from(run.attributes)
      .map((attribute) => [
        attribute.namespaceURI,
        attribute.localName,
        attribute.value,
      ])
      .sort((a, b) =>
        JSON.stringify(a) < JSON.stringify(b)
          ? -1
          : JSON.stringify(a) > JSON.stringify(b)
            ? 1
            : 0,
      ),
    elements(run)
      .filter((element) => element.localName === "rPr")
      .map((element) => element.toString()),
  ]);
}

export function writeStyledRangeV3(
  p: Element,
  start: number,
  end: number,
  text: string,
  format: TemplateFormat,
): void {
  const tokens = inlineTokens(p, NS[format]);
  const units = tokens.flatMap((token) =>
    token.value.split("").map((char) => ({
      char: char.charCodeAt(0),
      style: styleKey(token.node, format),
    })),
  );
  const edit = styledReplacementV3(
    units,
    { start, end, text },
    (style) => style,
  );
  if (!edit) return;
  const anchor = tokens.find(
    (token) =>
      [3, 4].includes(token.node.nodeType) &&
      token.end > edit.start &&
      token.start < edit.end &&
      styleKey(token.node, format) === edit.style,
  );
  writeRange(p, edit.start, edit.end, edit.text, format, anchor?.node);
}
