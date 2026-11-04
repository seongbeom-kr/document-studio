import {
  DOMParser,
  XMLSerializer,
  type Element,
  type Document,
  type Node,
} from "@xmldom/xmldom";
import { unzipSync, strToU8 } from "fflate";
import { validateDocumentArchive } from "@document-studio/core";
import { fail, TEMPLATE_LIMITS, type TemplateFormat } from "./types";
export { type Element, type Document, type Node };
export const NS = {
  docx: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
  hwpx: "http://www.hancom.co.kr/hwpml/2011/paragraph",
};
export const elements = (node: Node): Element[] =>
  Array.from(node.childNodes).filter((n): n is Element => n.nodeType === 1);
export const walk = (node: Node): Element[] =>
  elements(node).flatMap((child) => [child, ...walk(child)]);
export const parent = (
  node: Node,
  local: string,
  ns: string,
): Element | undefined => {
  for (let at = node.parentNode; at; at = at.parentNode)
    if (
      at.nodeType === 1 &&
      (at as Element).localName === local &&
      (at as Element).namespaceURI === ns
    )
      return at as Element;
};
export const attr = (node: Element, name: string) =>
  Array.from(node.attributes).find((a) => a.localName === name)?.value;
export function parseXml(bytes: Uint8Array): Document {
  if (bytes.length > TEMPLATE_LIMITS.xmlPartBytes) fail("TEMPLATE_XML_LIMIT");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return fail("TEMPLATE_XML_ENCODING");
  }
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) fail("TEMPLATE_UNSAFE_XML");
  let document: Document;
  try {
    document = new DOMParser({
      onError: () => fail("TEMPLATE_XML_INVALID"),
    }).parseFromString(text, "application/xml");
  } catch {
    return fail("TEMPLATE_XML_INVALID");
  }
  if (!document.documentElement) fail("TEMPLATE_XML_INVALID");
  let count = 0;
  const check = (node: Node, depth: number) => {
    if (depth > 128 || ++count > 200000) fail("TEMPLATE_XML_LIMIT");
    for (const child of elements(node)) check(child, depth + 1);
  };
  check(document, 0);
  return document;
}
export function openArchive(bytes: Uint8Array, format: TemplateFormat) {
  if (
    !["docx", "hwpx"].includes(format) ||
    bytes.length > TEMPLATE_LIMITS.sourceBytes
  )
    fail("TEMPLATE_FORMAT");
  validateDocumentArchive(bytes, format);
  const parts = unzipSync(bytes);
  let total = 0;
  const xml = new Map<string, Document>();
  for (const name of Object.keys(parts).sort())
    if (name.endsWith(".xml") || name.endsWith(".rels")) {
      total += parts[name]!.length;
      if (total > TEMPLATE_LIMITS.xmlBytes) fail("TEMPLATE_XML_LIMIT");
      const doc = parseXml(parts[name]!);
      // Never fetch linked resources while reading or rendering a template.
      if (name.endsWith(".rels"))
        for (const relation of walk(doc).filter(
          (n) => attr(n, "TargetMode") === "External",
        )) {
          let safeLink = false;
          try {
            safeLink =
              (attr(relation, "Type") ?? "").endsWith("/hyperlink") &&
              ["https:", "http:", "mailto:"].includes(
                new URL(attr(relation, "Target") ?? "").protocol,
              );
          } catch {
            /* Unsupported external object; never resolve or fetch it. */
          }
          if (!safeLink) fail("TEMPLATE_EXTERNAL_RELATIONSHIP");
        }
      xml.set(name, doc);
    }
  const bodyParts = [...xml.keys()]
    .filter((n) =>
      format === "docx"
        ? n === "word/document.xml"
        : /^Contents\/section\d+\.xml$/.test(n),
    )
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return { parts, xml, bodyParts };
}
// xmldom 0.9 supports string replacements here; its declaration omits that runtime branch.
// Only already-escaped text is returned, covered by exact XML round-trip tests.
const textSerializer = new XMLSerializer() as unknown as {
  serializeToString(
    document: Document,
    options: { nodeFilter(node: Node): Node | string },
  ): string;
};
export const serialize = (document: Document) =>
  strToU8(
    textSerializer.serializeToString(document, {
      nodeFilter(node) {
        // Literal CR characters would normalize to LF when the XML is reopened.
        // Preserve the parsed text value without changing the DOM or weakening comparison.
        if (node.nodeType === 3 && node.nodeValue?.includes("\r")) {
          const entities: Record<string, string> = {
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            "\r": "&#13;",
          };
          return node.nodeValue.replace(
            /[&<>\r]/g,
            (value) => entities[value]!,
          );
        }
        return node;
      },
    }),
  );
export async function digest(bytes: Uint8Array): Promise<string> {
  const hash = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new Uint8Array(bytes).buffer,
  );
  return (
    "sha256:" +
    Array.from(new Uint8Array(hash), (v) =>
      v.toString(16).padStart(2, "0"),
    ).join("")
  );
}
/** Only text belonging to this paragraph: nested tables and shape paragraphs never leak in. */
export function textNodes(paragraph: Element, ns: string): Element[] {
  return walk(paragraph).filter(
    (n) =>
      n.namespaceURI === ns &&
      n.localName === "t" &&
      parent(n, "p", ns) === paragraph,
  );
}
export function textOf(paragraph: Element, ns: string): string {
  const read = (node: Node, inText = false): string => {
    if (node.nodeType === 3) return inText ? (node.nodeValue ?? "") : "";
    if (node.nodeType === 1) {
      const n = node as Element;
      if (n !== paragraph && n.namespaceURI === ns && n.localName === "p")
        return "";
      if (n.namespaceURI === ns) {
        if (["br", "cr", "lineBreak"].includes(n.localName ?? "")) return "\n";
        if (n.localName === "tab") return "\t";
        if (n.localName === "t") inText = true;
      }
    }
    return Array.from(node.childNodes ?? [])
      .map((c) => read(c, inText))
      .join("");
  };
  return read(paragraph);
}
export function inlineTokens(
  paragraph: Element,
  ns: string,
): Array<{ node: Node; value: string; start: number; end: number }> {
  const tokens: Array<{
    node: Node;
    value: string;
    start: number;
    end: number;
  }> = [];
  let offset = 0;
  const add = (node: Node, value: string) => {
    tokens.push({ node, value, start: offset, end: offset + value.length });
    offset += value.length;
  };
  const visit = (node: Node, inText = false) => {
    if (node.nodeType === 3 || node.nodeType === 4) {
      if (inText) add(node, node.nodeValue ?? "");
      return;
    }
    if (node.nodeType === 1) {
      const n = node as Element;
      if (n !== paragraph && n.namespaceURI === ns && n.localName === "p")
        return;
      if (n.namespaceURI === ns) {
        if (["br", "cr", "lineBreak"].includes(n.localName ?? "")) {
          add(n, "\n");
          return;
        }
        if (n.localName === "tab") {
          add(n, "\t");
          return;
        }
        if (n.localName === "t") inText = true;
      }
    }
    for (const child of Array.from(node.childNodes ?? [])) visit(child, inText);
  };
  visit(paragraph);
  return tokens;
}
