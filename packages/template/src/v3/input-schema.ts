const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const safeInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value);
/** Only the declarative input vocabulary is accepted; no refs, patterns or code. */
export function validInputSchemaV3(value: unknown, depth = 0): boolean {
  if (!object(value) || depth > 16) return false;
  const type = value.type;
  if (
    typeof type !== "string" ||
    !["object", "array", "string", "integer", "boolean"].includes(type)
  )
    return false;
  const common = ["type", "title", "description", "enum"];
  const extra =
    type === "object"
      ? ["properties", "required", "additionalProperties"]
      : type === "array"
        ? ["items", "minItems", "maxItems"]
        : type === "string"
          ? ["minLength", "maxLength", "format"]
          : type === "integer"
            ? ["minimum", "maximum"]
            : [];
  if (Object.keys(value).some((key) => ![...common, ...extra].includes(key)))
    return false;
  for (const [key, limit] of [
    ["title", 200],
    ["description", 4000],
  ] as const)
    if (
      key in value &&
      (typeof value[key] !== "string" || [...value[key]].length > limit)
    )
      return false;
  if ("enum" in value) {
    if (
      !Array.isArray(value.enum) ||
      !value.enum.length ||
      value.enum.length > 200
    )
      return false;
    if (
      value.enum.some((item) =>
        type === "string"
          ? typeof item !== "string"
          : type === "integer"
            ? !safeInteger(item)
            : type === "boolean"
              ? typeof item !== "boolean"
              : true,
      )
    )
      return false;
  }
  if (type === "object") {
    const properties = value.properties ?? {};
    if (
      !object(properties) ||
      Object.keys(properties).length > 200 ||
      value.additionalProperties !== false
    )
      return false;
    if (
      Object.entries(properties).some(
        ([key, schema]) =>
          !key ||
          [...key].length > 128 ||
          ["__proto__", "prototype", "constructor"].includes(key) ||
          !validInputSchemaV3(schema, depth + 1),
      )
    )
      return false;
    if (
      "required" in value &&
      (!Array.isArray(value.required) ||
        new Set(value.required).size !== value.required.length ||
        value.required.some(
          (key) => typeof key !== "string" || !Object.hasOwn(properties, key),
        ))
    )
      return false;
  }
  if (type === "array" && !validInputSchemaV3(value.items, depth + 1))
    return false;
  const ranges =
    type === "array"
      ? [["minItems", "maxItems", 1000]]
      : type === "string"
        ? [["minLength", "maxLength", 20000]]
        : type === "integer"
          ? [["minimum", "maximum", Number.MAX_SAFE_INTEGER]]
          : [];
  for (const [low, high, maximum] of ranges as [string, string, number][]) {
    for (const key of [low, high])
      if (
        key in value &&
        (!safeInteger(value[key]) ||
          Math.abs(value[key]) > maximum ||
          (type !== "integer" && value[key] < 0))
      )
        return false;
    if (
      low in value &&
      high in value &&
      (value[low] as number) > (value[high] as number)
    )
      return false;
  }
  if (
    "format" in value &&
    (typeof value.format !== "string" ||
      !["date", "time", "decimal"].includes(value.format))
  )
    return false;
  return true;
}
