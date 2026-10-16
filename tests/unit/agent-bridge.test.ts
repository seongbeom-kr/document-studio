import { describe, expect, it, vi } from "vitest";
import { createAgentBridge } from "@document-studio/core";
import { createAgentBridge as legacyAgentBridge } from "../../packages/react/src/agent-bridge";
import type { DocumentEditorHandle } from "../../packages/react/src/document-editor";
import type { EditorSnapshot } from "@document-studio/core";
function fixture() {
  let documentId = "first-document";
  let sessionId = "session-1";
  let version = "v1";
  const snapshot: EditorSnapshot = {
    ready: true,
    selectionKey: "range-1",
    revision: "7",
    dirty: false,
    pageCount: 1,
    zoom: 1,
    commands: { lineSpacing: { supported: true, enabled: true } },
  };
  const execute = vi.fn(async () => {
    snapshot.revision = "8";
    snapshot.dirty = true;
  });
  const handle: DocumentEditorHandle = {
    getState: () => ({
      ...snapshot,
      documentId,
      format: "docx",
      sessionId,
      version,
      automationDraft: {
        ready: true,
        pending: false,
        storage: "memory",
        error: "",
      },
    }),
    execute,
    exportDocument: vi.fn(),
    flushDraft: vi.fn(),
    flushAutomationDraft: vi.fn(),
    readDocument: vi.fn(),
    search: vi.fn(),
    selectMatch: vi.fn(),
    replace: vi.fn(),
    applyPreset: vi.fn(),
    save: vi.fn(),
    acquireInputLock: vi.fn(async () => async () => {}),
  };
  return {
    agent: createAgentBridge(() => handle),
    execute,
    handle,
    snapshot,
    reload: (nextVersion = version) => {
      sessionId = `next:${sessionId}`;
      version = nextVersion;
    },
    switchDocument: () => {
      documentId = "second-document";
    },
  };
}

describe("agent automation workflow", () => {
  function setup() {
    const test = fixture();
    test.snapshot.commands.insertText = { supported: true, enabled: true };
    return test;
  }
  function target(
    test: ReturnType<typeof setup>,
    previewId: string,
    operationId = "automation-1",
  ) {
    const state = test.agent.getState();
    return {
      documentId: state.documentId,
      expectedSessionId: state.sessionId,
      expectedVersion: state.version,
      expectedRevision: state.revision,
      expectedSelectionKey: state.selectionKey!,
      previewId,
      operationId,
      mode: "text" as const,
    };
  }
  function preview(test: ReturnType<typeof setup>) {
    return test.agent.previewAutomation({
      documentId: "first-document",
      automation: { actionId: "amount-korean", input: "12340" },
    });
  }
  it("previews without mutation, applies with guards, and replays the receipt without a second insertion", async () => {
    const test = setup(),
      result = preview(test);
    expect(result.changed).toBe(false);
    expect(test.execute).not.toHaveBeenCalled();
    const request = target(test, result.previewId);
    const first = await test.agent.applyAutomation(request);
    expect(first).toMatchObject({
      applied: true,
      committed: false,
      dirty: true,
      revision: "8",
    });
    expect(test.execute).toHaveBeenCalledWith(
      { id: "insertText", value: "금12,340원(금일만이천삼백사십원)" },
      { expectedRevision: "7", expectedSelectionKey: "range-1" },
    );
    expect(await test.agent.applyAutomation(request)).toEqual(first);
    expect(test.execute).toHaveBeenCalledTimes(1);
    expect(test.handle.save).not.toHaveBeenCalled();
  });
  it("rejects stale preview, selection, session, mode and readonly targets", async () => {
    const test = setup(),
      result = preview(test),
      request = target(test, result.previewId);
    await expect(
      test.agent.applyAutomation({ ...request, mode: "image" } as never),
    ).rejects.toThrow("text 모드");
    await expect(
      test.agent.applyAutomation({ ...request, expectedSelectionKey: "old" }),
    ).rejects.toThrow("선택");
    test.snapshot.commands.insertText = {
      supported: true,
      enabled: false,
      reason: "읽기 전용",
    };
    await expect(test.agent.applyAutomation(request)).rejects.toThrow(
      "읽기 전용",
    );
    test.snapshot.commands.insertText.enabled = true;
    test.snapshot.revision = "8";
    await expect(
      test.agent.applyAutomation({ ...request, expectedRevision: "8" }),
    ).rejects.toThrow("미리보기 이후");
    test.reload();
    await expect(test.agent.applyAutomation(request)).rejects.toThrow("세션");
    expect(test.execute).not.toHaveBeenCalled();
  });
  it("does not reroll a random preview or accept a mutated caller-owned result", async () => {
    const test = setup();
    const result = test.agent.previewAutomation({
      documentId: "first-document",
      automation: {
        actionId: "draw-names",
        input: "가\n나\n다",
        argument: "2",
      },
    });
    const text = result.text;
    result.text = "forged replacement";
    await test.agent.applyAutomation(target(test, result.previewId));
    expect(test.execute).toHaveBeenCalledWith(
      { id: "insertText", value: text },
      expect.any(Object),
    );
  });
  it("retains an uncertain native failure so the same operation cannot duplicate a write", async () => {
    const test = setup(),
      result = preview(test),
      request = target(test, result.previewId);
    test.execute.mockImplementation(async () => {
      test.snapshot.revision = "8";
      throw new Error("Native response lost after mutation");
    });
    await expect(test.agent.applyAutomation(request)).rejects.toMatchObject({
      effect: "unknown",
      retryable: false,
    });
    await expect(test.agent.applyAutomation(request)).rejects.toMatchObject({
      effect: "unknown",
      retryable: false,
    });
    expect(test.execute).toHaveBeenCalledTimes(1);
  });
  it("rejects reuse of an operation ID with a different request", async () => {
    const test = setup(),
      result = preview(test),
      request = target(test, result.previewId);
    await test.agent.applyAutomation(request);
    await expect(
      test.agent.applyAutomation({ ...request, previewId: "different" }),
    ).rejects.toThrow("다른 요청");
  });
  it("expires bounded previews explicitly instead of applying an unknown result", async () => {
    const test = setup(),
      old = preview(test);
    for (let i = 0; i < 16; i++) preview(test);
    await expect(
      test.agent.applyAutomation(target(test, old.previewId)),
    ).rejects.toThrow("만료");
    expect(test.execute).not.toHaveBeenCalled();
  });
  it("generates a structured file without claiming it was saved, and rejects a changed source during generation", async () => {
    const test = setup();
    const createDocument = vi.fn(async (template) => ({
      id: "generated",
      fileName: template.fileName,
      bytes: new Uint8Array([1, 2, 3]),
      format: "docx" as const,
    }));
    const agent = createAgentBridge(() => test.handle, { createDocument });
    const result = agent.previewAutomation({
      documentId: "first-document",
      automation: {
        actionId: "markdown-report",
        input: "# 보고\n\n| 항목 | 결과 |\n|---|---|\n| 하나 | 둘 |",
      },
    });
    const request = {
      ...target(test, result.previewId),
      fileName: "보고.docx",
    };
    const created = await agent.createAutomationDocument(request);
    expect(created).toMatchObject({
      created: true,
      committed: false,
      document: { fileName: "보고.docx" },
    });
    expect(
      createDocument.mock.calls[0]?.[0].blocks.some(
        (block: { kind: string }) => block.kind === "table",
      ),
    ).toBe(true);
    expect(test.execute).not.toHaveBeenCalled();
    expect(test.handle.save).not.toHaveBeenCalled();
    createDocument.mockImplementation(async (template) => {
      test.reload();
      return {
        id: "late",
        fileName: template.fileName,
        bytes: new Uint8Array([1]),
        format: "docx",
      };
    });
    await expect(agent.createAutomationDocument(request)).rejects.toThrow(
      "편집 세션",
    );
  });
});
describe("agent document targeting", () => {
  it("keeps the React export compatible with the framework-neutral core bridge", () => {
    expect(legacyAgentBridge).toBe(createAgentBridge);
    expect(fixture().agent.getState().documentId).toBe("first-document");
  });
  it("exposes initialization failure and retries only the matching failed session", () => {
    const test = fixture();
    test.snapshot.ready = false;
    test.snapshot.initialization = {
      status: "failed",
      error: {
        code: "engine-initialization-timeout",
        message: "연결 시간 초과",
        retryable: true,
      },
    };
    test.handle.retryInitialization = vi.fn();
    const state = test.agent.getState();
    expect(state.initialization?.status).toBe("failed");
    const request = {
      documentId: state.documentId,
      expectedSessionId: state.sessionId,
      expectedVersion: state.version,
    };
    expect(() =>
      test.agent.retryInitialization({
        ...request,
        expectedSessionId: "old-session",
      }),
    ).toThrow("세션");
    expect(() =>
      test.agent.retryInitialization({ ...request, documentId: "other" }),
    ).toThrow("문서");
    expect(() =>
      test.agent.retryInitialization({
        ...request,
        expectedVersion: "old-version",
      }),
    ).toThrow("버전");
    expect(() =>
      test.agent.retryInitialization({ ...request, expectedSessionId: "" }),
    ).toThrow("expectedSessionId");
    expect(test.handle.retryInitialization).not.toHaveBeenCalled();
    test.agent.retryInitialization(request);
    expect(test.handle.retryInitialization).toHaveBeenCalledTimes(1);
  });
  it("does not retry a ready, pending, non-retryable or unsupported initialization", () => {
    const test = fixture();
    test.handle.retryInitialization = vi.fn();
    const state = test.agent.getState();
    const request = {
      documentId: state.documentId,
      expectedSessionId: state.sessionId,
    };
    for (const initialization of [
      { status: "ready" },
      { status: "loading", phase: "connecting" },
      {
        status: "failed",
        error: {
          code: "engine-initialization-failed",
          message: "invalid source",
          retryable: false,
        },
      },
    ] as const) {
      test.snapshot.initialization = initialization;
      expect(() => test.agent.retryInitialization(request)).toThrow(
        "재시도 가능한",
      );
    }
    test.snapshot.initialization = {
      status: "failed",
      error: {
        code: "engine-initialization-failed",
        message: "failed",
        retryable: true,
      },
    };
    test.handle.retryInitialization = undefined;
    expect(() => test.agent.retryInitialization(request)).toThrow(
      "재시도 가능한",
    );
  });
  it("reports a native selection without a complete guard as unavailable to agent commands", () => {
    const test = fixture();
    test.snapshot.selectionGuardedCommands = false;
    expect(
      test.agent.listCommands().find((command) => command.id === "lineSpacing"),
    ).toMatchObject({ enabled: false });
  });
  it("rejects range drift independently of content revision and requires a range token", async () => {
    const test = fixture(),
      state = test.agent.getState();
    test.snapshot.selectionKey = "range-2";
    const target = {
      documentId: state.documentId,
      expectedSessionId: state.sessionId,
      expectedRevision: state.revision,
    };
    await expect(
      test.agent.execute({
        ...target,
        expectedSelectionKey: state.selectionKey!,
        command: { id: "insertText", value: "wrong" },
      }),
    ).rejects.toMatchObject({ code: "selection-conflict", retryable: true });
    await expect(
      test.agent.execute({ ...target, command: { id: "bold" } } as never),
    ).rejects.toThrow("expectedSelectionKey");
    expect(test.execute).not.toHaveBeenCalled();
  });
  it("replays one commit receipt without uploading again and rejects operation ID reuse", async () => {
    const test = fixture(),
      s = test.agent.getState();
    test.handle.commit = vi.fn(async () => ({
      documentId: s.documentId,
      sessionId: s.sessionId,
      version: "v2",
      format: "docx",
      fileName: "test.docx",
      digest: "sha256:proof",
      savedRevision: "7",
      destination: "storage" as const,
      warnings: [],
      automationDraft: s.automationDraft,
    }));
    const request = {
      documentId: s.documentId,
      expectedSessionId: s.sessionId,
      expectedRevision: s.revision,
      operationId: "task:1",
    };
    const first = await test.agent.commit(request);
    first.version = "caller-modified";
    expect((await test.agent.commit(request)).version).toBe("v2");
    expect(test.handle.commit).toHaveBeenCalledTimes(1);
    await expect(
      test.agent.commit({ ...request, expectedRevision: "8" }),
    ).rejects.toThrow("operationId");
  });
  it("retains save failure as retryable and never invents a commit receipt", async () => {
    const test = fixture(),
      s = test.agent.getState();
    test.handle.commit = vi.fn(async () => {
      throw new Error("storage unavailable");
    });
    const request = {
      documentId: s.documentId,
      expectedSessionId: s.sessionId,
      expectedRevision: s.revision,
      operationId: "retry:1",
    };
    await expect(test.agent.commit(request)).rejects.toThrow(
      "storage unavailable",
    );
    await expect(test.agent.commit(request)).rejects.toThrow(
      "storage unavailable",
    );
    expect(test.handle.commit).toHaveBeenCalledTimes(2);
  });
  it("provides isolated function-specific automation contracts to agents", () => {
    const agent = fixture().agent,
      forms = agent.listAutomationForms();
    expect(forms).toHaveLength(20);
    expect(forms.find((f) => f.name === "만 나이")?.argument?.label).toBe(
      "나이 계산 기준일",
    );
    forms[0]!.example = "changed by host";
    expect(agent.listAutomationForms()[0]!.example).toBe("12340");
  });
  it("rejects an old target even when two documents have the same local revision", async () => {
    const test = fixture();
    const before = test.agent.getState();
    test.switchDocument();
    await expect(
      test.agent.execute({
        documentId: before.documentId,
        expectedRevision: before.revision,
        expectedSelectionKey: before.selectionKey!,
        expectedSessionId: before.sessionId,
        command: { id: "lineSpacing", value: 1.6 },
      }),
    ).rejects.toThrow("대상 문서");
    expect(test.execute).not.toHaveBeenCalled();
  });
  it("returns the target and revision after a successful edit", async () => {
    const test = fixture();
    const before = test.agent.getState();
    const receipt = await test.agent.execute({
      documentId: before.documentId,
      expectedRevision: before.revision,
      expectedSelectionKey: before.selectionKey!,
      expectedSessionId: before.sessionId,
      command: { id: "lineSpacing", value: 1.6 },
    });
    expect(test.execute).toHaveBeenCalledWith(
      { id: "lineSpacing", value: 1.6 },
      { expectedRevision: "7", expectedSelectionKey: "range-1" },
    );
    expect(receipt).toEqual({
      applied: true,
      documentId: before.documentId,
      revision: "8",
      sessionId: "session-1",
      version: "v1",
      dirty: true,
    });
  });
  it.each([
    { documentId: undefined, expectedRevision: "7" },
    { documentId: "first-document", expectedRevision: undefined },
  ])(
    "rejects a transport request with missing target or revision: %j",
    async (input) => {
      const test = fixture();
      await expect(
        test.agent.execute({
          ...input,
          command: { id: "bold" },
        } as unknown as Parameters<typeof test.agent.execute>[0]),
      ).rejects.toThrow("필요합니다");
      expect(test.execute).not.toHaveBeenCalled();
    },
  );
});

describe("agent session boundaries", () => {
  it.each(["v1", "v2"])(
    "rejects a same-ID/revision reload of version %s",
    async (version) => {
      const test = fixture(),
        before = test.agent.getState();
      test.reload(version);
      await expect(
        test.agent.execute({
          documentId: before.documentId,
          expectedSessionId: before.sessionId,
          expectedRevision: before.revision,
          expectedSelectionKey: before.selectionKey!,
          command: { id: "bold" },
        }),
      ).rejects.toThrow("세션");
      expect(test.execute).not.toHaveBeenCalled();
    },
  );
  it("requires the session identity on mutations, even after a newer state was read", async () => {
    const test = fixture(),
      before = test.agent.getState();
    test.reload();
    test.agent.getState();
    await expect(
      test.agent.execute({
        documentId: before.documentId,
        expectedRevision: before.revision,
        expectedSelectionKey: before.selectionKey!,
        command: { id: "bold" },
      } as Parameters<typeof test.agent.execute>[0]),
    ).rejects.toThrow("expectedSessionId");
    expect(test.execute).not.toHaveBeenCalled();
  });
  it("validates an explicitly supplied stored version", async () => {
    const test = fixture(),
      before = test.agent.getState();
    await expect(
      test.agent.execute({
        documentId: before.documentId,
        expectedSessionId: before.sessionId,
        expectedRevision: before.revision,
        expectedSelectionKey: before.selectionKey!,
        expectedVersion: "old",
        command: { id: "bold" },
      }),
    ).rejects.toThrow("버전");
    expect(test.execute).not.toHaveBeenCalled();
  });
  it.each([
    "readDocument",
    "search",
    "execute",
    "replace",
    "select",
    "applyPreset",
  ] as const)(
    "refuses to report success if %s completes after a reload",
    async (operation) => {
      const test = fixture(),
        before = test.agent.getState();
      const pending = vi.fn(async () => {
        test.reload();
        return { revision: before.revision, count: 1 };
      });
      if (operation === "select") test.handle.selectMatch = pending as never;
      else test.handle[operation] = pending as never;
      const target = {
        documentId: before.documentId,
        expectedSessionId: before.sessionId,
        expectedRevision: before.revision,
      };
      let promise: Promise<unknown>;
      switch (operation) {
        case "readDocument":
          promise = test.agent.readDocument(target);
          break;
        case "search":
          promise = test.agent.search({ ...target, query: "text" });
          break;
        case "execute":
          promise = test.agent.execute({
            ...target,
            expectedSelectionKey: "range-1",
            command: { id: "bold" },
          });
          break;
        case "replace":
          promise = test.agent.replace({
            ...target,
            query: "text",
            replacement: "new",
            all: true,
          });
          break;
        case "select":
          promise = test.agent.select({ ...target, matchId: "m1" });
          break;
        case "applyPreset":
          promise = test.agent.applyPreset({
            ...target,
            expectedSelectionKey: "range-1",
            preset: {
              id: "p",
              name: "p",
              description: "p",
              commands: [{ id: "bold" }],
            },
          });
          break;
      }
      await expect(promise).rejects.toThrow("세션");
    },
  );
});
