import { expect, it, vi } from "vitest";
import {
  createAgentBridge,
  createAgentToolset,
  TableEditError,
  TableReadError,
} from "@document-studio/core";
import type { EditorController } from "@document-studio/core";
function fixture() {
  const state = {
    documentId: "doc",
    sessionId: "session",
    revision: "1",
    ready: true,
    dirty: false,
    commands: { bold: { enabled: true } },
    selectionKey: "range",
    format: "docx",
  };
  const controller = {
    getState: () => state,
    search: vi.fn(async () => ({
      revision: "1",
      matches: [],
      total: 0,
      truncated: false,
    })),
    readTable: vi.fn(),
    previewTableColumn: vi.fn(async () => ({ previewId: "preview" })),
    commit: vi.fn(async () => ({ version: "v2" })),
  } as unknown as EditorController;
  return {
    state,
    controller,
    tools: createAgentToolset(createAgentBridge(() => controller)),
  };
}
it("exposes independent schemas and compact state without formatting catalogues", async () => {
  const f = fixture();
  const tools = f.tools.list();
  expect(
    tools.find((t) => t.name === "getState")!.inputSchema.properties,
  ).toEqual({});
  tools[0]!.inputSchema.additionalProperties = true;
  expect(f.tools.list()[0]!.inputSchema.additionalProperties).toBe(false);
  const state = await f.tools.invoke("getState", {});
  expect(state).toMatchObject({
    documentId: "doc",
    sessionId: "session",
    revision: "1",
  });
  expect(state).not.toHaveProperty("commands");
});
it.each([
  ["getState", { documentId: "doc" }],
  ["search", { documentId: "doc", query: "value", expectedRevision: "1" }],
  ["search", { documentId: "doc", query: "value", maxResults: 501 }],
  ["commit", { documentId: "doc", expectedRevision: "1", operationId: "save" }],
  ["unknown", {}],
  ["getState", null],
] as const)(
  "rejects wrong %s arguments without invoking document operations",
  async (method, input) => {
    const f = fixture();
    await expect(f.tools.invoke(method, input)).rejects.toMatchObject({
      code: "invalid-arguments",
      effect: "none",
      requiredAction: "correct-arguments",
    });
    expect(f.controller.search).not.toHaveBeenCalled();
    expect(f.controller.commit).not.toHaveBeenCalled();
  },
);
it("validates nested table operations and retains document/session guards", async () => {
  const f = fixture();
  await expect(
    f.tools.invoke("previewTableColumn", {
      documentId: "doc",
      columnRequest: {
        column: 2,
        columnKind: "number",
        headerRows: 1,
        operation: { kind: "commas" },
      },
    }),
  ).resolves.toEqual({ previewId: "preview" });
  await expect(
    f.tools.invoke("previewTableColumn", {
      documentId: "doc",
      columnRequest: {
        column: 2,
        columnKind: "number",
        headerRows: 1,
        operation: { kind: "commas", extra: "x" },
      },
    }),
  ).rejects.toMatchObject({ code: "invalid-arguments" });
  await expect(
    f.tools.invoke("commit", {
      documentId: "doc",
      expectedSessionId: "old",
      expectedRevision: "1",
      operationId: "save",
    }),
  ).rejects.toThrow("세션");
  expect(f.controller.commit).not.toHaveBeenCalled();
});
it("passes known table read errors with an actionable effect-none contract", async () => {
  const f = fixture();
  vi.mocked(f.controller.readTable!).mockRejectedValue(
    new TableReadError("표 셀을 선택해 주세요.", "table-cell-required"),
  );
  await expect(
    f.tools.invoke("readTable", { documentId: "doc" }),
  ).rejects.toMatchObject({
    code: "table-cell-required",
    effect: "none",
    requiredAction: "select-table-cell",
    retryable: false,
  });
  expect(
    new TableReadError("nested", "table-structure-unsupported"),
  ).toBeInstanceOf(TableEditError);
});
