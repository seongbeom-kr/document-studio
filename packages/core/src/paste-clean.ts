/**
 * Adapted from kordoc src/hwpx/paste-clean.ts at
 * 6f9ef253cc66bb30c8b26fe87811d2c5832de995 (MIT, copyright 2026 chrisryugj).
 * Original rules inspired by hwp-auto-docfit (MIT, copyright 2026 haijun93).
 * Full notices: third_party/kordoc; shipped in dist/licenses.
 *
 * Downstream changes: bounded input, change preview, matching fence lengths,
 * preservation of ZWNJ/word-joiner and inline code. No automatic paste handler.
 */
const INVISIBLE = /[\u200b\ufeff]/g;
const CITATION_TAG = /[ \t]?【[^【】†\n]*†[^【】\n]*】/g;
const ESCAPED_BOLD =
  /(?<![\\*])\\\*\\\*(?=[^\s\\*<])([^\\\n<]+?)(?<=[^\s\\*>])\\\*\\\*(?!\\\*)/g;

export interface PasteCleanupPreview {
  before: string;
  after: string;
  removed: number;
  changes: readonly { line: number; before: string; after: string }[];
}

/** Read-only preview. Markdown stays text; this does not apply rich formatting. */
export function previewPasteCleanup(text: string): PasteCleanupPreview {
  if (typeof text !== "string" || text.length > 10000)
    throw new TypeError("붙여넣기 원고는 10,000자까지 지원합니다.");
  let removed = 0;
  let fence: { char: string; length: number } | null = null;
  const changes: PasteCleanupPreview["changes"][number][] = [];
  const count = (
    re: RegExp,
    s: string,
    to: string | ((...a: string[]) => string),
  ) =>
    s.replace(re, (...a: string[]) => {
      removed++;
      return typeof to === "string" ? to : to(...a);
    });
  const after = text
    .split("\n")
    .map((line, index) => {
      // split preserves each CR before LF; exclude it only from fence parsing.
      // Keep the original line for output so mixed line endings stay byte-identical.
      const content = line.endsWith("\r") ? line.slice(0, -1) : line;
      const marker = content.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
      if (fence) {
        if (
          marker &&
          marker[1]![0] === fence.char &&
          marker[1]!.length >= fence.length &&
          /^[ \t]*$/.test(marker[2]!)
        )
          fence = null;
        return line;
      }
      if (marker) {
        fence = { char: marker[1]![0]!, length: marker[1]!.length };
        return line;
      }
      // Keep inline code and indented code entirely unchanged, including unmatched
      // backticks. Conservative omission is preferable to modifying code samples.
      if (line.includes("`") || /^(?: {4}|\t)/.test(line)) return line;
      let out = count(INVISIBLE, line, "");
      out = count(CITATION_TAG, out, "");
      out = count(ESCAPED_BOLD, out, (_match, inner) => `**${inner}**`);
      if (out !== line)
        changes.push({ line: index + 1, before: line, after: out });
      return out;
    })
    .join("\n");
  return { before: text, after, removed, changes };
}
