import {
  fail,
  TEMPLATE_LIMITS,
  type TemplateDefinition,
  type TemplateStructure,
  type TemplateField,
  type TemplateBinding,
  type TemplateRule,
} from "./types";
const object = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === "object" && !Array.isArray(x);
const keys = (x: unknown, allowed: string[]) => {
  if (!object(x) || Object.keys(x).some((k) => !allowed.includes(k)))
    fail("TEMPLATE_INVALID_DEFINITION");
};
const id = (x: unknown) =>
  typeof x === "string" && /^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(x);
const str = (x: unknown, max = 20000) =>
  typeof x === "string" &&
  x.length <= max &&
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(x);
export function decimal(value: unknown): { number: bigint; scale: number } {
  if (
    typeof value !== "string" ||
    !/^-?(?:0|[1-9][0-9]{0,17})(?:\.[0-9]{1,6})?$/.test(value)
  )
    return fail("TEMPLATE_DECIMAL_INVALID");
  const [whole, fraction = ""] = value.split(".");
  return { number: BigInt(whole! + fraction), scale: fraction.length };
}
export const compareDecimal = (a: string, b: string) => {
  const x = decimal(a),
    y = decimal(b),
    s = Math.max(x.scale, y.scale);
  return (
    x.number * 10n ** BigInt(s - x.scale) -
    y.number * 10n ** BigInt(s - y.scale)
  );
};
export function validDate(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value.startsWith("0000")
  )
    return false;
  const date = new Date(value + "T00:00:00Z");
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}
export const validTime = (value: unknown): value is string =>
  typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
function fieldsCheck(
  fields: TemplateField[],
  nested = false,
  budget = { count: 0 },
): void {
  if (
    !Array.isArray(fields) ||
    !fields.length ||
    fields.length > TEMPLATE_LIMITS.fields
  )
    fail("TEMPLATE_FIELDS_INVALID");
  const seen = new Set<string>();
  for (const f of fields) {
    if (++budget.count > TEMPLATE_LIMITS.fields)
      fail("TEMPLATE_FIELDS_INVALID");
    keys(f, [
      "id",
      "label",
      "type",
      "required",
      "description",
      "maxLength",
      "choices",
      "itemFields",
    ]);
    if (
      !id(f.id) ||
      seen.has(f.id) ||
      !str(f.label, 160) ||
      !f.label.trim() ||
      typeof f.required !== "boolean" ||
      ![
        "string",
        "multilineText",
        "date",
        "time",
        "decimal",
        "integer",
        "enum",
        "array",
      ].includes(f.type)
    )
      fail("TEMPLATE_FIELD_INVALID");
    seen.add(f.id);
    if (f.description !== undefined && !str(f.description, 4000))
      fail("TEMPLATE_FIELD_INVALID");
    if (
      f.maxLength !== undefined &&
      (!Number.isSafeInteger(f.maxLength) ||
        f.maxLength < 1 ||
        f.maxLength > 20000)
    )
      fail("TEMPLATE_FIELD_INVALID");
    if (f.type === "enum") {
      if (
        !Array.isArray(f.choices) ||
        !f.choices.length ||
        f.choices.length > 100 ||
        new Set(f.choices).size !== f.choices.length ||
        f.choices.some((v) => !str(v, 500))
      )
        fail("TEMPLATE_FIELD_INVALID");
    } else if (f.choices !== undefined) fail("TEMPLATE_FIELD_INVALID");
    if (f.type === "array") {
      if (nested) fail("TEMPLATE_NESTED_REPEAT");
      fieldsCheck(f.itemFields!, true, budget);
    } else if (f.itemFields !== undefined) fail("TEMPLATE_FIELD_INVALID");
  }
}
function rulesCheck(
  rules: TemplateRule[],
  fields: TemplateField[],
  depth = 0,
): void {
  if (depth > 8 || !Array.isArray(rules) || rules.length > 100)
    fail("TEMPLATE_RULE_INVALID");
  const lookup = new Map(fields.map((f) => [f.id, f]));
  for (const rule of rules) {
    if (
      !object(rule) ||
      !str(rule.message ?? "", 1000) ||
      (rule.id !== undefined && !id(rule.id))
    )
      fail("TEMPLATE_RULE_INVALID");
    if (rule.op === "and" || rule.op === "or") {
      keys(rule, ["id", "op", "rules", "message"]);
      if (!rule.rules.length) fail("TEMPLATE_RULE_INVALID");
      rulesCheck(rule.rules, fields, depth + 1);
      continue;
    }
    if (!("fieldId" in rule) || !lookup.has(rule.fieldId))
      fail("TEMPLATE_RULE_FIELD");
    const allowed = ["id", "op", "fieldId", "message"];
    switch (rule.op) {
      case "required":
        break;
      case "length":
        allowed.push("min", "max");
        for (const n of [rule.min, rule.max])
          if (
            n !== undefined &&
            (!Number.isSafeInteger(n) || n < 0 || n > 20000)
          )
            fail("TEMPLATE_RULE_INVALID");
        if (
          rule.min !== undefined &&
          rule.max !== undefined &&
          rule.min > rule.max
        )
          fail("TEMPLATE_RULE_INVALID");
        break;
      case "range":
        allowed.push("min", "max");
        for (const n of [rule.min, rule.max]) if (n !== undefined) decimal(n);
        if (
          rule.min !== undefined &&
          rule.max !== undefined &&
          compareDecimal(rule.min, rule.max) > 0n
        )
          fail("TEMPLATE_RULE_INVALID");
        break;
      case "enum":
        allowed.push("values");
        if (
          !Array.isArray(rule.values) ||
          !rule.values.length ||
          rule.values.length > 100 ||
          rule.values.some((v) => !str(v, 500))
        )
          fail("TEMPLATE_RULE_INVALID");
        break;
      case "equals":
      case "dateOrder":
      case "timeOrder":
        allowed.push("otherFieldId");
        if (!lookup.has(rule.otherFieldId)) fail("TEMPLATE_RULE_FIELD");
        break;
      case "sumEquals":
        allowed.push("arrayFieldId", "itemFieldId");
        if (
          lookup.get(rule.arrayFieldId)?.type !== "array" ||
          !lookup
            .get(rule.arrayFieldId)
            ?.itemFields?.some(
              (f) =>
                f.id === rule.itemFieldId &&
                ["decimal", "integer"].includes(f.type),
            )
        )
          fail("TEMPLATE_RULE_FIELD");
        break;
      default:
        fail("TEMPLATE_RULE_INVALID");
    }
    keys(rule, allowed);
  }
}
export function validBoundary(text: string, offset: number): boolean {
  if (offset === 0 || offset === text.length) return true;
  return [
    ...new Intl.Segmenter("und", { granularity: "grapheme" }).segment(text),
  ].some((s) => s.index === offset);
}
export function validateTemplateDefinition(
  def: TemplateDefinition,
  structure: TemplateStructure,
): void {
  keys(def, [
    "schemaVersion",
    "sourceHash",
    "format",
    "fields",
    "bindings",
    "repeatGroups",
    "rules",
    "output",
  ]);
  if (
    def.schemaVersion !== 2 ||
    def.sourceHash !== structure.sourceHash ||
    def.format !== structure.format
  )
    fail("TEMPLATE_SOURCE_CHANGED");
  fieldsCheck(def.fields);
  rulesCheck(def.rules, def.fields);
  keys(def.output, ["titleFieldId", "fileName"]);
  if (
    def.output.titleFieldId !== undefined &&
    !def.fields.some(
      (f) =>
        f.id === def.output.titleFieldId &&
        ["string", "multilineText"].includes(f.type),
    )
  )
    fail("TEMPLATE_OUTPUT_INVALID");
  if (
    def.output.fileName !== undefined &&
    (!str(def.output.fileName, 200) || /[\\/:*?"<>|]/.test(def.output.fileName))
  )
    fail("TEMPLATE_OUTPUT_INVALID");
  if (
    !Array.isArray(def.bindings) ||
    !Array.isArray(def.repeatGroups) ||
    def.repeatGroups.length > 50
  )
    fail("TEMPLATE_BINDINGS_INVALID");
  const ids = new Set<string>(),
    covered = new Map<string, Array<[number, number]>>(),
    usedRows = new Set<string>();
  let count = 0;
  const checkBindings = (
    bindings: TemplateBinding[],
    fields: TemplateField[],
    allowedTargets?: string[],
  ) => {
    if (!Array.isArray(bindings)) fail("TEMPLATE_BINDINGS_INVALID");
    for (const b of bindings) {
      if (++count > TEMPLATE_LIMITS.bindings) fail("TEMPLATE_BINDINGS_LIMIT");
      keys(b, ["id", "targetId", "fieldId", "start", "end", "format"]);
      if (!id(b.id) || ids.has(b.id)) fail("TEMPLATE_BINDING_INVALID");
      ids.add(b.id);
      const target = structure.targets.find((t) => t.id === b.targetId),
        field = fields.find((f) => f.id === b.fieldId);
      if (
        !target?.editable ||
        !field ||
        field.type === "array" ||
        (allowedTargets && !allowedTargets.includes(b.targetId))
      )
        fail("TEMPLATE_TARGET_INVALID");
      const start = b.start ?? 0,
        end = b.end ?? target.text.length;
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start < 0 ||
        end < start ||
        end > target.text.length ||
        !validBoundary(target.text, start) ||
        !validBoundary(target.text, end)
      )
        fail("TEMPLATE_RANGE_INVALID");
      const ranges = covered.get(b.targetId) ?? [];
      if (
        ranges.some(
          ([a, z]) =>
            (start < z && end > a) ||
            (start === end && start >= a && start <= z) ||
            (a === z && a >= start && a <= end),
        )
      )
        fail("TEMPLATE_RANGE_OVERLAP");
      ranges.push([start, end]);
      covered.set(b.targetId, ranges);
      if (b.format) {
        keys(b.format, ["kind", "pattern", "decimals", "unit"]);
        if (
          !["date", "time", "decimal"].includes(b.format.kind) ||
          b.format.kind !== field.type
        )
          fail("TEMPLATE_FORMAT_INVALID");
        if (
          b.format.pattern !== undefined &&
          !["YYYY-MM-DD", "YYYY. M. D.", "YYYY년 M월 D일", "HH:mm"].includes(
            b.format.pattern,
          )
        )
          fail("TEMPLATE_FORMAT_INVALID");
        if (
          (b.format.kind === "date" && b.format.pattern === "HH:mm") ||
          (b.format.kind !== "date" &&
            b.format.pattern &&
            b.format.pattern !== "HH:mm")
        )
          fail("TEMPLATE_FORMAT_INVALID");
        if (
          b.format.decimals !== undefined &&
          (!Number.isSafeInteger(b.format.decimals) ||
            b.format.decimals < 0 ||
            b.format.decimals > 6 ||
            b.format.kind !== "decimal")
        )
          fail("TEMPLATE_FORMAT_INVALID");
        if (
          b.format.unit !== undefined &&
          (!str(b.format.unit, 20) || b.format.kind !== "decimal")
        )
          fail("TEMPLATE_FORMAT_INVALID");
      }
    }
  };
  checkBindings(def.bindings, def.fields);
  for (const g of def.repeatGroups) {
    keys(g, ["id", "rowId", "fieldId", "bindings", "maxRows", "empty"]);
    const row = structure.rows.find((r) => r.id === g.rowId),
      field = def.fields.find((f) => f.id === g.fieldId);
    if (
      !id(g.id) ||
      ids.has(g.id) ||
      !row?.repeatable ||
      usedRows.has(g.rowId) ||
      field?.type !== "array" ||
      !Number.isSafeInteger(g.maxRows) ||
      g.maxRows < 1 ||
      g.maxRows > TEMPLATE_LIMITS.rows ||
      !["remove", "keep"].includes(g.empty)
    )
      fail("TEMPLATE_REPEAT_INVALID");
    if (def.bindings.some((b) => row.targetIds.includes(b.targetId)))
      fail("TEMPLATE_RANGE_OVERLAP");
    ids.add(g.id);
    usedRows.add(g.rowId);
    checkBindings(g.bindings, field.itemFields!, row.targetIds);
  }
  if (count === 0) fail("TEMPLATE_BINDINGS_EMPTY");
}
export function validateTemplateInput(
  def: TemplateDefinition,
  input: Record<string, unknown>,
): void {
  const validate = (
    fields: TemplateField[],
    values: Record<string, unknown>,
    prefix = "",
  ) => {
    if (
      !object(values) ||
      Object.keys(values).some((k) => !fields.some((f) => f.id === k))
    )
      fail("TEMPLATE_INPUT_UNKNOWN");
    for (const field of fields) {
      const value = values[field.id],
        path = prefix + field.id;
      if (value === undefined) {
        if (field.required) fail("TEMPLATE_INPUT_REQUIRED", path);
        continue;
      }
      if (value === null) fail("TEMPLATE_INPUT_INVALID", path);
      if (field.type === "array") {
        if (!Array.isArray(value) || value.length > TEMPLATE_LIMITS.rows)
          fail("TEMPLATE_INPUT_INVALID", path);
        for (const [i, row] of value.entries())
          validate(
            field.itemFields!,
            row as Record<string, unknown>,
            `${path}.${i}.`,
          );
        continue;
      }
      if (field.type === "integer") {
        if (!Number.isSafeInteger(value)) fail("TEMPLATE_INPUT_INVALID", path);
        continue;
      }
      if (
        !str(value, field.maxLength ?? 20000) ||
        typeof value !== "string" ||
        (field.required && !value.trim())
      )
        fail("TEMPLATE_INPUT_INVALID", path);
      if (field.type !== "multilineText" && /[\r\n\t]/.test(value))
        fail("TEMPLATE_INPUT_INVALID", path);
      if (
        (field.type === "date" && !validDate(value)) ||
        (field.type === "time" && !validTime(value)) ||
        (field.type === "enum" && !field.choices!.includes(value))
      )
        fail("TEMPLATE_INPUT_INVALID", path);
      if (field.type === "decimal") decimal(value);
    }
  };
  validate(def.fields, input);
  const evaluate = (r: TemplateRule): boolean => {
    if (r.op === "and" || r.op === "or")
      return r.op === "and" ? r.rules.every(evaluate) : r.rules.some(evaluate);
    if (!("fieldId" in r)) return false;
    const value = input[r.fieldId];
    switch (r.op) {
      case "required":
        return (
          value !== undefined && value !== null && String(value).trim() !== ""
        );
      case "length":
        return (
          typeof value === "string" &&
          (r.min === undefined || value.length >= r.min) &&
          (r.max === undefined || value.length <= r.max)
        );
      case "enum":
        return typeof value === "string" && r.values.includes(value);
      case "range":
        return (
          (r.min === undefined || compareDecimal(String(value), r.min) >= 0n) &&
          (r.max === undefined || compareDecimal(String(value), r.max) <= 0n)
        );
      case "equals":
        return value === input[r.otherFieldId];
      case "dateOrder":
        return (
          validDate(value) &&
          validDate(input[r.otherFieldId]) &&
          value <= String(input[r.otherFieldId])
        );
      case "timeOrder":
        return (
          validTime(value) &&
          validTime(input[r.otherFieldId]) &&
          value <= String(input[r.otherFieldId])
        );
      case "sumEquals": {
        const list = input[r.arrayFieldId];
        if (!Array.isArray(list)) return false;
        const terms = [
          decimal(String(value)),
          ...list.map((row) =>
            decimal(String((row as Record<string, unknown>)[r.itemFieldId])),
          ),
        ];
        const scale = Math.max(...terms.map((t) => t.scale));
        return (
          terms[0]!.number * 10n ** BigInt(scale - terms[0]!.scale) ===
          terms
            .slice(1)
            .reduce(
              (sum, t) => sum + t.number * 10n ** BigInt(scale - t.scale),
              0n,
            )
        );
      }
    }
  };
  for (const rule of def.rules)
    if (!evaluate(rule))
      fail("TEMPLATE_INPUT_RULE", "fieldId" in rule ? rule.fieldId : undefined);
}
