import { expect, it, vi } from "vitest";
import {
  agentToolFailure,
  createAgentBridge,
  createAgentToolset,
  type EditorController,
  type EditorControllerState,
} from "@document-studio/core";

vi.mock("../../packages/core/src/inspect", () => ({
  inspectExport: () => ({ tables: [], images: [], truncated: false }),
}));

function setup() {
  const state = {
    documentId: "doc",
    sessionId: "session",
    version: "v1",
    revision: "1",
    dirty: false,
    ready: true,
    commands: {},
    format: "hwpx",
  } as EditorControllerState;
  const controller = {
    getState: () => ({ ...state }),
    readDocument: vi.fn(async () => ({ revision: "1", text: "original" })),
    search: vi.fn(async () => ({ revision: "1", matches: [] })),
    readTable: vi.fn(async () => ({ revision: "1", cells: [] })),
    previewTableColumn: vi.fn(async () => ({ previewId: "preview" })),
    commit: vi.fn(async () => ({ version: "v2", savedRevision: "1" })),
  } as unknown as EditorController;
  const bridge = createAgentBridge(() => controller);
  const tools = createAgentToolset(bridge);
  return { state, controller, bridge, tools };
}

it.each(["readDocument", "search", "readTable", "previewTableColumn"] as const)(
  "does not confirm %s after readiness is lost during the read",
  async (method) => {
    const f = setup();
    let release!: () => void;
    vi.mocked(f.controller[method]!).mockImplementation(
      () =>
        new Promise<never>((resolve) => {
          release = () =>
            resolve({ revision: "1", text: "stale", previewId: "p" } as never);
        }),
    );
    const result = f.tools.invoke(method, {
      documentId: "doc",
      ...(method === "search" ? { query: "original" } : {}),
      ...(method === "previewTableColumn"
        ? {
            columnRequest: {
              column: 1,
              columnKind: "number",
              headerRows: 1,
              operation: { kind: "commas" },
            },
          }
        : {}),
    });
    f.state.ready = false;
    release();
    const error = await result.then(
      () => null,
      (cause: unknown) => cause,
    );
    expect(agentToolFailure(error)).toMatchObject({
      code: "editor-not-ready",
      effect: "none",
      retryable: false,
      requiredAction: "wait-for-ready",
    });
  },
);

it("returns actionable non-mutating recovery while loading and permits a fresh read once ready", async () => {
  const f = setup();
  f.state.ready = false;
  await expect(
    f.tools
      .invoke("readDocument", { documentId: "doc" })
      .catch(agentToolFailure),
  ).resolves.toMatchObject({
    code: "editor-not-ready",
    effect: "none",
    requiredAction: "wait-for-ready",
  });
  expect(f.controller.readDocument).not.toHaveBeenCalled();
  f.state.ready = true;
  await expect(
    f.tools.invoke("readDocument", { documentId: "doc" }),
  ).resolves.toMatchObject({ text: "original" });
});

it.each([true, false])(
  "distinguishes failed initialization with retryable=%s",
  async (retryable) => {
    const f = setup();
    f.state.ready = false;
    f.state.initialization = {
      status: "failed",
      error: {
        code: "engine-initialization-timeout",
        message: "public failure",
        retryable,
      },
    };
    const error = await f.tools
      .invoke("readDocument", { documentId: "doc" })
      .then(
        () => null,
        (cause: unknown) => cause,
      );
    const failure = agentToolFailure(error);
    expect(failure).toMatchObject({
      code: "editor-initialization-failed",
      effect: "none",
      retryable: false,
      requiredAction: retryable
        ? "retry-initialization"
        : "inspect-initialization",
    });
    expect(failure).not.toHaveProperty("stack");
    expect(failure).not.toHaveProperty("cause");
    expect(f.controller.readDocument).not.toHaveBeenCalled();
  },
);

it("preserves a confirmed commit receipt when readiness drops after storage succeeds", async () => {
  const f = setup();
  vi.mocked(f.controller.commit!).mockImplementation(async () => {
    f.state.ready = false;
    return { version: "v2", savedRevision: "1" } as never;
  });
  const request = {
    documentId: "doc",
    expectedSessionId: "session",
    expectedRevision: "1",
    operationId: "save",
  };
  await expect(f.tools.invoke("commit", request)).resolves.toMatchObject({
    version: "v2",
  });
  await expect(f.tools.invoke("commit", request)).resolves.toMatchObject({
    version: "v2",
  });
  expect(f.controller.commit).toHaveBeenCalledOnce();
});

it("rejects a not-ready write before storage is invoked", async () => {
  const f = setup();
  f.state.ready = false;
  await expect(
    f.tools
      .invoke("commit", {
        documentId: "doc",
        expectedSessionId: "session",
        expectedRevision: "1",
        operationId: "blocked",
      })
      .catch(agentToolFailure),
  ).resolves.toMatchObject({ code: "editor-not-ready", effect: "none" });
  expect(f.controller.commit).not.toHaveBeenCalled();
});

it.each(["readiness", "revision"] as const)(
  "does not confirm an export if %s changes while its digest is pending",
  async (change) => {
    const f = setup();
    f.controller.exportDocument = vi.fn(async () => ({
      bytes: new Uint8Array([1]),
      format: "docx" as const,
      revision: "1",
      fileName: "sample.docx",
    }));
    let release!: () => void;
    const digest = vi.spyOn(crypto.subtle, "digest").mockImplementationOnce(
      () =>
        new Promise<ArrayBuffer>((resolve) => {
          release = () => resolve(new ArrayBuffer(32));
        }),
    );
    try {
      const result = f.bridge
        .inspect({ documentId: "doc" })
        .catch(agentToolFailure);
      await vi.waitFor(() => expect(release).toBeDefined());
      if (change === "readiness") f.state.ready = false;
      else f.state.revision = "2";
      release();
      await expect(result).resolves.toMatchObject({
        code:
          change === "readiness"
            ? "editor-not-ready"
            : "agent-context-mismatch",
        effect: "none",
      });
    } finally {
      digest.mockRestore();
    }
  },
);
