import { describe, it, expect, vi } from "vitest";
import {
  officeDateText,
  officeClock,
  quickActionPlan,
  createQuickActionEditor,
  REPORT_PRESETS,
  createAgentBridge,
  type OfficeDateRequest,
  type EditorController,
  type EditorCommand,
  QuickActionError,
} from "../../packages/core/src/index";
const request: OfficeDateRequest = {
  kind: "date",
  baseDate: "2026-10-16",
  period: "today",
  week: "workweek",
  format: "official",
};
describe("office quick dates", () => {
  it.each([
    ["today", "2026. 10. 16.(금)"],
    ["yesterday", "2026. 10. 15.(목)"],
    ["tomorrow", "2026. 10. 17.(토)"],
    ["thisWeek", "2026. 10. 12.(월) ~ 2026. 10. 16.(금)"],
    ["nextWeek", "2026. 10. 19.(월) ~ 2026. 10. 23.(금)"],
    ["thisMonth", "2026. 10. 1.(목) ~ 2026. 10. 31.(토)"],
    ["nextMonth", "2026. 11. 1.(일) ~ 2026. 11. 30.(월)"],
    ["thisYear", "2026. 1. 1.(목) ~ 2026. 12. 31.(목)"],
    ["nextYear", "2027. 1. 1.(금) ~ 2027. 12. 31.(금)"],
  ] as const)("calculates %s from an explicit base date", (period, text) =>
    expect(officeDateText({ ...request, period })).toBe(text),
  );
  it("distinguishes working week from calendar week at a year boundary", () => {
    expect(
      officeDateText({
        ...request,
        baseDate: "2026-12-31",
        period: "nextWeek",
        week: "calendar",
        format: "iso",
      }),
    ).toBe("2027-01-04 ~ 2027-01-10");
    expect(
      officeDateText({
        ...request,
        baseDate: "2024-02-15",
        period: "thisMonth",
        format: "compact",
      }),
    ).toBe("20240201 ~ 20240229");
  });
  it("resolves the calendar date in the chosen time zone once", () => {
    const now = new Date("2026-10-15T16:00:00Z");
    expect(officeClock("Asia/Seoul", now).baseDate).toBe("2026-10-16");
    expect(officeClock("UTC", now).baseDate).toBe("2026-10-15");
    expect(() => officeClock("Not/AZone", now)).toThrow();
  });
  it.each([
    { baseDate: "2026-02-29" },
    { baseDate: "1900-01-01", period: "yesterday" },
    { baseDate: "9999-12-31", period: "tomorrow" },
    { period: "unknown" },
    { week: "weekend" },
    { format: "bad" },
    { baseDate: "20261016" },
    { extra: true },
  ])("rejects invalid or overflowing calendar input %j", (patch) =>
    expect(() =>
      officeDateText({ ...request, ...patch } as OfficeDateRequest),
    ).toThrow(),
  );
});
function setup() {
  const state = {
    documentId: "a",
    sessionId: "session",
    revision: "1",
    selectionKey: "range",
    atomicPresets: true,
    atomicTextInsertion: true,
    ready: true,
    format: "docx",
    dirty: false,
    zoom: 1,
    pageCount: 1,
    commands: {},
    automationDraft: {
      ready: true,
      pending: false,
      storage: "memory" as const,
      error: "",
    },
  };
  const apply = vi.fn(async (_commands: readonly EditorCommand[]) => {
    state.revision = "2";
  });
  const actions = createQuickActionEditor({
    state: () => ({ ...state }),
    presets: () => REPORT_PRESETS,
    apply,
  });
  const editor = {
    getState: () => ({ ...state }),
    listQuickActions: actions.list,
    previewQuickAction: actions.preview,
    applyQuickAction: actions.apply,
  } as unknown as EditorController;
  return { state, apply, actions, agent: createAgentBridge(() => editor) };
}
describe("guarded quick actions", () => {
  it("does not suggest undo when a preset leaves the document unchanged", async () => {
    const f = setup();
    f.apply.mockImplementation(async () => {});
    const p = f.actions.preview({
      kind: "preset",
      presetId: REPORT_PRESETS[0]!.id,
    });
    expect(
      await f.actions.apply({ previewId: p.previewId, operationId: "noop" }),
    ).toMatchObject({ undoSteps: 0, committed: false });
  });
  it("reports unknown effects if the session changes after the edit completes", async () => {
    const f = setup();
    f.apply.mockImplementation(async () => {
      f.state.sessionId = "replaced";
    });
    const p = f.actions.preview(request);
    await expect(
      f.actions.apply({ previewId: p.previewId, operationId: "post-edit" }),
    ).rejects.toMatchObject({ effect: "unknown" });
  });
  it("uses immutable preview commands and one replayable write", async () => {
    const f = setup(),
      p = f.actions.preview(request);
    (p.commands[0] as { value: string }).value = "tampered";
    const input = { previewId: p.previewId, operationId: "one" };
    const [a, b] = await Promise.all([
      f.actions.apply(input),
      f.actions.apply(input),
    ]);
    expect(a).toEqual(b);
    expect(f.apply).toHaveBeenCalledOnce();
    expect(f.apply.mock.calls[0]?.[0]).toEqual([
      { id: "insertText", value: "2026. 10. 16.(금)" },
    ]);
    expect(a).toMatchObject({ undoSteps: 1, committed: false });
  });
  it.each(["documentId", "sessionId", "revision", "selectionKey"] as const)(
    "blocks stale %s",
    async (key) => {
      const f = setup(),
        p = f.actions.preview(request);
      f.state[key] = "other";
      await expect(
        f.actions.apply({ previewId: p.previewId, operationId: "one" }),
      ).rejects.toThrow();
      expect(f.apply).not.toHaveBeenCalled();
    },
  );
  it("requires atomic presets and validates host-provided commands", () => {
    const f = setup();
    f.state.atomicPresets = false;
    expect(() =>
      f.actions.preview({ kind: "preset", presetId: "report-body" }),
    ).toThrow(/한 번/);
    expect(() =>
      quickActionPlan({ kind: "preset", presetId: "invalid" }),
    ).toThrow();
    expect(() =>
      quickActionPlan({ kind: "preset", presetId: "bad" }, [
        {
          id: "bad",
          name: "Bad",
          description: "",
          commands: [{ id: "fontSize", value: -3 }],
        },
      ]),
    ).toThrow();
  });
  it("never repeats a failed mutation even with a new operation ID", async () => {
    const f = setup(),
      p = f.actions.preview(request);
    f.apply.mockRejectedValue(new Error("lost"));
    const input = { previewId: p.previewId, operationId: "one" };
    await expect(f.actions.apply(input)).rejects.toBeInstanceOf(
      QuickActionError,
    );
    await expect(f.actions.apply(input)).rejects.toMatchObject({
      effect: "unknown",
    });
    await expect(
      f.actions.apply({ ...input, operationId: "two" }),
    ).rejects.toThrow(/만료/);
    expect(f.apply).toHaveBeenCalledOnce();
  });
  it("agent validates supplied guards and returns the shared receipt after revision advances", async () => {
    const f = setup(),
      p = f.agent.previewQuickAction({ documentId: "a", action: request }),
      input = {
        documentId: "a",
        expectedSessionId: "session",
        expectedRevision: "1",
        expectedSelectionKey: "range",
        previewId: p.previewId,
        operationId: "agent",
      };
    await expect(
      f.agent.applyQuickAction({ ...input, expectedRevision: "wrong" }),
    ).rejects.toThrow();
    expect(f.apply).not.toHaveBeenCalled();
    const a = await f.agent.applyQuickAction(input);
    expect(await f.agent.applyQuickAction(input)).toEqual(a);
    await expect(
      f.agent.applyQuickAction({ ...input, expectedSelectionKey: "changed" }),
    ).rejects.toThrow(/ID/);
    expect(f.apply).toHaveBeenCalledOnce();
  });
});
