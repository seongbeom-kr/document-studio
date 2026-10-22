import { expect, it, vi } from "vitest";
import {
  createAgentBridge,
  createAgentSessionTools,
  agentToolFailure,
  AgentGuardError,
  TableVerificationError,
  type EditorController,
  type EditorControllerState,
} from "@document-studio/core";

function setup() {
  const state = {
    documentId: "doc",
    sessionId: "session",
    version: "v1",
    revision: "1",
    ready: true,
    dirty: false,
    selectionKey: "range",
    commands: {},
    format: "docx",
  } as EditorControllerState;
  let attached = true;
  const editor = {
    getState: () => ({ ...state }),
    search: vi.fn(async () => ({
      revision: state.revision,
      matches: [{ id: "match", text: "old" }],
      total: 1,
      truncated: false,
    })),
    replace: vi.fn(async () => {
      state.revision = "2";
      state.dirty = true;
      return { count: 1 };
    }),
    commit: vi.fn(async () => {
      state.version = "v2";
      state.dirty = false;
      return {
        documentId: "doc",
        sessionId: "session",
        version: "v2",
        savedRevision: state.revision,
      };
    }),
    previewMailMerge: vi.fn(() => ({ previewId: "merge", checks: [] })),
  } as unknown as EditorController;
  const tools = createAgentSessionTools(
    createAgentBridge(() => (attached ? editor : null)),
  );
  const context = async () =>
    (await tools.invoke("getState", {})).context!.contextRef!;
  return {
    state,
    editor,
    tools,
    context,
    detach: () => {
      attached = false;
    },
  };
}
it("advertises references, not copyable document/session/version guards", async () => {
  const t = setup(),
    list = t.tools.list();
  const replace = list.find((v) => v.name === "replace")!.inputSchema;
  expect(replace.required).toEqual([
    "contextRef",
    "matchId",
    "replacement",
    "operationId",
  ]);
  expect(replace.properties).not.toHaveProperty("expectedRevision");
  const contextRef = await t.context();
  await t.tools.invoke("replace", {
    contextRef,
    matchId: "match",
    replacement: "new",
    operationId: "change",
  });
  expect(t.editor.replace).toHaveBeenCalledWith(
    expect.objectContaining({
      documentId: "doc",
      expectedSessionId: "session",
      expectedRevision: "1",
      expectedVersion: "v1",
    }),
    "1",
  );
});
it.each([
  "documentId",
  "sessionId",
  "version",
  "revision",
  "selectionKey",
] as const)(
  "does not issue a context for a different getState %s",
  async (field) => {
    const t = setup();
    const pending = t.tools.invoke("getState", {});
    queueMicrotask(() => {
      t.state[field] = "changed";
    });
    await expect(pending).rejects.toMatchObject({
      code: "agent-context-mismatch",
      field,
      effect: "none",
    });
    const fresh = await t.tools.invoke("getState", {});
    expect(fresh.context).toMatchObject({ [field]: "changed" });
    expect(fresh.context?.contextRef).toBeTypeOf("string");
    expect(t.editor.replace).not.toHaveBeenCalled();
    expect(t.editor.commit).not.toHaveBeenCalled();
  },
);
it("does not bind a ready getState result to a later not-ready snapshot", async () => {
  const t = setup();
  const pending = t.tools.invoke("getState", {});
  queueMicrotask(() => {
    t.state.ready = false;
  });
  await expect(pending).rejects.toMatchObject({
    code: "editor-not-ready",
    effect: "none",
    requiredAction: "wait-for-ready",
  });
  const fresh = await t.tools.invoke("getState", {});
  expect(fresh.result).toMatchObject({ ready: false });
  expect(fresh.context?.contextRef).toBeNull();
});
it("preserves initialization recovery details for an otherwise current reference", async () => {
  const t = setup(),
    contextRef = await t.context();
  t.state.ready = false;
  t.state.initialization = {
    status: "failed",
    error: {
      code: "engine-initialization-timeout",
      message: "retry",
      retryable: true,
    },
  };
  await expect(
    t.tools
      .invoke("search", { contextRef, query: "old" })
      .catch(agentToolFailure),
  ).resolves.toMatchObject({
    code: "editor-initialization-failed",
    effect: "none",
    requiredAction: "retry-initialization",
  });
  expect(t.editor.search).not.toHaveBeenCalled();
});
it("serializes actionable failures without stack traces or internal causes", () => {
  expect(
    JSON.parse(
      JSON.stringify(agentToolFailure(new AgentGuardError("sessionId"))),
    ),
  ).toMatchObject({
    code: "agent-context-mismatch",
    field: "sessionId",
    effect: "none",
  });
  const result = agentToolFailure(
    new TableVerificationError(
      { status: "mismatch", checkedCells: 1, differences: [] },
      { cause: new Error("private server address") },
    ),
  );
  expect(result).toMatchObject({
    code: "table-verification-failed",
    requiredAction: "inspect-result-or-undo",
  });
  expect(JSON.stringify(result)).not.toContain("private");
  expect(
    JSON.stringify(agentToolFailure(new Error("private token"))),
  ).not.toContain("private");
});
it.each([
  "documentId",
  "sessionId",
  "version",
  "revision",
  "selectionKey",
] as const)(
  "rejects changed %s instead of substituting fresh state",
  async (field) => {
    const t = setup(),
      contextRef = await t.context();
    (t.state[field] as string) = "different";
    await expect(
      t.tools.invoke("replace", {
        contextRef,
        matchId: "match",
        replacement: "new",
        operationId: "x",
      }),
    ).rejects.toMatchObject({
      code: "agent-context-mismatch",
      field,
      effect: "none",
    });
    expect(t.editor.replace).not.toHaveBeenCalled();
  },
);
it("rejects references from another instance, expired references and disposed instances", async () => {
  const t = setup(),
    other = setup(),
    contextRef = await t.context();
  await expect(
    other.tools.invoke("search", { contextRef, query: "old" }),
  ).rejects.toMatchObject({ field: "contextRef" });
  for (let i = 0; i < 64; i++) await t.context();
  await expect(
    t.tools.invoke("search", { contextRef, query: "old" }),
  ).rejects.toMatchObject({ field: "contextRef" });
  t.tools.dispose();
  await expect(t.tools.invoke("getState", {})).rejects.toMatchObject({
    field: "contextRef",
  });
});
it("replays identical writes once and checks identity before returning cached receipts", async () => {
  const t = setup(),
    contextRef = await t.context();
  const input = {
    contextRef,
    matchId: "match",
    replacement: "new",
    operationId: "write",
  };
  const [one, two] = await Promise.all([
    t.tools.invoke("replace", input),
    t.tools.invoke("replace", input),
  ]);
  expect(two).toEqual(one);
  expect(t.editor.replace).toHaveBeenCalledOnce();
  await expect(
    t.tools.invoke("replace", { ...input, replacement: "other" }),
  ).rejects.toMatchObject({ code: "invalid-arguments" });
  t.state.sessionId = "other";
  await expect(t.tools.invoke("replace", input)).rejects.toMatchObject({
    field: "sessionId",
  });
});
it("serializes different writes so a second stale request is rejected", async () => {
  const t = setup(),
    contextRef = await t.context();
  const request = {
    contextRef,
    matchId: "match",
    replacement: "new",
    operationId: "one",
  };
  const results = await Promise.allSettled([
    t.tools.invoke("replace", request),
    t.tools.invoke("replace", { ...request, operationId: "two" }),
  ]);
  expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected"]);
  expect(t.editor.replace).toHaveBeenCalledOnce();
});
it("invalidates observations after an uncertain write, retains its failure and never replays it", async () => {
  const t = setup(),
    contextRef = await t.context(),
    otherRef = await t.context();
  vi.mocked(t.editor.replace).mockRejectedValue(new Error("response lost"));
  const input = {
    contextRef,
    matchId: "match",
    replacement: "new",
    operationId: "uncertain",
  };
  await expect(t.tools.invoke("replace", input)).rejects.toThrow(
    "response lost",
  );
  await expect(t.tools.invoke("replace", input)).rejects.toThrow(
    "response lost",
  );
  await expect(
    t.tools.invoke("replace", {
      ...input,
      contextRef: otherRef,
      operationId: "different",
    }),
  ).rejects.toMatchObject({ field: "contextRef" });
  expect(t.editor.replace).toHaveBeenCalledOnce();
});
it("does not attach another document's context to a successful save receipt", async () => {
  const t = setup(),
    contextRef = await t.context();
  vi.mocked(t.editor.commit!).mockImplementationOnce(async () => {
    t.state.documentId = "different";
    t.state.sessionId = "new-session";
    return { version: "saved-v2" } as never;
  });
  expect(
    await t.tools.invoke("commit", { contextRef, operationId: "saved" }),
  ).toEqual({ result: { version: "saved-v2" }, context: null });
});
it("rejects a read that races with editing", async () => {
  const t = setup(),
    contextRef = await t.context();
  vi.mocked(t.editor.search).mockImplementationOnce(async () => {
    t.state.revision = "2";
    return { revision: "2", matches: [], total: 0, truncated: false };
  });
  await expect(
    t.tools.invoke("search", { contextRef, query: "old" }),
  ).rejects.toMatchObject({ field: "revision", effect: "none" });
});
it("does not lose a successful storage receipt if the host closes afterwards", async () => {
  const t = setup(),
    contextRef = await t.context();
  vi.mocked(t.editor.commit!).mockImplementationOnce(async () => {
    t.detach();
    return { version: "v2" } as never;
  });
  expect(
    await t.tools.invoke("commit", { contextRef, operationId: "saved" }),
  ).toEqual({ result: { version: "v2" }, context: null });
});
it("replays a successful save across the resulting version change without uploading twice", async () => {
  const t = setup(),
    contextRef = await t.context();
  const request = { contextRef, operationId: "saved" };
  const result = await t.tools.invoke("commit", request);
  expect(result.context).toMatchObject({ version: "v2" });
  expect(await t.tools.invoke("commit", request)).toEqual(result);
  expect(t.editor.commit).toHaveBeenCalledOnce();
});
it("validates nested mail mapping and snapshots queued inputs", async () => {
  const t = setup(),
    contextRef = await t.context();
  const input = {
    contextRef,
    mergeRequest: {
      templateId: "template",
      data: "name\n홍길동",
      delimiter: ",",
      mapping: { 이름: "name" },
      fileNamePattern: "{{#}}.docx",
      allowEmpty: false,
    },
  };
  const result = t.tools.invoke("previewMailMerge", input);
  input.mergeRequest.mapping.이름 = "changed";
  await result;
  expect(t.editor.previewMailMerge).toHaveBeenCalledWith(
    expect.objectContaining({ mapping: { 이름: "name" } }),
  );
  await expect(
    t.tools.invoke("previewMailMerge", {
      ...input,
      mergeRequest: { ...input.mergeRequest, mapping: { 이름: 3 } },
    }),
  ).rejects.toMatchObject({
    code: "invalid-arguments",
    argumentSchema: { required: ["contextRef", "mergeRequest"] },
  });
});
it("validates cyclic and oversized inputs before fingerprinting and supplies the contextual correction schema", async () => {
  const t = setup(),
    contextRef = await t.context();
  const cyclic: Record<string, unknown> = { contextRef, query: "" };
  cyclic.query = cyclic;
  await expect(t.tools.invoke("search", cyclic)).rejects.toMatchObject({
    code: "invalid-arguments",
    argumentSchema: { required: ["contextRef", "query"] },
  });
  await expect(
    t.tools.invoke("search", { contextRef, query: "a".repeat(1025) }),
  ).rejects.toMatchObject({
    code: "invalid-arguments",
    effect: "none",
  });
  expect(t.editor.search).not.toHaveBeenCalled();
});
it.each([
  ["getState", { contextRef: "x" }],
  ["search", { contextRef: "x", query: "q", documentId: "doc" }],
  ["replace", { contextRef: "x", matchId: "m", replacement: "v" }],
])("rejects invalid %s arguments", async (name, input) => {
  const t = setup();
  await expect(t.tools.invoke(name as string, input)).rejects.toMatchObject({
    code: "invalid-arguments",
  });
});
