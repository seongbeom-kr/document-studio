export type TemplateFormat = "docx" | "hwpx";
export interface TemplateTarget {
  id: string;
  kind: "text";
  part: string;
  text: string;
  address: string;
  editable: boolean;
  reason?: string;
  tableId?: string;
  rowId?: string;
  column?: number;
}
export interface TemplateRow {
  id: string;
  tableId: string;
  address: string;
  targetIds: string[];
  repeatable: boolean;
  reason?: string;
}
export interface TemplateStructure {
  schemaVersion: 2;
  sourceHash: string;
  format: TemplateFormat;
  targets: TemplateTarget[];
  rows: TemplateRow[];
  warnings: string[];
}
export interface TemplateField {
  id: string;
  label: string;
  type:
    | "string"
    | "multilineText"
    | "date"
    | "time"
    | "decimal"
    | "integer"
    | "enum"
    | "array";
  required: boolean;
  description?: string;
  maxLength?: number;
  choices?: string[];
  itemFields?: TemplateField[];
}
export interface TemplateValueFormat {
  kind: "date" | "time" | "decimal";
  pattern?: "YYYY-MM-DD" | "YYYY. M. D." | "YYYY년 M월 D일" | "HH:mm";
  decimals?: number;
  unit?: string;
}
export interface TemplateBinding {
  id: string;
  targetId: string;
  fieldId: string;
  start?: number;
  end?: number;
  format?: TemplateValueFormat;
}
export interface TemplateRepeatGroup {
  id: string;
  rowId: string;
  fieldId: string;
  bindings: TemplateBinding[];
  maxRows: number;
  empty: "remove" | "keep";
}
export type TemplateRule =
  | { id?: string; op: "required"; fieldId: string; message?: string }
  | {
      id?: string;
      op: "length";
      fieldId: string;
      min?: number;
      max?: number;
      message?: string;
    }
  | {
      id?: string;
      op: "range";
      fieldId: string;
      min?: string;
      max?: string;
      message?: string;
    }
  | {
      id?: string;
      op: "enum";
      fieldId: string;
      values: string[];
      message?: string;
    }
  | {
      id?: string;
      op: "equals" | "dateOrder" | "timeOrder";
      fieldId: string;
      otherFieldId: string;
      message?: string;
    }
  | {
      id?: string;
      op: "sumEquals";
      fieldId: string;
      arrayFieldId: string;
      itemFieldId: string;
      message?: string;
    }
  | { id?: string; op: "and" | "or"; rules: TemplateRule[]; message?: string };
export interface TemplateDefinition {
  schemaVersion: 2;
  sourceHash: string;
  format: TemplateFormat;
  fields: TemplateField[];
  bindings: TemplateBinding[];
  repeatGroups: TemplateRepeatGroup[];
  rules: TemplateRule[];
  output: { titleFieldId?: string; fileName?: string };
}
export const TEMPLATE_LIMITS = Object.freeze({
  sourceBytes: 32 * 1024 * 1024,
  xmlPartBytes: 8 * 1024 * 1024,
  xmlBytes: 64 * 1024 * 1024,
  fields: 200,
  bindings: 1000,
  rows: 100,
  targets: 10000,
  outputBytes: 64 * 1024 * 1024,
});
export class TemplateError extends Error {
  readonly effect = "none";
  constructor(
    readonly code: string,
    readonly fieldId?: string,
  ) {
    super(code);
    this.name = "TemplateError";
  }
}
export function fail(code: string, fieldId?: string): never {
  throw new TemplateError(code, fieldId);
}
