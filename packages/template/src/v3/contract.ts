import * as compiled from "./generated/validators.cjs";
import { digest } from "../xml";
import { validInputSchemaV3 } from "./input-schema";
import type {
  ArtifactV3,
  DigestV3,
  ReportResultV3,
  TemplateDefinitionV3,
} from "./types";

export type V3ContractKind =
  | "structure"
  | "definition"
  | "plan"
  | "artifact"
  | "result";
const kinds: V3ContractKind[] = [
  "structure",
  "definition",
  "plan",
  "artifact",
  "result",
];
const validators = new Map(kinds.map((kind) => [kind, compiled[kind]]));
export const ARTIFACT_FIELDS_V3 = [
  "operationId",
  "outputFormat",
  "path",
  "digest",
  "byteLength",
  "verificationDigest",
] as const;

export function canonicalV3(value: unknown): string {
  const active = new WeakSet<object>();
  let count = 0;
  const fail = (): never => {
    throw new Error("REPORT_INVALID_CANONICAL_JSON");
  };
  const encode = (item: unknown, depth: number): string => {
    if (++count > 1000000 || depth > 64) return fail();
    if (item === null || typeof item === "boolean") return JSON.stringify(item);
    if (typeof item === "number")
      return Number.isSafeInteger(item)
        ? JSON.stringify(Object.is(item, -0) ? 0 : item)
        : fail();
    if (typeof item === "string") {
      if (
        item.length > 48 * 1024 * 1024 ||
        [...item].some((char) => {
          const cp = char.codePointAt(0)!;
          return cp >= 0xd800 && cp <= 0xdfff;
        })
      )
        return fail();
      return JSON.stringify(item);
    }
    if (typeof item !== "object" || active.has(item)) return fail();
    active.add(item);
    let serialized: string;
    if (Array.isArray(item))
      serialized =
        "[" +
        Array.from(item, (child) => encode(child, depth + 1)).join(",") +
        "]";
    else {
      if (
        Object.getPrototypeOf(item) !== Object.prototype &&
        Object.getPrototypeOf(item) !== null
      )
        return fail();
      serialized =
        "{" +
        Object.keys(item)
          .sort()
          .map(
            (key) =>
              encode(key, depth + 1) +
              ":" +
              encode((item as Record<string, unknown>)[key], depth + 1),
          )
          .join(",") +
        "}";
    }
    active.delete(item);
    return serialized;
  };
  const serialized = encode(value, 0);
  if (new TextEncoder().encode(serialized).length > 48 * 1024 * 1024)
    return fail();
  return serialized;
}

export async function digestV3(value: unknown): Promise<DigestV3> {
  return (await digest(
    new TextEncoder().encode(canonicalV3(value)),
  )) as DigestV3;
}

function artifactMatches(artifact: ArtifactV3): boolean {
  return (
    artifact.path.startsWith(`reports/${artifact.operationId}/`) &&
    artifact.path.endsWith(`.${artifact.outputFormat}`)
  );
}

export function validateContractV3(kind: V3ContractKind, value: unknown): void {
  const validator = validators.get(kind);
  const fail = (): never => {
    throw new Error(`REPORT_INVALID_V3_CONTRACT:${kind}`);
  };
  try {
    canonicalV3(value);
  } catch {
    return fail();
  }
  if (!validator || !validator(value)) return fail();
  if (kind === "artifact" && !artifactMatches(value as ArtifactV3))
    return fail();
  if (kind === "definition") {
    const definition = value as TemplateDefinitionV3;
    if (
      definition.inputSchema.type !== "object" ||
      !validInputSchemaV3(definition.inputSchema)
    )
      return fail();
    if (
      !definition.output.allowedFormats.includes(
        definition.output.defaultFormat,
      )
    )
      return fail();
    if (
      definition.regions.some(
        (region) => region.reviewState === "confirmed" && !region.reviewDigest,
      )
    )
      return fail();
    if (
      definition.regions.some(
        (region) =>
          region.range &&
          (region.kind !== "text" || region.range.start > region.range.end),
      )
    )
      return fail();
  }
  if (kind === "result") {
    const result = value as ReportResultV3;
    const artifact = result.artifact;
    if (
      artifact &&
      (!artifactMatches(artifact) ||
        result.operationId !== artifact.operationId)
    )
      return fail();
    if (
      result.generated === true &&
      (!artifact || result.localReceipt?.finalVerified !== true)
    )
      return fail();
    if (result.serverStored || result.completion === "completed") {
      if (
        !result.ok ||
        result.generated !== true ||
        !result.serverStored ||
        result.completion !== "completed" ||
        !artifact ||
        result.registration?.confirmed !== true
      )
        return fail();
    }
    for (const receipt of [result.localReceipt, result.registration]) {
      if (
        receipt &&
        (!artifact ||
          ARTIFACT_FIELDS_V3.some(
            (field) => receipt[field] !== artifact[field],
          ))
      )
        return fail();
    }
  }
}
