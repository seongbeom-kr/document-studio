/** CSS pixels in the host viewport; presentation only, never an edit target. */
export interface QuestionRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export interface EngineQuestionTarget {
  revision: string;
  selectionKey: string;
  anchor: string;
  text: string;
  description: string;
}
export interface DocumentQuestionTarget extends EngineQuestionTarget {
  targetId: string;
  documentId: string;
  sessionId: string;
  version?: string;
}
export interface DocumentQuestionRequest {
  question: string;
  target: DocumentQuestionTarget;
}

/** Question context is immutable and bound to the current document/range, never just screen pixels. */
export function createDocumentQuestionSession(port: {
  state(): {
    documentId: string;
    sessionId: string;
    version?: string;
    revision: string;
    selectionKey?: string;
    ready: boolean;
  };
  capture(): Promise<EngineQuestionTarget>;
  clear(): void;
  send(request: DocumentQuestionRequest): Promise<void>;
}) {
  let target: DocumentQuestionTarget | undefined;
  let sending = false;
  const assertCurrent = (value: DocumentQuestionTarget) => {
    const state = port.state();
    if (
      !state.ready ||
      state.documentId !== value.documentId ||
      state.sessionId !== value.sessionId ||
      state.version !== value.version ||
      state.revision !== value.revision ||
      state.selectionKey !== value.selectionKey
    )
      throw new Error(
        "문서 또는 질문 대상이 변경됐습니다. 영역을 다시 지정해 주세요.",
      );
  };
  return {
    async capture() {
      if (sending) throw new Error("질문을 전송하고 있습니다.");
      const before = port.state();
      if (!before.ready) throw new Error("문서를 준비하는 중입니다.");
      const value = await port.capture();
      if (
        !value.text.trim() ||
        value.text.length > 8000 ||
        !value.anchor ||
        !value.selectionKey
      )
        throw new Error(
          "질문할 텍스트를 지정해 주세요. 선택 영역은 8,000자까지 지원합니다.",
        );
      const captured: DocumentQuestionTarget = {
        targetId: crypto.randomUUID(),
        documentId: before.documentId,
        sessionId: before.sessionId,
        version: before.version,
        revision: value.revision,
        selectionKey: value.selectionKey,
        anchor: value.anchor,
        description: value.description,
        text: value.text,
      };
      assertCurrent(captured);
      target = structuredClone(captured);
      return structuredClone(target);
    },
    async send(targetId: string, question: string) {
      if (sending) throw new Error("질문을 전송하고 있습니다.");
      if (
        !target ||
        target.targetId !== targetId ||
        typeof question !== "string" ||
        !question.trim() ||
        question.length > 4000
      )
        throw new Error("질문 대상과 질문 내용을 확인해 주세요.");
      assertCurrent(target);
      sending = true;
      try {
        await port.send({
          question: question.trim(),
          target: structuredClone(target),
        });
      } finally {
        sending = false;
      }
    },
    clear() {
      if (sending) throw new Error("질문을 전송하고 있습니다.");
      target = undefined;
      port.clear();
    },
    current: () => target && structuredClone(target),
  };
}
