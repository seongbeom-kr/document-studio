import {
  parseReportMarkdown,
  participantTable,
  organizationRows,
  type MarkdownBlock,
  type Participant,
  type OrganizationNode,
} from "./office-automation";
import { validateCommand, type PageSettings } from "./commands";
export interface DocumentTemplate {
  fileName: string;
  title?: string;
  blocks: readonly MarkdownBlock[];
  page?: PageSettings;
}
export function validateTemplate(template: DocumentTemplate): void {
  if (
    !template ||
    typeof template.fileName !== "string" ||
    !template.fileName.trim() ||
    template.fileName.length > 240 ||
    /[\x00-\x1f<>:"/\\|?*]/.test(template.fileName) ||
    !Array.isArray(template.blocks) ||
    template.blocks.length > 10000
  )
    throw new Error("문서 서식이 올바르지 않습니다.");
  if (template.page) validateCommand({ id: "pageSetup", value: template.page });
  if (
    template.title !== undefined &&
    (typeof template.title !== "string" || template.title.length > 2000)
  )
    throw new Error("문서 제목이 올바르지 않습니다.");
  let characters = template.title?.length ?? 0;
  for (const block of template.blocks) {
    if (
      !block ||
      !["heading", "paragraph", "bullet", "numbered", "table", "code"].includes(
        block.kind,
      )
    )
      throw new Error("문서 블록 종류가 올바르지 않습니다.");
    if (block.kind === "table") {
      if (!Array.isArray(block.rows))
        throw new Error("문서 표가 올바르지 않습니다.");
      const width = block.rows[0]?.length ?? 0;
      if (
        !block.rows.length ||
        block.rows.length > 100 ||
        !width ||
        width > 50 ||
        block.rows.length * width > 2000 ||
        block.rows.some(
          (row: string[]) =>
            !Array.isArray(row) ||
            row.length !== width ||
            row.some(
              (cell: string) => typeof cell !== "string" || cell.includes("\0"),
            ),
        )
      )
        throw new Error("표는 100행·50열 이하 직사각형이어야 합니다.");
      characters += block.rows.flat().join("").length;
    } else {
      if (
        typeof block.text !== "string" ||
        block.text.includes("\0") ||
        (block.kind === "heading" &&
          (!Number.isInteger(block.level) ||
            block.level < 1 ||
            block.level > 6))
      )
        throw new Error("문서 블록 내용이 올바르지 않습니다.");
      characters += block.text.length;
    }
  }
  if (characters > 1_000_000) throw new Error("문서 서식 내용이 너무 큽니다.");
}
export function markdownTemplate(
  markdown: string,
  fileName = "보고서.docx",
): DocumentTemplate {
  return { fileName, blocks: parseReportMarkdown(markdown) };
}
export function meetingTemplate(
  people: readonly Participant[],
  kind: "nameCards" | "nameTags" | "attendance",
  fileName: string,
): DocumentTemplate {
  const rows = participantTable(people, kind);
  return {
    fileName,
    title:
      kind === "attendance"
        ? "참석자 명단"
        : kind === "nameCards"
          ? "회의명패"
          : "명찰",
    blocks:
      kind === "attendance"
        ? [
            { kind: "heading", level: 1, text: "참석자 명단" },
            ...splitReportTable(rows),
          ]
        : rows.flatMap((row) => [
            {
              kind: "heading" as const,
              level: 1,
              text: kind === "nameCards" ? row[2]! : row[0]!,
            },
            {
              kind: "paragraph" as const,
              text:
                kind === "nameCards" ? row.slice(0, 2).join(" · ") : row[1]!,
            },
          ]),
  };
}
/** Repeat the header when large input exceeds a single editor table's bounded cell count. */
export function splitReportTable(
  rows: string[][],
): Extract<MarkdownBlock, { kind: "table" }>[] {
  const header = rows[0];
  if (
    !header?.length ||
    header.length > 50 ||
    rows.some((row) => row.length !== header.length)
  )
    throw new Error("표 열이 올바르지 않습니다.");
  const chunkSize = Math.min(99, Math.floor(2000 / header.length) - 1),
    tables: Extract<MarkdownBlock, { kind: "table" }>[] = [];
  for (let start = 1; start < rows.length; start += chunkSize)
    tables.push({
      kind: "table",
      rows: [
        [...header],
        ...rows.slice(start, start + chunkSize).map((row) => [...row]),
      ],
    });
  return tables.length ? tables : [{ kind: "table", rows: [[...header]] }];
}
export function organizationTemplate(
  nodes: readonly OrganizationNode[],
  fileName: string,
): DocumentTemplate {
  const paths = organizationRows(nodes),
    depth = Math.max(1, ...paths.map((path) => path.length));
  return {
    fileName,
    title: "조직도",
    blocks: [
      { kind: "heading", level: 1, text: "조직도" },
      ...splitReportTable([
        [...Array(depth)].map((_, i) => `${i + 1}단계`),
        ...paths.map((path) => [
          ...path,
          ...Array(depth - path.length).fill(""),
        ]),
      ]),
    ],
  };
}
export function buildReportPrompt(input: {
  title: string;
  purpose: string;
  facts: string;
  sections?: readonly string[];
}): string {
  if (
    !input.title.trim() ||
    !input.purpose.trim() ||
    input.facts.length > 100000
  )
    throw new Error("보고서 작성 입력이 올바르지 않습니다.");
  const sections = input.sections ?? [
    "목적",
    "현황",
    "추진 내용",
    "일정",
    "소요 예산",
    "검토 사항",
  ];
  return `다음 사실만 사용하여 한국어 보고서 초안을 마크다운으로 작성해 주세요.\n제목: ${input.title}\n작성 목적: ${input.purpose}\n구성: ${sections.join(", ")}\n\n제공된 사실:\n${input.facts}\n\n제공되지 않은 수치·근거·일정은 만들지 말고 [확인 필요]로 표시해 주세요. 개인정보를 추가하지 말고 제목·목록·표를 사용해 주세요.`;
}
