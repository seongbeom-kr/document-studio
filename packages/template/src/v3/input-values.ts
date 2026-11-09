import { canonicalV3 } from "./contract";
import { validInputSchemaV3 } from "./input-schema";

export class ReportInputErrorV3 extends Error {
  readonly code = "REPORT_INVALID_INPUT";
  constructor(public readonly field: string, public readonly reason: string) {
    super(`REPORT_INVALID_INPUT:${field}:${reason}`);
    this.name = "ReportInputErrorV3";
  }
}
const fail = (field: string, reason: string): never => { throw new ReportInputErrorV3(field, reason); };
function formatValid(format: unknown, value: string): boolean {
  if (format === "decimal") return /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value);
  if (format === "time") return /^(?:[01][0-9]|2[0-3]):[0-5][0-9](?::[0-5][0-9])?$/.test(value);
  if (format !== "date") return true;
  const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!;
}
/** Interpret the finite vocabulary without compiling user schemas or executable expressions. */
export function validateInputValuesV3(schema: Record<string, unknown>, values: unknown): void {
  try { canonicalV3(schema); } catch { fail("$schema", "schema"); }
  if (!validInputSchemaV3(schema)) fail("$schema", "schema");
  try { canonicalV3(values); } catch { fail("$", "canonical"); }
  const check = (rule: Record<string, unknown>, value: unknown, field: string): void => {
    const kind = rule.type;
    if (kind === "object") {
      if (!value || typeof value !== "object" || Array.isArray(value)) fail(field, "type");
      const object = value as Record<string, unknown>, properties = (rule.properties ?? {}) as Record<string, Record<string, unknown>>;
      for (const key of (rule.required ?? []) as string[]) if (!Object.hasOwn(object, key)) fail(`${field}.${key}`, "required");
      for (const key of Object.keys(object)) {
        if (!Object.hasOwn(properties, key)) fail(`${field}.${key}`, "additional-property");
        check(properties[key]!, object[key], `${field}.${key}`);
      }
    } else if (kind === "array") {
      if (!Array.isArray(value)) fail(field, "type");
      const array = value as unknown[];
      if (array.length < Number(rule.minItems ?? 0) || array.length > Number(rule.maxItems ?? 1000)) fail(field, "length");
      array.forEach((item, index) => check(rule.items as Record<string, unknown>, item, `${field}[${index}]`));
    } else if (kind === "string") {
      if (typeof value !== "string") fail(field, "type");
      const text = value as string, length = [...text].length;
      if (length < Number(rule.minLength ?? 0) || length > Number(rule.maxLength ?? 20000)) fail(field, "length");
      if (!formatValid(rule.format, text)) fail(field, `format-${rule.format}`);
    } else if (kind === "integer") {
      if (!Number.isSafeInteger(value)) fail(field, "type");
      if ((value as number) < Number(rule.minimum ?? -Number.MAX_SAFE_INTEGER) || (value as number) > Number(rule.maximum ?? Number.MAX_SAFE_INTEGER)) fail(field, "range");
    } else if (typeof value !== "boolean") fail(field, "type");
    if (rule.enum && !(rule.enum as unknown[]).includes(value)) fail(field, "enum");
  };
  check(schema, values, "$");
}
