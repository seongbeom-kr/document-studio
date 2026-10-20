import type { createAgentBridge } from "./agent-bridge";
import { TABLE_COLUMN_SCHEMA } from "./table-column";

type Schema = {
  type?: string;
  oneOf?: readonly Schema[];
  const?: unknown;
  description?: string;
  properties?: Record<string, Schema>;
  required?: readonly string[];
  additionalProperties?: boolean;
  enum?: readonly unknown[];
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
};
const text = (maxLength = 1024): Schema => ({
  type: "string",
  minLength: 1,
  maxLength,
});
const identity = {
  documentId: text(),
  expectedSessionId: text(),
  expectedVersion: text(),
};
const write = { ...identity, expectedRevision: text() };
const operationId: Schema = {
  ...text(128),
  pattern: "^[a-zA-Z0-9._:-]{1,128}$",
};
const object = (
  properties: Record<string, Schema> = {},
  required: string[] = [],
): Schema => ({
  type: "object",
  additionalProperties: false,
  properties,
  required,
});
const definitions = {
  getState: {
    description:
      "Read compact current identity and revision. Takes an empty object; never pass document guards here.",
    inputSchema: object(),
  },
  readDocument: {
    description:
      "Read the connected document. A different file ID is not an auxiliary data reader.",
    inputSchema: object(identity, ["documentId"]),
  },
  search: {
    description:
      "Find exact targets before editing. Returns match IDs and revision. expectedRevision is not a search argument.",
    inputSchema: object(
      {
        ...identity,
        query: text(),
        matchCase: { type: "boolean" },
        wholeWord: { type: "boolean" },
        maxResults: { type: "integer", minimum: 1, maximum: 500 },
      },
      ["documentId", "query"],
    ),
  },
  select: {
    description:
      "Select a verified search match. Returns the selection key needed for selection-bound writes.",
    inputSchema: object({ ...write, matchId: text() }, [
      "documentId",
      "expectedSessionId",
      "expectedRevision",
      "matchId",
    ]),
  },
  replace: {
    description:
      "After user approval, replace one verified search match. Returns the resulting revision; commit separately to save.",
    inputSchema: object(
      {
        ...write,
        matchId: text(),
        replacement: { type: "string", maxLength: 10000 },
      },
      [
        "documentId",
        "expectedSessionId",
        "expectedRevision",
        "matchId",
        "replacement",
      ],
    ),
  },
  listTableColumnActions: {
    description:
      "Discover table preconditions, supported operations and exclusions.",
    inputSchema: object(),
  },
  readTable: {
    description:
      "Read the selected body table. Select a supported table cell first; known precondition errors have effect:none and requiredAction.",
    inputSchema: object(identity, ["documentId"]),
  },
  previewTableColumn: {
    description:
      "Preview one column: inspect every change and excluded cell before approval.",
    inputSchema: object({ ...identity, columnRequest: TABLE_COLUMN_SCHEMA }, [
      "documentId",
      "columnRequest",
    ]),
  },
  applyTableColumn: {
    description:
      "Apply an approved unchanged preview. Reuse operationId only for an identical request; commit separately.",
    inputSchema: object(
      {
        ...write,
        expectedSelectionKey: text(16384),
        previewId: text(),
        operationId,
      },
      [
        "documentId",
        "expectedSessionId",
        "expectedRevision",
        "expectedSelectionKey",
        "previewId",
        "operationId",
      ],
    ),
  },
  commit: {
    description:
      "Save the resulting revision to host storage and return a confirmed receipt. Reuse operationId only with identical guards.",
    inputSchema: object({ ...write, operationId }, [
      "documentId",
      "expectedSessionId",
      "expectedRevision",
      "operationId",
    ]),
  },
};
export type AgentToolName = keyof typeof definitions;
export class AgentToolArgumentError extends Error {
  readonly code = "invalid-arguments";
  readonly effect = "none";
  readonly requiredAction = "correct-arguments";
  constructor(
    message: string,
    readonly method: string,
    readonly argumentSchema?: Schema,
  ) {
    super(message);
    this.name = "AgentToolArgumentError";
  }
}
function validate(schema: Schema, value: unknown, path: string): void {
  const bad = () => {
    throw new Error(`Invalid argument: ${path}`);
  };
  if (schema.oneOf) {
    const matches = schema.oneOf.filter((option) => {
      try {
        validate(option, value, path);
        return true;
      } catch {
        return false;
      }
    });
    if (matches.length !== 1) bad();
    return;
  }
  if (Object.hasOwn(schema, "const")) {
    if (value !== schema.const) bad();
    return;
  }
  if (schema.enum && !schema.enum.includes(value)) bad();
  if (!schema.type && schema.enum) return;
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return bad();
    const record = value as Record<string, unknown>;
    if (
      Object.keys(record).some(
        (key) => !Object.hasOwn(schema.properties ?? {}, key),
      )
    )
      bad();
    for (const key of schema.required ?? [])
      if (!Object.hasOwn(record, key)) bad();
    for (const [key, entry] of Object.entries(record))
      validate(schema.properties![key]!, entry, `${path}.${key}`);
  } else if (schema.type === "string") {
    if (
      typeof value !== "string" ||
      value.length < (schema.minLength ?? 0) ||
      value.length > (schema.maxLength ?? Infinity) ||
      (schema.pattern && !new RegExp(schema.pattern).test(value))
    )
      bad();
  } else if (schema.type === "boolean") {
    if (typeof value !== "boolean") bad();
  } else if (schema.type === "integer" || schema.type === "number") {
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      (schema.type === "integer" && !Number.isSafeInteger(value)) ||
      value < (schema.minimum ?? -Infinity) ||
      value > (schema.maximum ?? Infinity)
    )
      bad();
  } else bad();
}

/** Provider-neutral, opt-in tools for common document tasks. Auth, approval and durable receipts belong to the host. */
export function createAgentToolset(
  bridge: ReturnType<typeof createAgentBridge>,
) {
  const methods = { ...bridge, getState: () => bridge.getContext() };
  return {
    list: () =>
      Object.entries(definitions).map(([name, definition]) => ({
        name: name as AgentToolName,
        ...structuredClone(definition),
      })),
    async invoke(name: string, input: unknown): Promise<unknown> {
      if (!Object.hasOwn(definitions, name))
        throw new AgentToolArgumentError("Unknown document method.", name);
      const schema = definitions[name as AgentToolName].inputSchema;
      try {
        validate(schema, input, "arguments");
      } catch (cause) {
        throw new AgentToolArgumentError(
          cause instanceof Error ? cause.message : "Invalid arguments.",
          name,
          structuredClone(schema),
        );
      }
      return (methods[name as AgentToolName] as (request: never) => unknown)(
        input as never,
      );
    },
  };
}
