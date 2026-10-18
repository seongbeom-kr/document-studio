import { expect, it, vi } from "vitest";
import {
  createDocumentQuestionSession,
  type DocumentQuestionRequest,
} from "../../packages/core/src/document-question";
function fixture() {
  const state = {
    documentId: "doc",
    sessionId: "session",
    version: "v1",
    revision: "1",
    selectionKey: "range",
    ready: true,
  };
  const port = {
    state: () => ({ ...state }),
    capture: vi.fn(async () => ({
      revision: "1",
      selectionKey: "range",
      anchor: "paragraph:1",
      description: "첫 단락",
      text: "질문할 원문",
    })),
    clear: vi.fn(),
    send: vi.fn<(request: DocumentQuestionRequest) => Promise<void>>(
      async () => {},
    ),
  };
  return { state, port, questions: createDocumentQuestionSession(port) };
}
it("sends an immutable bounded target rather than a caller-edited context or engine snapshot", async () => {
  const f = fixture(),
    target = await f.questions.capture();
  target.text = "changed";
  await f.questions.send(target.targetId, "설명해 줘");
  expect(f.port.send).toHaveBeenCalledWith({
    question: "설명해 줘",
    target: expect.objectContaining({
      text: "질문할 원문",
      documentId: "doc",
      revision: "1",
    }),
  });
  expect(f.port.send.mock.calls[0]?.[0]).not.toHaveProperty("target.ready");
});
it.each([
  "documentId",
  "sessionId",
  "version",
  "revision",
  "selectionKey",
] as const)("rejects stale %s without sending the question", async (field) => {
  const f = fixture(),
    target = await f.questions.capture();
  f.state[field] = "changed";
  await expect(f.questions.send(target.targetId, "설명해 줘")).rejects.toThrow(
    "변경",
  );
  expect(f.port.send).not.toHaveBeenCalled();
});
it("retains the target after host failure and rejects concurrent submission/clear", async () => {
  const f = fixture(),
    target = await f.questions.capture();
  let reject!: (error: Error) => void;
  f.port.send.mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  const pending = f.questions.send(target.targetId, "질문");
  await expect(f.questions.send(target.targetId, "질문")).rejects.toThrow(
    "전송",
  );
  expect(() => f.questions.clear()).toThrow("전송");
  reject(new Error("offline"));
  await expect(pending).rejects.toThrow("offline");
  await f.questions.send(target.targetId, "질문");
  expect(f.port.send).toHaveBeenCalledTimes(2);
});
it("rejects a capture that crosses document replacement", async () => {
  const f = fixture();
  f.port.capture.mockImplementationOnce(async () => {
    f.state.documentId = "other";
    return {
      revision: "1",
      selectionKey: "range",
      anchor: "old",
      description: "old",
      text: "old text",
    };
  });
  await expect(f.questions.capture()).rejects.toThrow("변경");
  expect(f.questions.current()).toBeUndefined();
});
