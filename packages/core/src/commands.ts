import { imageDimensions } from "./image-dimensions";
export interface ParagraphSettings {
  beforePt?: number;
  afterPt?: number;
  leftMm?: number;
  rightMm?: number;
  firstLineMm?: number;
  lineSpacing?: { rule: "multiple" | "exact" | "atLeast"; value: number };
  keepNext?: boolean;
  keepLines?: boolean;
  widowControl?: boolean;
  pageBreakBefore?: boolean;
}
export interface PageSettings {
  widthMm: number;
  heightMm: number;
  topMm: number;
  bottomMm: number;
  leftMm: number;
  rightMm: number;
  orientation: "portrait" | "landscape";
  scope?: "section" | "document";
}
export interface ImageInsert {
  bytes: Uint8Array;
  mimeType: "image/png" | "image/jpeg" | "image/gif";
  widthMm?: number;
  heightMm?: number;
  alt?: string;
}
export const SIMPLE_COMMANDS = [
  "selectAll",
  "undo",
  "redo",
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
  "pageBreak",
  "lineBreak",
  "insertRowAbove",
  "insertRowBelow",
  "insertColumnLeft",
  "insertColumnRight",
  "deleteRow",
  "deleteColumn",
  "deleteTable",
  "mergeCells",
  "showParagraphMarks",
] as const;
interface ValueCommands {
  fontFamily: string;
  fontSize: number;
  lineSpacing: number;
  zoom: number;
  textColor: string;
  highlightColor: string;
  characterSpacing: number;
  characterScale: number;
  paragraphFormat: ParagraphSettings;
  pageSetup: PageSettings;
  insertTable: { rows: number; columns: number };
  splitCell: { rows: number; columns: number };
  cellFill: string;
  cellVerticalAlign: "top" | "center" | "bottom";
  tableBorders: {
    scope: "all" | "outside" | "inside" | "none";
    color: string;
    widthPt: number;
  };
  insertImage: ImageInsert;
  insertText: string;
}
export const VALUE_COMMANDS = [
  "fontFamily",
  "fontSize",
  "lineSpacing",
  "zoom",
  "textColor",
  "highlightColor",
  "characterSpacing",
  "characterScale",
  "paragraphFormat",
  "pageSetup",
  "insertTable",
  "splitCell",
  "cellFill",
  "cellVerticalAlign",
  "tableBorders",
  "insertImage",
  "insertText",
] as const satisfies readonly (keyof ValueCommands)[];
export const COMMAND_IDS = [...SIMPLE_COMMANDS, ...VALUE_COMMANDS] as const;
export type CommandId = (typeof COMMAND_IDS)[number];
export type EditorCommand =
  | { id: (typeof SIMPLE_COMMANDS)[number] }
  | {
      [K in keyof ValueCommands]: { id: K; value: ValueCommands[K] };
    }[keyof ValueCommands];
const number = (
  value: unknown,
  min: number,
  max: number,
  label: string,
  integer = false,
) => {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isInteger(value))
  )
    throw new Error(`${label} 값이 허용 범위를 벗어났습니다.`);
};
const object = (
  value: unknown,
  keys: readonly string[],
  label: string,
): Record<string, unknown> => {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw new Error(`${label} 입력이 올바르지 않습니다.`);
  return value as Record<string, unknown>;
};
const color = (value: unknown) => {
  if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value))
    throw new Error("색상은 #RRGGBB로 입력해 주세요.");
};
export function validateCommand(command: EditorCommand): void {
  if (
    !command ||
    typeof command !== "object" ||
    !COMMAND_IDS.includes(command.id)
  )
    throw new Error("지원하지 않는 편집 명령입니다.");
  if (SIMPLE_COMMANDS.includes(command.id as (typeof SIMPLE_COMMANDS)[number]))
    return;
  if (!("value" in command)) throw new Error("명령 값이 필요합니다.");
  switch (command.id) {
    case "fontFamily":
      if (
        typeof command.value !== "string" ||
        !command.value.trim() ||
        command.value.length > 128
      )
        throw new Error("올바른 글꼴 이름을 입력해 주세요.");
      break;
    case "fontSize":
      number(command.value, 1, 200, command.id);
      break;
    case "lineSpacing":
      number(command.value, 0.5, 5, command.id);
      break;
    case "zoom":
      number(command.value, 0.25, 3, command.id);
      break;
    case "characterSpacing":
      number(command.value, -20, 100, command.id);
      break;
    case "characterScale":
      number(command.value, 50, 200, command.id);
      break;
    case "textColor":
    case "highlightColor":
    case "cellFill":
      color(command.value);
      break;
    case "cellVerticalAlign":
      if (!["top", "center", "bottom"].includes(command.value))
        throw new Error("셀 정렬이 올바르지 않습니다.");
      break;
    case "insertTable":
    case "splitCell": {
      const value = object(command.value, ["rows", "columns"], command.id);
      number(value.rows, 1, 100, "행", true);
      number(value.columns, 1, 50, "열", true);
      if ((value.rows as number) * (value.columns as number) > 2000)
        throw new Error("표의 셀 수 제한은 2,000개입니다.");
      break;
    }
    case "paragraphFormat": {
      const value = object(
        command.value,
        [
          "beforePt",
          "afterPt",
          "leftMm",
          "rightMm",
          "firstLineMm",
          "lineSpacing",
          "keepNext",
          "keepLines",
          "widowControl",
          "pageBreakBefore",
        ],
        command.id,
      );
      if (!Object.keys(value).length)
        throw new Error("문단 서식을 선택해 주세요.");
      for (const name of ["beforePt", "afterPt"])
        if (value[name] !== undefined) number(value[name], 0, 720, name);
      for (const name of ["leftMm", "rightMm"])
        if (value[name] !== undefined) number(value[name], 0, 300, name);
      if (value.firstLineMm !== undefined)
        number(value.firstLineMm, -300, 300, "첫 줄");
      for (const name of [
        "keepNext",
        "keepLines",
        "widowControl",
        "pageBreakBefore",
      ])
        if (value[name] !== undefined && typeof value[name] !== "boolean")
          throw new Error("문단 옵션은 boolean이어야 합니다.");
      if (value.lineSpacing !== undefined) {
        const line = object(value.lineSpacing, ["rule", "value"], "행간");
        if (!["multiple", "exact", "atLeast"].includes(String(line.rule)))
          throw new Error("행간 종류가 올바르지 않습니다.");
        number(
          line.value,
          line.rule === "multiple" ? 0.5 : 1,
          line.rule === "multiple" ? 5 : 200,
          "행간",
        );
      }
      break;
    }
    case "pageSetup": {
      const value = object(
        command.value,
        [
          "widthMm",
          "heightMm",
          "topMm",
          "bottomMm",
          "leftMm",
          "rightMm",
          "orientation",
          "scope",
        ],
        command.id,
      );
      number(value.widthMm, 50, 1000, "용지 너비");
      number(value.heightMm, 50, 1000, "용지 높이");
      for (const name of ["topMm", "bottomMm", "leftMm", "rightMm"])
        number(value[name], 0, 400, name);
      if (
        (value.leftMm as number) + (value.rightMm as number) >=
          (value.widthMm as number) ||
        (value.topMm as number) + (value.bottomMm as number) >=
          (value.heightMm as number)
      )
        throw new Error("여백이 용지 크기를 넘습니다.");
      if (
        !["portrait", "landscape"].includes(String(value.orientation)) ||
        (value.scope !== undefined &&
          !["section", "document"].includes(String(value.scope)))
      )
        throw new Error("페이지 설정이 올바르지 않습니다.");
      break;
    }
    case "tableBorders": {
      const value = object(
        command.value,
        ["scope", "color", "widthPt"],
        command.id,
      );
      if (!["all", "outside", "inside", "none"].includes(String(value.scope)))
        throw new Error("테두리 범위가 올바르지 않습니다.");
      color(value.color);
      number(value.widthPt, 0.25, 6, "선 굵기");
      break;
    }
    case "insertText":
      if (
        typeof command.value !== "string" ||
        !command.value.length ||
        command.value.length > 1_000_000 ||
        command.value.includes("\0")
      )
        throw new Error("입력할 텍스트가 올바르지 않습니다.");
      break;
    case "insertImage": {
      const value = object(
        command.value,
        ["bytes", "mimeType", "widthMm", "heightMm", "alt"],
        command.id,
      );
      if (
        !(value.bytes instanceof Uint8Array) ||
        !value.bytes.length ||
        value.bytes.length > 8 * 1024 * 1024
      )
        throw new Error("그림 크기 제한은 8 MiB입니다.");
      if (
        !["image/png", "image/jpeg", "image/gif"].includes(
          String(value.mimeType),
        )
      )
        throw new Error("PNG·JPEG·GIF 그림을 사용할 수 있습니다.");
      const bytes = value.bytes;
      const valid =
        value.mimeType === "image/png"
          ? bytes[0] === 137 &&
            bytes[1] === 80 &&
            bytes[2] === 78 &&
            bytes[3] === 71
          : value.mimeType === "image/jpeg"
            ? bytes[0] === 255 && bytes[1] === 216
            : bytes[0] === 71 && bytes[1] === 73 && bytes[2] === 70;
      if (!valid) throw new Error("그림 형식과 내용이 일치하지 않습니다.");
      imageDimensions(bytes, String(value.mimeType));
      for (const name of ["widthMm", "heightMm"])
        if (value[name] !== undefined) number(value[name], 1, 500, name);
      if (
        value.alt !== undefined &&
        (typeof value.alt !== "string" || value.alt.length > 2000)
      )
        throw new Error("그림 대체 텍스트가 너무 깁니다.");
      break;
    }
  }
}
const LABELS: Record<CommandId, string> = {
  selectAll: "전체 선택",
  undo: "되돌리기",
  redo: "다시 실행",
  bold: "굵게",
  italic: "기울임",
  underline: "밑줄",
  strike: "취소선",
  superscript: "위 첨자",
  subscript: "아래 첨자",
  clearFormatting: "서식 지우기",
  alignLeft: "왼쪽 정렬",
  alignCenter: "가운데 정렬",
  alignRight: "오른쪽 정렬",
  alignJustify: "양쪽 정렬",
  fontFamily: "글꼴",
  fontSize: "글자 크기",
  lineSpacing: "행간",
  zoom: "확대",
  textColor: "글자색",
  highlightColor: "강조색",
  characterSpacing: "자간",
  characterScale: "장평",
  paragraphFormat: "문단 설정",
  pageSetup: "페이지 설정",
  bulletList: "글머리표",
  numberedList: "번호 목록",
  increaseIndent: "들여쓰기 늘리기",
  decreaseIndent: "들여쓰기 줄이기",
  pageBreak: "쪽 나누기",
  lineBreak: "줄 나누기",
  insertTable: "표 삽입",
  insertRowAbove: "위에 행 삽입",
  insertRowBelow: "아래에 행 삽입",
  insertColumnLeft: "왼쪽 열 삽입",
  insertColumnRight: "오른쪽 열 삽입",
  deleteRow: "행 삭제",
  deleteColumn: "열 삭제",
  deleteTable: "표 삭제",
  mergeCells: "셀 병합",
  splitCell: "셀 분할",
  cellFill: "셀 배경색",
  cellVerticalAlign: "셀 세로 정렬",
  tableBorders: "표 테두리",
  insertImage: "그림 삽입",
  insertText: "텍스트 입력",
  showParagraphMarks: "문단 부호",
};
export const COMMAND_LABELS = LABELS;
const numericSchema = (minimum: number, maximum: number, unit?: string) => ({
  type: "number",
  minimum,
  maximum,
  ...(unit ? { "x-unit": unit } : {}),
});
const enumSchema = (...values: string[]) => ({ type: "string", enum: values });
const objectSchema = (
  properties: Record<string, unknown>,
  required: readonly string[] = [],
) => ({ type: "object", properties, required, additionalProperties: false });
const colorSchema = { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" };
const gridSchema = objectSchema(
  {
    rows: { type: "integer", minimum: 1, maximum: 100 },
    columns: { type: "integer", minimum: 1, maximum: 50 },
  },
  ["rows", "columns"],
);
/** Serializable value schemas. Runtime validation also enforces cross-field limits. */
export const COMMAND_INPUT_SCHEMAS: Record<
  keyof ValueCommands,
  Record<string, unknown>
> = {
  fontFamily: { type: "string", minLength: 1, maxLength: 128 },
  fontSize: numericSchema(1, 200, "pt"),
  lineSpacing: numericSchema(0.5, 5, "multiple"),
  zoom: numericSchema(0.25, 3, "ratio"),
  characterSpacing: numericSchema(-20, 100, "pt"),
  characterScale: numericSchema(50, 200, "percent"),
  textColor: colorSchema,
  highlightColor: colorSchema,
  cellFill: colorSchema,
  insertText: { type: "string", minLength: 1, maxLength: 1_000_000 },
  cellVerticalAlign: enumSchema("top", "center", "bottom"),
  insertTable: gridSchema,
  splitCell: gridSchema,
  tableBorders: objectSchema(
    {
      scope: enumSchema("all", "outside", "inside", "none"),
      color: colorSchema,
      widthPt: numericSchema(0.25, 6, "pt"),
    },
    ["scope", "color", "widthPt"],
  ),
  paragraphFormat: {
    ...objectSchema({
      beforePt: numericSchema(0, 720, "pt"),
      afterPt: numericSchema(0, 720, "pt"),
      leftMm: numericSchema(0, 300, "mm"),
      rightMm: numericSchema(0, 300, "mm"),
      firstLineMm: numericSchema(-300, 300, "mm"),
      lineSpacing: {
        oneOf: [
          objectSchema(
            {
              rule: { const: "multiple" },
              value: numericSchema(0.5, 5, "multiple"),
            },
            ["rule", "value"],
          ),
          objectSchema(
            {
              rule: enumSchema("exact", "atLeast"),
              value: numericSchema(1, 200, "pt"),
            },
            ["rule", "value"],
          ),
        ],
      },
      keepNext: { type: "boolean" },
      keepLines: { type: "boolean" },
      widowControl: { type: "boolean" },
      pageBreakBefore: { type: "boolean" },
    }),
    minProperties: 1,
  },
  pageSetup: objectSchema(
    {
      widthMm: numericSchema(50, 1000, "mm"),
      heightMm: numericSchema(50, 1000, "mm"),
      topMm: numericSchema(0, 400, "mm"),
      bottomMm: numericSchema(0, 400, "mm"),
      leftMm: numericSchema(0, 400, "mm"),
      rightMm: numericSchema(0, 400, "mm"),
      orientation: enumSchema("portrait", "landscape"),
      scope: enumSchema("section", "document"),
    },
    [
      "widthMm",
      "heightMm",
      "topMm",
      "bottomMm",
      "leftMm",
      "rightMm",
      "orientation",
    ],
  ),
  insertImage: objectSchema(
    {
      bytes: {
        type: "array",
        items: { type: "integer", minimum: 0, maximum: 255 },
        minItems: 1,
        maxItems: 8 * 1024 * 1024,
        "x-runtime-type":
          "Uint8Array (host transport must convert JSON byte arrays)",
      },
      mimeType: enumSchema("image/png", "image/jpeg", "image/gif"),
      widthMm: numericSchema(1, 500, "mm"),
      heightMm: numericSchema(1, 500, "mm"),
      alt: { type: "string", maxLength: 2000 },
    },
    ["bytes", "mimeType"],
  ),
};
export const AGENT_COMMAND_CATALOG = COMMAND_IDS.map((id) => ({
  id,
  description: LABELS[id],
  valueSchema: COMMAND_INPUT_SCHEMAS[id as keyof ValueCommands],
  ...(id === "fontSize"
    ? { input: { type: "number", unit: "pt", minimum: 1, maximum: 200 } }
    : id === "lineSpacing"
      ? {
          input: { type: "number", unit: "multiple", minimum: 0.5, maximum: 5 },
        }
      : id === "zoom"
        ? {
            input: { type: "number", unit: "ratio", minimum: 0.25, maximum: 3 },
          }
        : id === "characterSpacing"
          ? {
              input: { type: "number", unit: "pt", minimum: -20, maximum: 100 },
            }
          : id === "characterScale"
            ? {
                input: {
                  type: "number",
                  unit: "percent",
                  minimum: 50,
                  maximum: 200,
                },
              }
            : id === "fontFamily"
              ? { input: { type: "string", maxLength: 128 } }
              : ["textColor", "highlightColor", "cellFill"].includes(id)
                ? { input: { type: "string", format: "#RRGGBB" } }
                : VALUE_COMMANDS.includes(id as (typeof VALUE_COMMANDS)[number])
                  ? { input: COMMAND_INPUT_SCHEMAS[id as keyof ValueCommands] }
                  : {}),
}));
