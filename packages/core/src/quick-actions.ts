import { parseCalendarDate, formatOfficeDate } from "./office-automation";
import {
  COMMAND_LABELS,
  validateCommand,
  type EditorCommand,
} from "./commands";
import { REPORT_PRESETS, type DocumentPreset } from "./presets";
import { SaveConflictError } from "./index";
import { SelectionConflictError } from "./selection-conflict";
import type { TableEditIdentity } from "./table-column";

export const OFFICE_DATE_ACTIONS = [
  { id: "today", label: "오늘" },
  { id: "yesterday", label: "어제" },
  { id: "tomorrow", label: "내일" },
  { id: "thisWeek", label: "이번 주" },
  { id: "nextWeek", label: "다음 주" },
  { id: "thisMonth", label: "이번 달" },
  { id: "nextMonth", label: "다음 달" },
  { id: "thisYear", label: "올해" },
  { id: "nextYear", label: "내년" },
] as const;
export interface OfficeDateRequest {
  kind: "date";
  baseDate: string;
  period: (typeof OFFICE_DATE_ACTIONS)[number]["id"];
  week: "workweek" | "calendar";
  format: "official" | "iso" | "compact";
}
export type QuickActionRequest =
  | OfficeDateRequest
  | { kind: "preset"; presetId: string };
export interface QuickActionPreview extends TableEditIdentity {
  previewId: string;
  request: QuickActionRequest;
  label: string;
  description: string;
  target: string;
  selection?: { mode: "insert" | "replace"; excerpt?: string; length?: number };
  text?: string;
  commands: readonly EditorCommand[];
}
export interface QuickActionReceipt extends TableEditIdentity {
  operationId: string;
  previewId: string;
  committed: false;
  undoSteps: 0 | 1;
}
export class QuickActionError extends Error {
  constructor(
    message: string,
    readonly effect: "none" | "unknown",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "QuickActionError";
  }
}
export const QUICK_ACTION_SCHEMA = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "baseDate", "period", "week", "format"],
      properties: {
        kind: { const: "date" },
        baseDate: {
          type: "string",
          pattern: "^\\d{4}-\\d{2}-\\d{2}$",
          description:
            "확인한 기준일. listQuickActions의 clock을 참고하고 미리보기에서 확정합니다.",
        },
        period: { enum: OFFICE_DATE_ACTIONS.map((x) => x.id) },
        week: {
          enum: ["workweek", "calendar"],
          description: "월~금 또는 월~일. 공휴일 제외 계산은 아닙니다.",
        },
        format: { enum: ["official", "iso", "compact"] },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "presetId"],
      properties: {
        kind: { const: "preset" },
        presetId: { type: "string", minLength: 1, maxLength: 128 },
      },
    },
  ],
} as const;
/** Returns an explicit calendar context; previews never silently recalculate today's date. */
export function officeClock(
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  now = new Date(),
) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime()))
    throw new TypeError("기준 시간이 올바르지 않습니다.");
  const values = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => values.find((p) => p.type === type)!.value;
  return {
    instant: now.toISOString(),
    timeZone,
    baseDate: `${get("year")}-${get("month")}-${get("day")}`,
  };
}
const own = (value: object, keys: readonly string[]) =>
  Object.keys(value).every((key) => keys.includes(key));
const formatOnly = new Set([
  "fontFamily",
  "fontSize",
  "lineSpacing",
  "textColor",
  "highlightColor",
  "characterSpacing",
  "characterScale",
  "paragraphFormat",
  "bold",
  "italic",
  "underline",
  "strike",
  "superscript",
  "subscript",
  "clearFormatting",
  "alignLeft",
  "alignCenter",
  "alignRight",
  "alignJustify",
  "bulletList",
  "numberedList",
  "increaseIndent",
  "decreaseIndent",
]);
export function officeDateText(request: OfficeDateRequest) {
  if (
    !request ||
    request.kind !== "date" ||
    !own(request, ["kind", "baseDate", "period", "week", "format"]) ||
    typeof request.baseDate !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(request.baseDate) ||
    !OFFICE_DATE_ACTIONS.some((x) => x.id === request.period) ||
    !["workweek", "calendar"].includes(request.week) ||
    !["official", "iso", "compact"].includes(request.format)
  )
    throw new TypeError("날짜 작업 입력이 올바르지 않습니다.");
  const { year, month, day } = parseCalendarDate(request.baseDate);
  const base = Date.UTC(year, month - 1, day),
    oneDay = 86400000;
  let from = base,
    to = base;
  switch (request.period) {
    case "yesterday":
      from = to = base - oneDay;
      break;
    case "tomorrow":
      from = to = base + oneDay;
      break;
    case "thisWeek":
    case "nextWeek": {
      const monday = base - ((new Date(base).getUTCDay() + 6) % 7) * oneDay;
      from = monday + (request.period === "nextWeek" ? 7 * oneDay : 0);
      to = from + (request.week === "workweek" ? 4 : 6) * oneDay;
      break;
    }
    case "thisMonth":
    case "nextMonth": {
      const m = month - 1 + (request.period === "nextMonth" ? 1 : 0);
      from = Date.UTC(year, m, 1);
      to = Date.UTC(year, m + 1, 0);
      break;
    }
    case "thisYear":
    case "nextYear": {
      const y = year + (request.period === "nextYear" ? 1 : 0);
      from = Date.UTC(y, 0, 1);
      to = Date.UTC(y, 11, 31);
      break;
    }
  }
  const format = (value: number) =>
    formatOfficeDate(
      new Date(value).toISOString().slice(0, 10),
      request.format,
    );
  return from === to ? format(from) : `${format(from)} ~ ${format(to)}`;
}
export function quickActionPlan(
  request: QuickActionRequest,
  presets: readonly DocumentPreset[] = REPORT_PRESETS,
) {
  if (!request || typeof request !== "object" || Array.isArray(request))
    throw new TypeError("빠른 작업 입력이 올바르지 않습니다.");
  if (request.kind === "date")
    return {
      label:
        OFFICE_DATE_ACTIONS.find((x) => x.id === request.period)?.label ??
        "날짜",
      description: `기준일 ${request.baseDate} · ${request.week === "workweek" ? "월~금" : "월~일"}`,
      text: officeDateText(request),
      commands: [{ id: "insertText" as const, value: officeDateText(request) }],
    };
  if (
    request.kind !== "preset" ||
    !own(request, ["kind", "presetId"]) ||
    typeof request.presetId !== "string"
  )
    throw new TypeError("빠른 서식 입력이 올바르지 않습니다.");
  const preset = presets.find((x) => x.id === request.presetId);
  if (!preset || !preset.commands.length || preset.commands.length > 64)
    throw new TypeError("등록된 서식을 선택해 주세요.");
  preset.commands.forEach(validateCommand);
  if (preset.commands.some((command) => !formatOnly.has(command.id)))
    throw new TypeError(
      "빠른 서식에는 글자·문단 서식 명령만 사용할 수 있습니다.",
    );
  return {
    label: preset.name,
    description: preset.description,
    commands: structuredClone(preset.commands),
  };
}
export function createQuickActionEditor(port: {
  state(): TableEditIdentity & {
    selectionDescription?: string;
    selectionText?: string;
    selectionTextLength?: number;
    selectionCollapsed?: boolean;
    atomicPresets?: boolean;
    atomicTextInsertion?: boolean;
  };
  presets(): readonly DocumentPreset[];
  apply(
    commands: readonly EditorCommand[],
    identity: TableEditIdentity,
  ): Promise<void>;
}) {
  const previews = new Map<string, QuickActionPreview>();
  const identity = (value: TableEditIdentity): TableEditIdentity => ({
    documentId: value.documentId,
    sessionId: value.sessionId,
    revision: value.revision,
    selectionKey: value.selectionKey,
  });
  const operations = new Map<
    string,
    { previewId: string; task: Promise<QuickActionReceipt> }
  >();
  const check = (identity: TableEditIdentity) => {
    const state = port.state();
    if (
      state.documentId !== identity.documentId ||
      state.sessionId !== identity.sessionId ||
      state.revision !== identity.revision
    )
      throw new SaveConflictError("미리보기 이후 문서가 변경됐습니다.");
    if (!identity.selectionKey || state.selectionKey !== identity.selectionKey)
      throw new SelectionConflictError();
    return state;
  };
  return {
    list() {
      return {
        clock: officeClock(),
        dates: structuredClone(OFFICE_DATE_ACTIONS),
        presets: structuredClone(port.presets()),
        inputSchema: structuredClone(QUICK_ACTION_SCHEMA),
        workflow:
          "previewQuickAction → confirm target/result → applyQuickAction. Save separately.",
      };
    },
    preview(request: QuickActionRequest): QuickActionPreview {
      const state = port.state(),
        plan = quickActionPlan(request, port.presets());
      if (!state.selectionKey) throw new SelectionConflictError();
      if (request.kind === "date" && !state.atomicTextInsertion)
        throw new QuickActionError(
          "이 엔진은 날짜 입력을 한 번에 되돌리는 기능을 지원하지 않습니다. 런타임 자산을 확인해 주세요.",
          "none",
        );
      if (plan.commands.length > 1 && !state.atomicPresets)
        throw new QuickActionError(
          "이 엔진은 한 번에 되돌리는 서식 적용을 지원하지 않습니다.",
          "none",
        );
      const preview: QuickActionPreview = {
        ...identity(state),
        ...plan,
        request: structuredClone(request),
        previewId: crypto.randomUUID(),
        selection: {
          mode: state.selectionCollapsed ? "insert" : "replace",
          excerpt: state.selectionText?.slice(0, 160),
          length: state.selectionTextLength,
        },
        target:
          state.selectionDescription ??
          (state.selectionCollapsed
            ? "현재 커서 위치"
            : state.selectionText
              ? `선택한 내용: ${state.selectionText}`
              : "현재 선택 범위"),
      };
      if (previews.size >= 8) previews.delete(previews.keys().next().value!);
      previews.set(preview.previewId, structuredClone(preview));
      return preview;
    },
    async apply(input: {
      previewId: string;
      operationId: string;
    }): Promise<QuickActionReceipt> {
      if (
        !input ||
        !own(input, ["previewId", "operationId"]) ||
        typeof input.previewId !== "string" ||
        typeof input.operationId !== "string" ||
        !/^[a-zA-Z0-9._:-]{1,128}$/.test(input.operationId)
      )
        throw new QuickActionError(
          "빠른 작업 요청이 올바르지 않습니다.",
          "none",
        );
      const { previewId, operationId } = input,
        previous = operations.get(operationId);
      if (previous) {
        if (previous.previewId !== previewId)
          throw new QuickActionError(
            "다른 요청에 사용한 작업 ID입니다.",
            "none",
          );
        const result = await previous.task,
          state = port.state();
        if (
          result.documentId !== state.documentId ||
          result.sessionId !== state.sessionId
        )
          throw new SaveConflictError("편집 세션이 변경됐습니다.");
        return structuredClone(result);
      }
      if (operations.size >= 128)
        throw new QuickActionError(
          "빠른 작업 기록 한도에 도달했습니다.",
          "none",
        );
      const preview = previews.get(previewId);
      if (!preview)
        throw new QuickActionError(
          "미리보기가 만료됐습니다. 다시 확인해 주세요.",
          "none",
        );
      check(preview);
      previews.delete(previewId);
      const task = (async () => {
        let applied = false;
        try {
          await port.apply(structuredClone(preview.commands), preview);
          applied = true;
          const state = port.state();
          if (
            state.documentId !== preview.documentId ||
            state.sessionId !== preview.sessionId
          )
            throw new Error("편집 세션 변경");
          return {
            ...identity(state),
            previewId,
            operationId,
            undoSteps:
              state.revision === preview.revision ? (0 as const) : (1 as const),
            committed: false as const,
          };
        } catch (cause) {
          if (
            cause instanceof QuickActionError ||
            (!applied &&
              (cause instanceof SaveConflictError ||
                cause instanceof SelectionConflictError))
          )
            throw cause;
          throw new QuickActionError(
            "빠른 작업 결과를 확인하지 못했습니다. 문서 상태를 확인하고 중복 실행하지 마세요.",
            "unknown",
            { cause },
          );
        }
      })();
      operations.set(operationId, { previewId, task });
      return structuredClone(await task);
    },
  };
}
export function describeQuickCommands(commands: readonly EditorCommand[]) {
  return commands.map((command) => {
    if (command.id === "paragraphFormat") {
      const value = command.value,
        details: string[] = [];
      for (const [key, label, unit] of [
        ["beforePt", "문단 앞", "pt"],
        ["afterPt", "문단 뒤", "pt"],
        ["leftMm", "왼쪽 들여쓰기", "mm"],
        ["rightMm", "오른쪽 들여쓰기", "mm"],
        ["firstLineMm", "첫 줄", "mm"],
      ] as const)
        if (value[key] !== undefined)
          details.push(`${label} ${value[key]}${unit}`);
      if (value.lineSpacing)
        details.push(
          `행간 ${value.lineSpacing.rule === "multiple" ? `${value.lineSpacing.value * 100}%` : `${value.lineSpacing.rule === "exact" ? "고정" : "최소"} ${value.lineSpacing.value}pt`}`,
        );
      for (const [key, label] of [
        ["keepNext", "다음 문단과 함께"],
        ["keepLines", "문단 줄 함께"],
        ["widowControl", "외톨이줄 보호"],
        ["pageBreakBefore", "문단 앞 쪽 나누기"],
      ] as const)
        if (value[key] !== undefined)
          details.push(`${label} ${value[key] ? "사용" : "해제"}`);
      return details.join(" · ");
    }
    return `${COMMAND_LABELS[command.id]}${"value" in command ? `: ${command.id === "fontSize" ? `${command.value}pt` : command.id === "lineSpacing" ? `${command.value * 100}%` : command.value}` : ""}`;
  });
}
