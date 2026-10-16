import {
  formatAccountingAmount,
  formatOfficeDate,
  ageOn,
  datePeriod,
  safeCalculate,
  parseDelimited,
  serializeDelimited,
  transformCells,
  percentageAnalysis,
  reverseTotals,
  consolidateRows,
  sortByOrganization,
  type CellTransform,
} from "./office-automation";
import {
  markdownTemplate,
  meetingTemplate,
  organizationTemplate,
  buildReportPrompt,
  validateTemplate,
  type DocumentTemplate,
} from "./templates";
import {
  buildChartSvg,
  buildOrganizationSvg,
  drawNames,
  assignTeams,
} from "./report-graphics";
import { OFFICE_AUTOMATION_FORMS, automationDefault } from "./automation-forms";

export const AUTOMATION_INPUT_LIMIT = 1_000_000;
const actions = [
  ["amount-korean", "금액 한글화"],
  ["date-format", "날짜 변환"],
  ["age", "만 나이"],
  ["date-period", "기간 계산"],
  ["calculate", "산출근거 계산"],
  ["table-clean", "표 데이터 정리"],
  ["percentages", "비율 분석"],
  ["reverse-totals", "역합계"],
  ["consolidate", "자료 취합"],
  ["organization-sort", "직제순 정렬"],
  ["markdown-report", "마크다운 보고서"],
  ["attendance", "참석자 명단"],
  ["name-cards", "회의명패"],
  ["name-tags", "명찰"],
  ["organization", "조직도"],
  ["report-prompt", "보고서 작성 프롬프트"],
  ["chart", "차트"],
  ["organization-image", "조직도 그림"],
  ["draw-names", "추첨"],
  ["assign-teams", "조 편성"],
] as const;
export type AutomationActionId = (typeof actions)[number][0];
export interface AutomationRequest {
  actionId: AutomationActionId;
  input: string;
  argument?: string;
  delimiter?: "auto" | "," | "\t";
  transform?: CellTransform;
}
export interface AutomationPreview {
  actionId: AutomationActionId;
  input: Required<AutomationRequest>;
  kind: "text" | "table" | "document" | "graphic";
  text: string;
  rows?: string[][];
  template?: DocumentTemplate;
  svg?: string;
  warnings: string[];
}
export const AUTOMATION_CELL_ARGUMENTS: Partial<
  Record<
    CellTransform,
    {
      label: string;
      defaultValue: string;
      type: "number" | "text";
    }
  >
> = {
  prefix: { label: "앞에 붙일 문구", defaultValue: "", type: "text" },
  suffix: { label: "뒤에 붙일 문구", defaultValue: "", type: "text" },
  multiply: { label: "곱할 수", defaultValue: "1", type: "number" },
  divide: { label: "나눌 수", defaultValue: "1", type: "number" },
  sequence: { label: "순번 시작 값", defaultValue: "1", type: "number" },
};
const transforms: readonly CellTransform[] = [
  "trim",
  "collapseSpaces",
  "commas",
  "koreanAmount",
  "dateOfficial",
  "dateIso",
  "prefix",
  "suffix",
  "multiply",
  "divide",
  "sequence",
];
export const AUTOMATION_ACTIONS = actions.map(([id, name]) => {
  const form = OFFICE_AUTOMATION_FORMS.find((entry) => entry.name === name)!;
  const createsDocument = [
    "markdown-report",
    "attendance",
    "name-cards",
    "name-tags",
    "organization",
  ].includes(id);
  return {
    ...form,
    id,
    createsDocument,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["actionId", "input"],
      properties: {
        actionId: { type: "string", const: id },
        input: {
          type: "string",
          minLength: 1,
          maxLength: AUTOMATION_INPUT_LIMIT,
          description: form.help,
        },
        argument: {
          type: "string",
          maxLength: AUTOMATION_INPUT_LIMIT,
          ...(form.argument?.options ? { enum: form.argument.options } : {}),
          description: form.argument?.label ?? "셀 변환에 필요한 추가 값",
        },
        delimiter: {
          type: "string",
          enum: ["auto", ",", "\t"],
          default: "auto",
        },
        transform: { type: "string", enum: transforms, default: "trim" },
      },
    },
  };
});

/** Shared by the UI and agent bridge. This function never changes a document or writes storage. */
export function previewAutomation(
  request: AutomationRequest,
): AutomationPreview {
  if (
    !request ||
    typeof request !== "object" ||
    Array.isArray(request) ||
    Object.keys(request).some(
      (key) =>
        !["actionId", "input", "argument", "delimiter", "transform"].includes(
          key,
        ),
    )
  )
    throw new TypeError("자동화 요청 형식이 올바르지 않습니다.");
  const form = AUTOMATION_ACTIONS.find(
    (entry) => entry.id === request.actionId,
  );
  if (!form) throw new TypeError("지원하지 않는 자동화 기능입니다.");
  const utility = form.name;
  const input = request.input;
  if (typeof input !== "string" || !input.trim())
    throw new TypeError(form.inputLabel + "을 입력하세요. " + form.help);
  const transform = request.transform ?? "trim";
  const delimiter = request.delimiter ?? "auto";
  if (
    !transforms.includes(transform) ||
    !["auto", ",", "\t"].includes(delimiter)
  )
    throw new TypeError("셀 변환 또는 열 구분자가 올바르지 않습니다.");
  const argumentField =
    utility === "표 데이터 정리"
      ? AUTOMATION_CELL_ARGUMENTS[transform]
      : form.argument;
  const argument =
    request.argument ?? automationDefault(argumentField?.defaultValue ?? "");
  if (typeof argument !== "string")
    throw new TypeError("추가 입력은 문자열이어야 합니다.");
  if (
    input.length > AUTOMATION_INPUT_LIMIT ||
    argument.length > AUTOMATION_INPUT_LIMIT
  )
    throw new RangeError("자동화 입력은 각각 1,000,000자 이하여야 합니다.");
  if (argumentField && argumentField.type !== "text" && !argument.trim())
    throw new TypeError(argumentField.label + "을 입력하세요. " + form.help);
  if (form.argument?.options && !form.argument.options.includes(argument))
    throw new TypeError("지원하지 않는 자동화 옵션입니다.");
  const parseRows = (text: string) =>
    parseDelimited(
      text,
      delimiter === "auto" ? (text.includes("\t") ? "\t" : ",") : delimiter,
    );
  let text = "",
    graphic = "",
    document: DocumentTemplate | null = null;
  switch (utility) {
    case "금액 한글화":
      text = input
        .split(/\r?\n/)
        .filter(Boolean)
        .map(formatAccountingAmount)
        .join("\n");
      break;
    case "날짜 변환":
      text = input
        .split(/\r?\n/)
        .filter(Boolean)
        .map((value) => formatOfficeDate(value))
        .join("\n");
      break;
    case "만 나이":
      text = String(ageOn(input.trim(), argument.trim()));
      break;
    case "기간 계산": {
      const period = datePeriod(
        input.trim(),
        argument.trim() === "다음달" ? "nextMonth" : "nextWeek",
      );
      text = `${formatOfficeDate(period.from)} ~ ${formatOfficeDate(period.to)}`;
      break;
    }
    case "산출근거 계산":
      text = input
        .split(/\r?\n/)
        .filter(Boolean)
        .map((value) => `${value}\t${safeCalculate(value)}`)
        .join("\n");
      break;
    case "표 데이터 정리":
      text = serializeDelimited(
        transformCells(parseRows(input), transform, argument),
      );
      break;
    case "비율 분석":
      text = percentageAnalysis(
        input
          .split(/[\s,\t]+/)
          .filter(Boolean)
          .map(Number),
      )
        .map((value) => `${value.value}\t${value.percentage}%`)
        .join("\n");
      break;
    case "역합계":
      text = reverseTotals(
        input
          .split(/\s+/)
          .filter(Boolean)
          .map((value) => Number(value.replaceAll(",", ""))),
      ).join("\n");
      break;
    case "자료 취합":
      text = serializeDelimited(
        consolidateRows(input.split(/\r?\n---\r?\n/).map(parseRows), {
          startRow: Number(argument),
        }),
      );
      break;
    case "직제순 정렬":
      text = serializeDelimited(
        sortByOrganization(
          parseRows(input),
          0,
          argument.split(/\r?\n/).filter(Boolean),
        ),
      );
      break;
    case "마크다운 보고서":
      document = markdownTemplate(input, "보고서.docx");
      text = document.blocks
        .map((block) =>
          block.kind === "table" ? serializeDelimited(block.rows) : block.text,
        )
        .join("\n");
      break;
    case "참석자 명단":
    case "회의명패":
    case "명찰": {
      const people = parseRows(input).map((row) => ({
        name: row[0] ?? "",
        organization: row[1],
        role: row[2],
      }));
      document = meetingTemplate(
        people,
        utility === "참석자 명단"
          ? "attendance"
          : utility === "회의명패"
            ? "nameCards"
            : "nameTags",
        `${utility}.docx`,
      );
      text = document.blocks
        .map((block) =>
          block.kind === "table" ? serializeDelimited(block.rows) : block.text,
        )
        .join("\n");
      break;
    }
    case "조직도":
      document = organizationTemplate(
        parseRows(input).map((row) => ({
          id: row[0] ?? "",
          parentId: row[1] || undefined,
          label: row[2] ?? row[0] ?? "",
        })),
        "조직도.docx",
      );
      text = document.blocks
        .map((block) =>
          block.kind === "table" ? serializeDelimited(block.rows) : block.text,
        )
        .join("\n");
      break;
    case "보고서 작성 프롬프트":
      text = buildReportPrompt({
        title: argument || "보고서",
        purpose: "제공된 사실을 보고서로 정리",
        facts: input,
      });
      break;
    case "차트": {
      const data = parseRows(input)
        .filter((row) => row.some(Boolean))
        .map((row) => ({
          label: row[0]!,
          value: Number(row[1]?.replaceAll(",", "")),
        }));
      const kind = argument === "line" || argument === "pie" ? argument : "bar";
      graphic = buildChartSvg(data, kind);
      text = serializeDelimited(
        data.map((item) => [item.label, String(item.value)]),
      );
      break;
    }
    case "조직도 그림": {
      const nodes = parseRows(input).map((row) => ({
        id: row[0]!,
        parentId: row[1] || undefined,
        label: row[2] || row[0]!,
      }));
      graphic = buildOrganizationSvg(nodes);
      text = serializeDelimited(
        nodes.map((n) => [n.id, n.parentId ?? "", n.label]),
      );
      break;
    }
    case "추첨":
      text = drawNames(
        input
          .split(/\r?\n/)
          .map((name) => name.trim())
          .filter(Boolean),
        Number(argument),
      ).join("\n");
      break;
    case "조 편성":
      text = assignTeams(
        input
          .split(/\r?\n/)
          .map((name) => name.trim())
          .filter(Boolean),
        Number(argument),
      )
        .map((names, index) => `${index + 1}조\t${names.join(" · ")}`)
        .join("\n");
      break;
  }

  if (document) validateTemplate(document);
  if (text.length > 8_000_000 || graphic.length > 8_000_000)
    throw new RangeError("자동화 결과가 지원 크기를 넘었습니다.");
  const tabular = [
    "calculate",
    "table-clean",
    "percentages",
    "consolidate",
    "organization-sort",
    "assign-teams",
  ].includes(request.actionId);
  return {
    actionId: request.actionId,
    input: {
      actionId: request.actionId,
      input,
      argument,
      transform,
      delimiter,
    },
    kind: document
      ? "document"
      : graphic
        ? "graphic"
        : tabular
          ? "table"
          : "text",
    text,
    ...(document ? { template: document } : {}),
    ...(graphic ? { svg: graphic } : {}),
    ...(tabular ? { rows: parseDelimited(text, "\t") } : {}),
    warnings:
      utility === "명찰" || utility === "회의명패"
        ? [
            "일반 문단의 내용 초안입니다. 인쇄용 크기·격자·재단선은 제공하지 않습니다.",
          ]
        : utility === "보고서 작성 프롬프트"
          ? ["요청 문장을 생성한 결과입니다. LLM을 실행한 결과가 아닙니다."]
          : [],
  };
}
