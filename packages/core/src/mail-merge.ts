import { unzipSync, zipSync, strFromU8, strToU8, type Zippable } from "fflate";
import { validateDocumentAsync } from "./validation";
import { parseDelimited } from "./office-automation";
import type { DocumentFormat, EditorDocument } from "./index";
import type { TableEditIdentity } from "./table-column";
import {
  GeneratedOutputLedger,
  GeneratedOutputPendingError,
  type GeneratedOutputPending,
  type GeneratedFileDelivery,
} from "./generated-output";

export const MAIL_MERGE_LIMITS = Object.freeze({
  templates: 2,
  records: 20,
  fields: 100,
  locations: 1000,
  inputCharacters: 100_000,
  valueCharacters: 2000,
  sourceBytes: 8 * 1024 * 1024,
  expandedBytes: 32 * 1024 * 1024,
  outputBytes: 64 * 1024 * 1024,
});
export const MAIL_MERGE_DRAFT_NAME = "서식 메일머지";
export interface MailMergeLocation {
  field: string;
  address: string;
  token: string;
}
export interface MailMergeTemplateInfo {
  templateId: string;
  fileName: string;
  format: DocumentFormat;
  digest: string;
  fields: readonly string[];
  locations: readonly MailMergeLocation[];
  issues: readonly string[];
}
export interface MailMergeRequest {
  templateId: string;
  data: string;
  delimiter: "auto" | "," | "\t";
  mapping: Readonly<Record<string, string>>;
  fileNamePattern: string;
  allowEmpty: boolean;
}
export interface MailMergePreview extends TableEditIdentity {
  previewId: string;
  template: MailMergeTemplateInfo;
  request: MailMergeRequest;
  files: readonly {
    row: number;
    fileName: string;
    values: Readonly<Record<string, string>>;
  }[];
  issues: readonly { row?: number; field?: string; message: string }[];
  emptyValues: readonly { row: number; field: string }[];
}
export interface MailMergeReceipt {
  documentId: string;
  sessionId: string;
  operationId: string;
  previewId: string;
  files: readonly {
    id: string;
    fileName: string;
    format: DocumentFormat;
    digest: string;
    byteLength: number;
  }[];
  committed: false;
}
export interface MailMergeStatus {
  phase: "idle" | "running" | "ready" | "failed" | "cancelled";
  completed: number;
  total: number;
  operationId?: string;
  error?: string;
  lastResult?: MailMergeReceipt;
  pendingOutput?: GeneratedOutputPending;
}
export class MailMergeError extends Error {
  readonly effect = "none";
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MailMergeError";
  }
}
export const MAIL_MERGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "templateId",
    "data",
    "delimiter",
    "mapping",
    "fileNamePattern",
    "allowEmpty",
  ],
  properties: {
    templateId: {
      type: "string",
      description:
        "listMailMergeTemplates 또는 registerCurrentMailMergeTemplate의 ID",
    },
    data: {
      type: "string",
      maxLength: MAIL_MERGE_LIMITS.inputCharacters,
      description:
        "첫 행은 고유한 열 이름. 뒤에 최대 20개 데이터 행. 모든 값은 문자열로 보존됩니다.",
    },
    delimiter: { enum: ["auto", ",", "\t"] },
    mapping: {
      type: "object",
      additionalProperties: { type: "string" },
      description: "서식 필드 이름 → 데이터 열 이름",
    },
    fileNamePattern: {
      type: "string",
      maxLength: 240,
      description:
        "예: 안내문-{{이름}}-{{#}}.docx. {{#}}는 데이터 순번이며 확장자는 서식 형식과 같아야 합니다.",
    },
    allowEmpty: {
      type: "boolean",
      description:
        "빈 값은 미리보기에 모두 표시합니다. 누락된 열은 이 옵션으로 허용되지 않습니다.",
    },
  },
} as const;
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const HP = "http://www.hancom.co.kr/hwpml/2011/paragraph";
const keyPattern = /^[\p{L}\p{N}_-]{1,64}$/u;
const tokenPattern = /\{\{\s*([\p{L}\p{N}_-]{1,64})\s*\}\}/gu;
const badText =
  /[\u0000-\u001f\u007f\ufffe\uffff]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;
const direct = (node: Element, ns: string, name: string) =>
  Array.from(node.children).filter(
    (n) => n.namespaceURI === ns && n.localName === name,
  );
const all = (node: Document | Element, ns: string, name: string) =>
  Array.from(node.getElementsByTagNameNS(ns, name));
const issue = (message: string) => new MailMergeError(message);
const identity = (state: TableEditIdentity): TableEditIdentity => ({
  documentId: state.documentId,
  sessionId: state.sessionId,
  revision: state.revision,
  selectionKey: state.selectionKey,
});
async function digest(bytes: Uint8Array) {
  const hash = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return (
    "sha256:" +
    Array.from(new Uint8Array(hash), (n) =>
      n.toString(16).padStart(2, "0"),
    ).join("")
  );
}
function xmlDocument(bytes: Uint8Array) {
  if (typeof DOMParser === "undefined")
    throw issue(
      "서식 분석은 DOMParser를 제공하는 브라우저 환경에서 실행해 주세요.",
    );
  if (bytes.length > 8 * 1024 * 1024)
    throw issue("서식 XML 크기 제한을 넘었습니다.");
  const source = strFromU8(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(source))
    throw issue("외부 XML 선언을 포함한 서식은 지원하지 않습니다.");
  const document = new DOMParser().parseFromString(source, "application/xml");
  if (document.getElementsByTagNameNS("*", "parsererror").length)
    throw issue("서식 XML을 읽지 못했습니다.");
  return document;
}
interface Span {
  field: string;
  token: string;
  start: number;
  end: number;
}
interface ParagraphPlan {
  part: string;
  ordinal: number;
  address: string;
  text: string;
  spans: Span[];
}
interface Registered {
  info: MailMergeTemplateInfo;
  parts: Record<string, Uint8Array>;
  paragraphs: ParagraphPlan[];
}
/** Never joins text across a field, shape, table or paragraph boundary. */
function paragraphText(p: Element, format: DocumentFormat) {
  const ns = format === "docx" ? W : HP,
    runName = format === "docx" ? "r" : "run";
  const runs = direct(p, ns, runName),
    texts = runs.flatMap((run) => direct(run, ns, "t"));
  const firstTextRun = runs.findIndex((run) => direct(run, ns, "t").length > 0);
  const ordinary =
    Array.from(p.children).every(
      (n) =>
        n.namespaceURI === ns &&
        (n.localName === runName ||
          (format === "docx"
            ? n.localName === "pPr"
            : n.localName === "linesegarray")),
    ) &&
    runs.every((run, index) =>
      Array.from(run.children).every(
        (n) =>
          n.namespaceURI === ns &&
          ((n.localName === "t" && !n.children.length) ||
            (format === "docx" && n.localName === "rPr") ||
            (format === "hwpx" &&
              index < firstTextRun &&
              (n.localName === "secPr" ||
                (n.localName === "ctrl" &&
                  Array.from(n.children).every(
                    (c) => c.namespaceURI === ns && c.localName === "colPr",
                  ))))),
      ),
    );
  const ownTexts = all(p, ns, "t").filter((t) => {
    let parent = t.parentElement;
    while (parent && parent !== p) {
      if (parent.namespaceURI === ns && parent.localName === "p") return false;
      parent = parent.parentElement;
    }
    return parent === p;
  });
  return {
    text: ownTexts.map((t) => t.textContent ?? "").join(""),
    texts,
    ordinary,
  };
}
function paragraphAddress(
  p: Element,
  part: string,
  ordinal: number,
  document: Document,
  format: DocumentFormat,
) {
  const ns = format === "docx" ? W : HP;
  let cell: Element | null = null,
    parent = p.parentElement;
  while (parent) {
    if (parent.namespaceURI === ns && parent.localName === "tc") {
      cell = parent;
      break;
    }
    parent = parent.parentElement;
  }
  const story = /header(\d+)\.xml$/.exec(part),
    footer = /footer(\d+)\.xml$/.exec(part),
    section = /section(\d+)\.xml$/.exec(part);
  const area = story
    ? `머리말 ${story[1]}`
    : footer
      ? `꼬리말 ${footer[1]}`
      : section
        ? `본문 ${Number(section[1]) + 1}구역`
        : "본문";
  if (cell) {
    let table = cell.parentElement;
    while (table && !(table.namespaceURI === ns && table.localName === "tbl"))
      table = table.parentElement;
    if (table) {
      const tableNumber = all(document, ns, "tbl").indexOf(table) + 1;
      if (format === "hwpx") {
        const addr = direct(cell, HP, "cellAddr")[0];
        if (addr)
          return `${area} ${tableNumber}번 표 ${Number(addr.getAttribute("rowAddr")) + 1}행 ${Number(addr.getAttribute("colAddr")) + 1}열`;
      } else {
        const row = cell.parentElement;
        if (row)
          return `${area} ${tableNumber}번 표 ${direct(table, W, "tr").indexOf(row) + 1}행 ${direct(row, W, "tc").indexOf(cell) + 1}번째 셀`;
      }
    }
  }
  return `${area} ${ordinal + 1}번 문단`;
}
function analyzeParts(
  parts: Record<string, Uint8Array>,
  format: DocumentFormat,
) {
  const locations: MailMergeLocation[] = [],
    paragraphs: ParagraphPlan[] = [],
    issues: string[] = [],
    fields = new Set<string>();
  const ns = format === "docx" ? W : HP;
  for (const [part, bytes] of Object.entries(parts)) {
    // Only document text stories. Package metadata and content relationships are never a template language.
    if (
      !(format === "docx"
        ? /^word\/(?:document|header\d+|footer\d+)\.xml$/.test(part)
        : /^Contents\/section\d+\.xml$/.test(part))
    ) {
      if (
        format === "docx" &&
        /^word\/(?:footnotes|endnotes|comments)\.xml$/.test(part) &&
        all(xmlDocument(bytes), W, "p").some((p) =>
          paragraphText(p, format).text.includes("{{"),
        )
      )
        issues.push(
          "각주·미주·메모의 필드는 지원하지 않습니다. 본문이나 표로 옮겨 주세요.",
        );
      continue;
    }
    const document = xmlDocument(bytes);
    all(document, ns, "p").forEach((p, ordinal) => {
      const { text, ordinary } = paragraphText(p, format);
      if (!text.includes("{{") && !text.includes("}}")) return;
      const address = paragraphAddress(p, part, ordinal, document, format);
      const spans = Array.from(text.matchAll(tokenPattern), (match) => ({
        field: match[1]!,
        token: match[0],
        start: match.index!,
        end: match.index! + match[0].length,
      }));
      if (
        text.replace(tokenPattern, "").includes("{{") ||
        text.replace(tokenPattern, "").includes("}}")
      )
        issues.push(`${address}: 필드 표기는 {{이름}} 형식이어야 합니다.`);
      if (!ordinary && spans.length)
        issues.push(
          `${address}: 필드·그림·특수 요소와 함께 있는 치환 표시는 지원하지 않습니다. 별도 일반 문단이나 셀로 옮겨 주세요.`,
        );
      for (const span of spans) {
        fields.add(span.field);
        locations.push({ field: span.field, address, token: span.token });
      }
      if (spans.length && ordinary)
        paragraphs.push({ part, ordinal, address, text, spans });
      if (
        fields.size > MAIL_MERGE_LIMITS.fields ||
        locations.length > MAIL_MERGE_LIMITS.locations ||
        issues.length > 100
      )
        throw issue("서식 필드 또는 오류 항목 제한을 넘었습니다.");
    });
  }
  if (!fields.size)
    issues.push("{{이름}}처럼 값을 채울 필드를 서식에 넣어 주세요.");
  return { fields: [...fields], locations, paragraphs, issues };
}
export function parseMailMergeData(
  data: string,
  delimiter: MailMergeRequest["delimiter"],
) {
  if (
    typeof data !== "string" ||
    data.length > MAIL_MERGE_LIMITS.inputCharacters ||
    !["auto", ",", "\t"].includes(delimiter)
  )
    throw issue("메일머지 데이터 크기 또는 구분자가 올바르지 않습니다.");
  const rows = parseDelimited(
    data,
    delimiter === "auto" ? (data.includes("\t") ? "\t" : ",") : delimiter,
  );
  const headers = rows[0]?.map((value) => value.trim()) ?? [];
  if (
    !headers.length ||
    headers.length > 100 ||
    headers.some((h) => !h || h.length > 100 || badText.test(h)) ||
    new Set(headers).size !== headers.length
  )
    throw issue(
      "첫 행에는 비어 있지 않고 중복되지 않는 데이터 열 이름이 필요합니다.",
    );
  const records = rows.slice(1);
  if (!records.length || records.length > MAIL_MERGE_LIMITS.records)
    throw issue("메일머지 데이터는 1~20행이어야 합니다.");
  if (records.some((row) => row.length !== headers.length))
    throw issue("데이터의 열 개수가 일치하지 않습니다.");
  return { headers, records };
}
function validateRequest(request: MailMergeRequest) {
  if (
    !request ||
    typeof request !== "object" ||
    Array.isArray(request) ||
    Object.keys(request).some(
      (k) =>
        ![
          "templateId",
          "data",
          "delimiter",
          "mapping",
          "fileNamePattern",
          "allowEmpty",
        ].includes(k),
    ) ||
    typeof request.templateId !== "string" ||
    typeof request.fileNamePattern !== "string" ||
    !request.fileNamePattern.trim() ||
    request.fileNamePattern.length > 240 ||
    typeof request.allowEmpty !== "boolean" ||
    !request.mapping ||
    typeof request.mapping !== "object" ||
    Array.isArray(request.mapping) ||
    Object.keys(request.mapping).length > MAIL_MERGE_LIMITS.fields ||
    Object.entries(request.mapping).some(
      ([field, column]) =>
        !keyPattern.test(field) ||
        typeof column !== "string" ||
        column.length > 100,
    )
  )
    throw issue("메일머지 요청 형식이 올바르지 않습니다.");
}
function fileName(
  pattern: string,
  values: Record<string, string>,
  row: number,
  format: DocumentFormat,
) {
  const name = pattern
    .replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, field: string) => {
      if (field === "#") return String(row).padStart(2, "0");
      if (!Object.hasOwn(values, field))
        throw issue(`파일 이름의 필드 ${field}가 없습니다.`);
      return values[field]!;
    })
    .normalize("NFC");
  if (
    !name ||
    name.length > 240 ||
    /[\x00-\x1f\x7f<>:"/\\|?*]/.test(name) ||
    name.startsWith(".") ||
    /[ .]$/.test(name) ||
    name.includes("{{") ||
    name.includes("}}") ||
    /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name) ||
    !name.toLowerCase().endsWith(`.${format}`)
  )
    throw issue(
      "출력 파일 이름이 올바르지 않습니다. 경로·예약 이름 없이 서식과 같은 확장자를 사용하세요.",
    );
  return name;
}
/** String-only field mapping. Leading zeros and date/identifier values are never converted. */
export function planMailMerge(
  info: MailMergeTemplateInfo,
  request: MailMergeRequest,
) {
  validateRequest(request);
  if (request.templateId !== info.templateId)
    throw issue("서식 ID가 일치하지 않습니다.");
  const { headers, records } = parseMailMergeData(
    request.data,
    request.delimiter,
  );
  const issues: MailMergePreview["issues"][number][] = info.issues.map(
    (message) => ({ message }),
  );
  const emptyValues: MailMergePreview["emptyValues"][number][] = [],
    names = new Set<string>();
  for (const field of Object.keys(request.mapping))
    if (!info.fields.includes(field))
      issues.push({ field, message: "서식에 없는 필드 매핑입니다." });
  for (const field of info.fields)
    if (
      !Object.hasOwn(request.mapping, field) ||
      !headers.includes(request.mapping[field]!)
    )
      issues.push({ field, message: "연결할 데이터 열이 없습니다." });
  const files = records.map((record, index) => {
    const row = index + 2,
      values: Record<string, string> = Object.create(null);
    if (record.every((value) => !value.trim()))
      issues.push({ row, message: "빈 데이터 행입니다." });
    for (const field of info.fields) {
      const column = Object.hasOwn(request.mapping, field)
        ? headers.indexOf(request.mapping[field]!)
        : -1;
      const value = column < 0 ? "" : record[column]!;
      values[field] = value;
      if (!value.length) {
        emptyValues.push({ row, field });
        if (!request.allowEmpty)
          issues.push({
            row,
            field,
            message: "빈 값입니다. 데이터를 채우거나 빈 값 허용을 선택하세요.",
          });
      }
      if (
        value.length > MAIL_MERGE_LIMITS.valueCharacters ||
        badText.test(value)
      )
        issues.push({
          row,
          field,
          message: "필드 값은 줄바꿈·제어 문자가 없는 2,000자 이하여야 합니다.",
        });
    }
    let name = "";
    try {
      name = fileName(request.fileNamePattern, values, index + 1, info.format);
      const key = name.toLowerCase();
      if (names.has(key))
        issues.push({
          row,
          message: "출력 파일 이름이 중복됩니다. {{#}} 순번 등을 추가하세요.",
        });
      names.add(key);
    } catch (error) {
      issues.push({
        row,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return { row, fileName: name, values };
  });
  return { files, issues, emptyValues };
}
function fillParts(
  source: Registered,
  values: Readonly<Record<string, string>>,
) {
  const parts = { ...source.parts },
    ns = source.info.format === "docx" ? W : HP;
  for (const part of new Set(source.paragraphs.map((p) => p.part))) {
    const document = xmlDocument(parts[part]!),
      paragraphs = all(document, ns, "p");
    for (const plan of source.paragraphs.filter((p) => p.part === part)) {
      const p = paragraphs[plan.ordinal]!;
      const { text, texts, ordinary } = paragraphText(p, source.info.format);
      if (!ordinary || text !== plan.text)
        throw issue("서식 위치가 분석 결과와 다릅니다.");
      const offsets: number[] = [];
      let total = 0;
      for (const t of texts) {
        offsets.push(total);
        total += (t.textContent ?? "").length;
      }
      for (const span of [...plan.spans].reverse()) {
        const first = texts.findIndex(
          (t, i) =>
            offsets[i]! <= span.start &&
            offsets[i]! + (t.textContent ?? "").length > span.start,
        );
        const last = texts.findIndex(
          (t, i) =>
            offsets[i]! < span.end &&
            offsets[i]! + (t.textContent ?? "").length >= span.end,
        );
        if (first < 0 || last < first || !Object.hasOwn(values, span.field))
          throw issue("서식 필드 경계가 올바르지 않습니다.");
        const left = (texts[first]!.textContent ?? "").slice(
          0,
          span.start - offsets[first]!,
        );
        const right = (texts[last]!.textContent ?? "").slice(
          span.end - offsets[last]!,
        );
        texts[first]!.textContent =
          left + values[span.field]! + (first === last ? right : "");
        for (let index = first + 1; index < last; index++)
          texts[index]!.textContent = "";
        if (last !== first) texts[last]!.textContent = right;
        if (source.info.format === "docx")
          for (let i = first; i <= last; i++)
            texts[i]!.setAttributeNS(
              "http://www.w3.org/XML/1998/namespace",
              "xml:space",
              "preserve",
            );
      }
      // Hancom documents this cache as optional and stale after editing paragraph text.
      if (source.info.format === "hwpx")
        for (const cache of direct(p, HP, "linesegarray")) cache.remove();
    }
    parts[part] = strToU8(new XMLSerializer().serializeToString(document));
  }
  if (source.info.format === "hwpx") {
    if (parts["Preview/PrvText.txt"])
      parts["Preview/PrvText.txt"] = strToU8(
        Object.entries(parts)
          .filter(([part]) => /^Contents\/section\d+\.xml$/.test(part))
          .flatMap(([, bytes]) =>
            all(xmlDocument(bytes), HP, "p").map(
              (p) => paragraphText(p, "hwpx").text,
            ),
          )
          .join("\n")
          .slice(0, 32000),
      );
  }
  // Keep package relationships intact without carrying the template's old page thumbnail.
  for (const name of Object.keys(parts))
    if (
      /^(?:Preview\/PrvImage|docProps\/thumbnail)\.(?:png|jpe?g)$/i.test(name)
    ) {
      const canvas = globalThis.document.createElement("canvas");
      canvas.width = 160;
      canvas.height = 200;
      const context = canvas.getContext("2d");
      if (!context)
        throw issue("출력 파일의 미리보기 이미지를 갱신할 수 없습니다.");
      context.fillStyle = "#fff";
      context.fillRect(0, 0, 160, 200);
      context.fillStyle = "#333";
      context.font = "14px sans-serif";
      context.fillText("Generated document", 10, 100);
      const encoded = canvas
        .toDataURL(/\.png$/i.test(name) ? "image/png" : "image/jpeg")
        .split(",")[1]!;
      parts[name] = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
    }
  const zipped: Zippable = {};
  if (parts.mimetype) zipped.mimetype = [parts.mimetype, { level: 0 }];
  for (const [name, bytes] of Object.entries(parts))
    if (name !== "mimetype") zipped[name] = bytes;
  return zipSync(zipped, { level: 6 });
}
/** Session-local templates and outputs. The host owns persistence and all external delivery. */
export function createMailMergeSession(port: {
  state(): TableEditIdentity;
  assertWritable(): void;
  onPreview?(request: MailMergeRequest, template: MailMergeTemplateInfo): void;
}) {
  const templates = new Map<string, Registered>(),
    previews = new Map<string, MailMergePreview>();
  const deliveries = new GeneratedOutputLedger();
  const operations = new Map<
    string,
    {
      previewId: string;
      task: Promise<MailMergeReceipt>;
      abort: AbortController;
    }
  >();
  const outputs = new Map<
    string,
    { receipt: MailMergeReceipt; documents: EditorDocument[] }
  >();
  let scope = "",
    status: MailMergeStatus = Object.freeze({
      phase: "idle",
      completed: 0,
      total: 0,
    });
  const listeners = new Set<() => void>();
  const publish = (value: MailMergeStatus) => {
    const result = outputs.values().next().value?.receipt;
    const lastResult = result ? structuredClone(result) : undefined;
    if (lastResult) {
      lastResult.files.forEach(Object.freeze);
      Object.freeze(lastResult.files);
      Object.freeze(lastResult);
    }
    const pendingOutput = deliveries.pending();
    if (pendingOutput) {
      pendingOutput.receipt.files.forEach(Object.freeze);
      Object.freeze(pendingOutput.receipt.files);
      Object.freeze(pendingOutput.receipt);
      Object.freeze(pendingOutput);
    }
    status = Object.freeze({ ...value, lastResult, pendingOutput });
    for (const listener of listeners) {
      try {
        listener();
      } catch (error) {
        // Notifications cannot turn a completed batch into an apparent failed write.
        console.error(
          "Document Studio mail-merge status listener failed",
          error,
        );
      }
    }
  };
  const state = () => {
    const value = identity(port.state()),
      key = JSON.stringify([value.documentId, value.sessionId]);
    if (scope !== key) {
      if (scope) deliveries.assertSettled();
      deliveries.reset();
      for (const op of operations.values()) op.abort.abort();
      templates.clear();
      previews.clear();
      operations.clear();
      outputs.clear();
      scope = key;
      status = Object.freeze({ phase: "idle", completed: 0, total: 0 });
    }
    return value;
  };
  const check = (expected: TableEditIdentity) => {
    const current = state();
    if (
      current.documentId !== expected.documentId ||
      current.sessionId !== expected.sessionId ||
      current.revision !== expected.revision
    )
      throw issue("미리보기 이후 문서가 변경됐습니다. 다시 확인해 주세요.");
    return current;
  };
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => status,
    assertCanLeave() {
      if (status.phase === "running")
        throw new GeneratedOutputPendingError(deliveries.pending(), true);
      deliveries.assertSettled();
    },
    noteDownload(operationId: string) {
      state();
      deliveries.noteDownload(operationId);
      publish({ ...status });
    },
    acknowledgeDelivery(input: {
      operationId: string;
      files: readonly GeneratedFileDelivery[];
    }) {
      state();
      deliveries.acknowledge(input.operationId, input.files);
      publish({ ...status });
    },
    discardResults(operationId: string) {
      state();
      if (status.phase === "running")
        throw issue("생성 작업을 먼저 취소해 주세요.");
      deliveries.discard(operationId);
      outputs.delete(operationId);
      publish({ phase: "idle", completed: 0, total: 0 });
    },
    list() {
      state();
      return [...templates.values()].map((t) => structuredClone(t.info));
    },
    async register(input: EditorDocument) {
      const started = state();
      if (
        !input ||
        !(input.bytes instanceof Uint8Array) ||
        input.bytes.length > MAIL_MERGE_LIMITS.sourceBytes ||
        !["docx", "hwpx"].includes(input.format) ||
        typeof input.fileName !== "string" ||
        input.fileName.length > 240
      )
        throw issue("8 MiB 이하의 DOCX 또는 HWPX 서식을 선택해 주세요.");
      if (templates.size >= MAIL_MERGE_LIMITS.templates)
        throw issue(
          "등록한 서식을 삭제한 뒤 새 서식을 추가해 주세요. 최대 2개입니다.",
        );
      const document = { ...input, bytes: new Uint8Array(input.bytes) };
      await validateDocumentAsync(document);
      check(started);
      let expanded = 0;
      const parts = unzipSync(document.bytes, {
        filter: (entry) => {
          expanded += entry.originalSize;
          if (
            expanded > MAIL_MERGE_LIMITS.expandedBytes ||
            entry.originalSize > 8 * 1024 * 1024
          )
            throw issue("서식의 실제 내용 크기 제한을 넘었습니다.");
          if (
            /^_xmlsignatures\//i.test(entry.name) ||
            /^META-INF\/(?:documentsignatures|signatures)\.xml$/i.test(
              entry.name,
            )
          )
            throw issue("전자서명된 서식은 지원하지 않습니다.");
          if (
            entry.name
              .split("/")
              .some((part) =>
                ["__proto__", "constructor", "prototype"].includes(part),
              )
          )
            throw issue("서식의 ZIP 항목 이름이 올바르지 않습니다.");
          return true;
        },
      });
      const analyzed = analyzeParts(parts, document.format),
        hash = await digest(document.bytes);
      check(started);
      if (templates.size >= MAIL_MERGE_LIMITS.templates)
        throw issue("서식 등록 한도에 도달했습니다.");
      const info: MailMergeTemplateInfo = {
        templateId: crypto.randomUUID(),
        fileName: document.fileName,
        format: document.format,
        digest: hash,
        fields: analyzed.fields,
        locations: analyzed.locations,
        issues: analyzed.issues,
      };
      templates.set(info.templateId, {
        info,
        parts,
        paragraphs: analyzed.paragraphs,
      });
      publish({ ...status });
      return structuredClone(info);
    },
    remove(templateId: string) {
      state();
      if (
        typeof templateId !== "string" ||
        !templateId ||
        templateId.length > 128
      )
        throw issue("서식 ID가 올바르지 않습니다.");
      if (status.phase === "running")
        throw issue("생성 작업을 먼저 취소해 주세요.");
      const removed = templates.delete(templateId);
      for (const [id, p] of previews)
        if (p.template.templateId === templateId) previews.delete(id);
      publish({ ...status });
      return { removed };
    },
    preview(request: MailMergeRequest): MailMergePreview {
      const started = state();
      validateRequest(request);
      const source = templates.get(request.templateId);
      if (!source) throw issue("등록한 서식을 선택해 주세요.");
      const input = structuredClone(request),
        plan = planMailMerge(source.info, input);
      const preview: MailMergePreview = {
        ...started,
        ...plan,
        previewId: crypto.randomUUID(),
        template: structuredClone(source.info),
        request: input,
      };
      if (new TextEncoder().encode(JSON.stringify(preview)).length > 800_000)
        throw issue("미리보기 결과 크기 제한을 넘었습니다.");
      port.onPreview?.(structuredClone(input), structuredClone(source.info));
      check(started);
      if (previews.size >= 4) previews.delete(previews.keys().next().value!);
      previews.set(preview.previewId, structuredClone(preview));
      return preview;
    },
    async generate(input: {
      previewId: string;
      operationId: string;
    }): Promise<MailMergeReceipt> {
      state();
      if (
        !input ||
        Object.keys(input).some(
          (k) => !["previewId", "operationId"].includes(k),
        ) ||
        typeof input.previewId !== "string" ||
        typeof input.operationId !== "string" ||
        !/^[a-zA-Z0-9._:-]{1,128}$/.test(input.operationId)
      )
        throw issue("생성 요청이 올바르지 않습니다.");
      const { previewId, operationId } = input,
        previous = operations.get(operationId);
      if (previous) {
        if (previous.previewId !== previewId)
          throw issue("다른 생성 요청에 사용한 작업 ID입니다.");
        return structuredClone(await previous.task);
      }
      if (operations.size >= 64)
        throw issue("생성 작업 기록 한도에 도달했습니다.");
      if (status.phase === "running")
        throw issue("현재 생성 작업을 마치거나 취소해 주세요.");
      deliveries.assertSettled();
      const preview = previews.get(previewId);
      if (!preview) throw issue("미리보기가 만료됐습니다.");
      check(preview);
      port.assertWritable();
      if (preview.issues.length)
        throw issue("미리보기의 오류를 먼저 해결해 주세요.");
      const source = templates.get(preview.template.templateId);
      if (!source || source.info.digest !== preview.template.digest)
        throw issue("등록한 서식이 변경됐습니다.");
      previews.delete(previewId);
      const abort = new AbortController(),
        generationScope = scope;
      const update = (value: MailMergeStatus) => {
        if (scope === generationScope) publish(value);
      };
      const task = (async () => {
        const documents: EditorDocument[] = [],
          files: MailMergeReceipt["files"][number][] = [];
        let size = 0;
        update({
          phase: "running",
          completed: 0,
          total: preview.files.length,
          operationId,
        });
        try {
          for (const [index, file] of preview.files.entries()) {
            await new Promise((resolve) => setTimeout(resolve, 0));
            if (abort.signal.aborted)
              throw new DOMException("문서 생성을 취소했습니다.", "AbortError");
            check(preview);
            port.assertWritable();
            const bytes = fillParts(source, file.values);
            size += bytes.length;
            if (size > MAIL_MERGE_LIMITS.outputBytes)
              throw issue("전체 출력 크기 제한을 넘었습니다.");
            const document: EditorDocument = {
              id: crypto.randomUUID(),
              format: source.info.format,
              fileName: file.fileName,
              bytes,
            };
            await validateDocumentAsync(document, abort.signal);
            check(preview);
            port.assertWritable();
            const hash = await digest(bytes);
            check(preview);
            documents.push(document);
            files.push({
              id: document.id,
              fileName: document.fileName,
              format: document.format,
              digest: hash,
              byteLength: bytes.length,
            });
            update({
              phase: "running",
              completed: index + 1,
              total: preview.files.length,
              operationId,
            });
          }
          if (abort.signal.aborted)
            throw new DOMException("문서 생성을 취소했습니다.", "AbortError");
          check(preview);
          port.assertWritable();
          const receipt: MailMergeReceipt = {
            documentId: preview.documentId,
            sessionId: preview.sessionId,
            operationId,
            previewId,
            files,
            committed: false,
          };
          // Publish only the whole successful batch. Older bytes are replaced, never silently reused.
          deliveries.retain(receipt);
          outputs.clear();
          outputs.set(operationId, { receipt, documents });
          update({
            phase: "ready",
            completed: documents.length,
            total: documents.length,
            operationId,
          });
          return receipt;
        } catch (cause) {
          update({
            phase: abort.signal.aborted ? "cancelled" : "failed",
            completed: 0,
            total: preview.files.length,
            operationId,
            error: cause instanceof Error ? cause.message : String(cause),
          });
          throw new MailMergeError(
            "문서 생성이 완료되지 않아 이번 출력은 모두 폐기했습니다. " +
              (cause instanceof Error ? cause.message : String(cause)),
            { cause },
          );
        }
      })();
      operations.set(operationId, { previewId, task, abort });
      return structuredClone(await task);
    },
    cancel(operationId: string) {
      state();
      operations.get(operationId)?.abort.abort();
    },
    results(operationId: string) {
      const current = state(),
        result = outputs.get(operationId);
      if (
        !result ||
        result.receipt.documentId !== current.documentId ||
        result.receipt.sessionId !== current.sessionId
      )
        throw issue("해당 출력은 현재 세션에 보관되어 있지 않습니다.");
      return structuredClone(result.documents);
    },
    archive(operationId: string) {
      const current = state(),
        result = outputs.get(operationId);
      if (
        !result ||
        result.receipt.documentId !== current.documentId ||
        result.receipt.sessionId !== current.sessionId
      )
        throw issue("내려받을 생성 결과가 없습니다.");
      const files: Zippable = {};
      for (const file of result.documents)
        files[file.fileName] = [file.bytes, { level: 0 }];
      return zipSync(files, { level: 0 });
    },
  };
}
