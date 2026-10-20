import type { createAgentBridge } from "./agent-bridge";
import {
  createAgentToolset,
  AgentToolArgumentError,
  assertAgentToolArguments,
  type AgentToolName,
  type AgentToolSchema,
} from "./agent-tools";
import { AgentGuardError } from "./agent-guard";

type Bridge = ReturnType<typeof createAgentBridge>;
type Context = ReturnType<Bridge["getContext"]>;
const fields = [
  "documentId",
  "sessionId",
  "version",
  "revision",
  "selectionKey",
] as const;
const guards = [
  "documentId",
  "expectedSessionId",
  "expectedVersion",
  "expectedRevision",
  "expectedSelectionKey",
];
const mutating = new Set([
  "replace",
  "applyTableColumn",
  "applyQuickAction",
  "generateMailMerge",
  "commit",
]);
const changesContext = new Set([...mutating, "select", "saveMailMergeResults"]);
const guardValue: Record<string, keyof Context> = {
  documentId: "documentId",
  expectedSessionId: "sessionId",
  expectedVersion: "version",
  expectedRevision: "revision",
  expectedSelectionKey: "selectionKey",
};
const stable = (value: unknown): string =>
  JSON.stringify(value, (_, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
        )
      : item,
  );

/**
 * Opt-in transport-neutral tools. Opaque references bind the exact observed
 * document/session/version/revision/range; they never refresh stale arguments.
 * References and replay receipts live only in this instance. The host still
 * owns authorization, approval, cancellation and durable receipt storage.
 */
export function createAgentSessionTools(bridge: Bridge) {
  const tools = createAgentToolset(bridge);
  const originals = new Map(tools.list().map((t) => [t.name, t]));
  const references = new Map<string, Context>();
  const operations = new Map<
    string,
    {
      fingerprint: string;
      context: Context;
      task: Promise<{
        result: unknown;
        context: (Context & { contextRef: string | null }) | null;
      }>;
    }
  >();
  let disposed = false;
  // Prevent two calls from validating the same context and then changing it concurrently.
  let tail: Promise<unknown> = Promise.resolve();
  const current = () => {
    if (disposed) throw new AgentGuardError("contextRef");
    return structuredClone(bridge.getContext());
  };
  const capture = () => {
    const state = current();
    if (!state.ready) return { ...state, contextRef: null };
    const contextRef = crypto.randomUUID();
    if (references.size >= 64)
      references.delete(references.keys().next().value!);
    references.set(contextRef, state);
    return { ...state, contextRef };
  };
  const assertContext = (expected: Context, selection = true) => {
    const now = current();
    for (const field of fields)
      if (
        (selection || field !== "selectionKey") &&
        expected[field] !== now[field]
      )
        throw new AgentGuardError(field);
    if (!now.ready) throw new AgentGuardError("contextRef");
  };
  const list = () =>
    tools.list().map((tool) => {
      const schema = tool.inputSchema;
      const hasTarget = Object.hasOwn(schema.properties ?? {}, "documentId");
      if (hasTarget) {
        for (const key of guards) delete schema.properties![key];
        schema.required = (schema.required ?? []).filter(
          (key) => !guards.includes(key),
        );
        schema.properties!.contextRef = {
          type: "string",
          minLength: 1,
          maxLength: 128,
        };
        schema.required = ["contextRef", ...schema.required];
      }
      if (mutating.has(tool.name)) {
        schema.properties!.operationId = {
          type: "string",
          minLength: 1,
          maxLength: 128,
          pattern: "^[a-zA-Z0-9._:-]{1,128}$",
        };
        schema.required = [
          ...new Set([...(schema.required ?? []), "operationId"]),
        ];
      }
      return {
        ...tool,
        description: `${tool.description} Use the contextRef returned by this toolset. If expired, read getState and review the target again.`,
      };
    });
  const error = (method: string, message: string, schema?: AgentToolSchema) =>
    new AgentToolArgumentError(message, method, schema);
  return {
    list,
    /** Clear sensitive snapshots and local receipts when the host session ends. In-flight effects are not cancelled. */
    dispose() {
      disposed = true;
      references.clear();
      operations.clear();
    },
    invoke(
      name: string,
      value: unknown,
    ): Promise<{
      result: unknown;
      context: (Context & { contextRef: string | null }) | null;
    }> {
      let input: Record<string, unknown>;
      try {
        if (!value || typeof value !== "object" || Array.isArray(value))
          throw error(name, "Arguments must be an object.");
        input = structuredClone(value) as Record<string, unknown>;
      } catch (cause) {
        return Promise.reject(cause);
      }
      const task = tail.then(async () => {
        current();
        const original = originals.get(name as AgentToolName);
        const schema = list().find((t) => t.name === name)?.inputSchema;
        if (!original || !schema) throw error(name, "Unknown document method.");
        assertAgentToolArguments(name, schema, input);
        const hasTarget = Object.hasOwn(
          original.inputSchema.properties ?? {},
          "documentId",
        );
        const fingerprint = stable([name, input]);
        const id = input.operationId;
        if (mutating.has(name)) {
          if (typeof id !== "string" || !/^[a-zA-Z0-9._:-]{1,128}$/.test(id))
            throw error(name, "A valid operationId is required.", schema);
          const previous = operations.get(id);
          if (previous) {
            if (previous.fingerprint !== fingerprint)
              throw error(
                name,
                "operationId already belongs to a different request.",
                schema,
              );
            const now = current();
            for (const field of ["documentId", "sessionId"] as const)
              if (now[field] !== previous.context[field])
                throw new AgentGuardError(field);
            // Return the original result, including its original (possibly expired) context.
            return structuredClone(await previous.task);
          }
          if (operations.size >= 128)
            throw error(
              name,
              "Operation ledger is full. Persist receipts before creating a new toolset.",
              schema,
            );
        }
        let observed: Context | undefined;
        const args = { ...input };
        if (hasTarget) {
          if (typeof input.contextRef !== "string")
            throw error(name, "contextRef is required.", schema);
          observed = references.get(input.contextRef);
          if (!observed) throw new AgentGuardError("contextRef");
          assertContext(observed);
          delete args.contextRef;
          for (const key of guards) {
            if (Object.hasOwn(original.inputSchema.properties ?? {}, key)) {
              const v = observed[guardValue[key]!];
              if (v !== undefined) args[key] = v;
            }
          }
        }
        if (
          !Object.hasOwn(original.inputSchema.properties ?? {}, "operationId")
        )
          delete args.operationId;
        const run = async () => {
          let result: unknown;
          try {
            result = await tools.invoke(name, args);
          } catch (cause) {
            if (observed && mutating.has(name))
              for (const [reference, context] of references)
                if (
                  context.documentId === observed.documentId &&
                  context.sessionId === observed.sessionId
                )
                  references.delete(reference);
            if (cause instanceof AgentToolArgumentError)
              throw error(name, cause.message, schema);
            throw cause;
          }
          if (observed && !changesContext.has(name)) assertContext(observed);
          // Saving/applying may have succeeded even if the host unmounted afterwards.
          // Preserve that receipt rather than returning a false save failure.
          let context: ReturnType<typeof capture> | null = null;
          try {
            const next = capture();
            if (
              !observed ||
              (next.documentId === observed.documentId &&
                next.sessionId === observed.sessionId)
            )
              context = next;
          } catch {
            /* receipt remains authoritative */
          }
          return { result, context };
        };
        const operation = run();
        if (mutating.has(name) && observed)
          operations.set(id as string, {
            fingerprint,
            context: observed,
            task: operation,
          });
        return structuredClone(await operation);
      });
      tail = task.catch(() => undefined);
      return task;
    },
  };
}
