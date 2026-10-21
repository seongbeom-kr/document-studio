import { expect, it } from "vitest";
import {
  agentToolFailure,
  SearchResultExpiredError,
  SelectionConflictError,
  quickActionPlan,
  createAgentBridge,
  createAgentSessionTools,
  QuickActionError,
  type EditorController,
} from "@document-studio/core";
it("retains search expiry and distinguishes pre-write selection rejection from uncertain effects", () => {
  expect(agentToolFailure(new SearchResultExpiredError())).toMatchObject({
    code: "search-result-expired",
    effect: "none",
    requiredAction: "search-again",
  });
  expect(agentToolFailure(new SelectionConflictError("none"))).toMatchObject({
    code: "selection-conflict",
    effect: "none",
    requiredAction: "confirm-selection",
  });
  expect(agentToolFailure(new SelectionConflictError())).toMatchObject({
    code: "selection-conflict",
    effect: "unknown",
    requiredAction: "inspect-result-or-undo",
  });
  expect(
    agentToolFailure(new QuickActionError("failed", "unknown")),
  ).toMatchObject({ effect: "unknown" });
});
it("reports invalid calendar preview as non-mutating input recovery, through public contextual tools", async () => {
  const state = {
    documentId: "d",
    sessionId: "s",
    version: "v",
    revision: "0",
    selectionKey: "range",
    ready: true,
    commands: {},
  };
  const tools = createAgentSessionTools(
    createAgentBridge(
      () =>
        ({
          getState: () => state,
          previewQuickAction: quickActionPlan,
        }) as unknown as EditorController,
    ),
  );
  const { context } = await tools.invoke("getState", {});
  try {
    await tools.invoke("previewQuickAction", {
      contextRef: context!.contextRef,
      action: {
        kind: "date",
        baseDate: "2026-02-30",
        period: "today",
        week: "calendar",
        format: "iso",
      },
    });
    throw new Error("expected invalid date");
  } catch (error) {
    const failure = agentToolFailure(error);
    expect(failure).toMatchObject({
      code: "invalid-quick-action-input",
      effect: "none",
      requiredAction: "correct-input",
    });
    expect(failure).not.toHaveProperty("cause");
    expect(failure).not.toHaveProperty("stack");
  }
});
it("never classifies arbitrary TypeError or a partial write as a safe retry", () => {
  expect(agentToolFailure(new TypeError("private"))).toMatchObject({
    effect: "unknown",
  });
  expect(
    JSON.stringify(agentToolFailure(new TypeError("private"))),
  ).not.toContain("private");
});
