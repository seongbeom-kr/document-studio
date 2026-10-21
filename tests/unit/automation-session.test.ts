import { afterEach, describe, expect, it, vi } from "vitest";
import { QUICK_ACTION_DRAFT_NAME } from "@document-studio/core";
import { AutomationSession } from "../../packages/react/src/automation-session";
import type {
  AutomationDraftState,
  AutomationDraftStore,
} from "../../packages/react/src/automation-drafts";
import { browserAutomationDraftStore } from "../../packages/react/src/automation-drafts";
import {
  AUTOMATION_FIELD_LIMIT,
  validateAutomationDraftState,
} from "../../packages/react/src/automation-validation";
const field = (input: string) => ({
  input,
  argument: "",
  transform: "trim" as const,
  delimiter: "auto",
});
function storage() {
  const data = new Map<string, AutomationDraftState>();
  const store: AutomationDraftStore = {
    get: vi.fn(async (key) => structuredClone(data.get(key))),
    put: vi.fn(async (key, value) => {
      data.set(key, structuredClone(value));
    }),
    delete: vi.fn(async (key) => {
      data.delete(key);
    }),
  };
  return { data, store };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("separate automation input drafts", () => {
  it("keeps quick-action input/settings in the document's draft policy and retains failed writes", async () => {
    const { store } = storage();
    const draft = {
      ...field("보관할 원고"),
      argument: JSON.stringify({
        baseDate: "2026-10-21",
        week: "calendar",
        format: "iso",
        timeZone: "Asia/Seoul",
      }),
    };
    const session = new AutomationSession({ store, key: "owner/doc-a" });
    await session.start();
    session.put(QUICK_ACTION_DRAFT_NAME, draft, { activate: false });
    expect(session.utility).toBe("금액 한글화");
    vi.mocked(store.put).mockRejectedValueOnce(new Error("quota"));
    await expect(session.flush()).rejects.toThrow("quota");
    expect(session.get(QUICK_ACTION_DRAFT_NAME)).toEqual(draft);
    expect(session.getSnapshot()).toMatchObject({ pending: true });
    await session.flush();
    session.dispose();
    const reopened = new AutomationSession({ store, key: "owner/doc-a" });
    const other = new AutomationSession({ store, key: "owner/doc-b" });
    await reopened.start();
    await other.start();
    expect(reopened.get(QUICK_ACTION_DRAFT_NAME)).toEqual(draft);
    expect(other.get(QUICK_ACTION_DRAFT_NAME).input).toBe("");
    reopened.dispose();
    other.dispose();
  });
  it.each(["input", "argument"] as const)(
    "round trips the exact limit for %s and preserves the last valid record on overflow",
    async (fieldName) => {
      const { store, data } = storage();
      const session = new AutomationSession({ store, key: "A" });
      await session.start();
      session.put("금액 한글화", field("other tool"));
      const atLimit = {
        ...field("원본"),
        [fieldName]: "가".repeat(AUTOMATION_FIELD_LIMIT),
      };
      session.put("마크다운 보고서", atLimit);
      await session.flush();
      const valid = structuredClone(data.get("A"));
      const excessive = { ...atLimit, [fieldName]: atLimit[fieldName] + "a" };
      session.put("마크다운 보고서", excessive);
      expect(session.getSnapshot()).toMatchObject({
        ready: true,
        pending: true,
        error: expect.stringContaining("1,000,001"),
      });
      expect(session.get("마크다운 보고서")[fieldName]).toHaveLength(
        AUTOMATION_FIELD_LIMIT + 1,
      );
      await expect(session.flush()).rejects.toThrow("1,000,001");
      expect(store.put).toHaveBeenCalledTimes(1);
      expect(data.get("A")).toEqual(valid);
      const reopened = new AutomationSession({ store, key: "A" });
      await reopened.start();
      expect(reopened.get("마크다운 보고서")[fieldName]).toBe(
        atLimit[fieldName],
      );
      expect(reopened.get("금액 한글화").input).toBe("other tool");
      session.put("마크다운 보고서", field("corrected"));
      await session.flush();
      expect(session.getSnapshot()).toMatchObject({
        pending: false,
        error: "",
      });
      expect(data.get("A")!.drafts["금액 한글화"]!.input).toBe("other tool");
      session.dispose();
      reopened.dispose();
    },
  );
  it("uses UTF-16 length consistently for emoji at the boundary", async () => {
    const { store } = storage();
    const session = new AutomationSession({ store, key: "A" });
    await session.start();
    session.put(
      "마크다운 보고서",
      field("😀".repeat(AUTOMATION_FIELD_LIMIT / 2)),
    );
    await session.flush();
    session.put(
      "마크다운 보고서",
      field("😀".repeat(AUTOMATION_FIELD_LIMIT / 2) + "x"),
    );
    await expect(session.flush()).rejects.toThrow("1,000,001");
    expect(store.put).toHaveBeenCalledTimes(1);
    session.dispose();
  });
  it("does not write an invalid value queued after an earlier valid write", async () => {
    const { data, store } = storage();
    const gate = deferred();
    vi.mocked(store.put).mockImplementationOnce(async (key, state) => {
      await gate.promise;
      data.set(key, state);
    });
    const session = new AutomationSession({ store, key: "A" });
    await session.start();
    session.put("마크다운 보고서", field("valid"));
    const flushing = session.flush();
    void flushing.catch(() => undefined);
    await vi.waitFor(() => expect(store.put).toHaveBeenCalledTimes(1));
    session.put(
      "마크다운 보고서",
      field("x".repeat(AUTOMATION_FIELD_LIMIT + 1)),
    );
    gate.resolve();
    await expect(flushing).rejects.toThrow("1,000,001");
    expect(data.get("A")!.drafts["마크다운 보고서"]!.input).toBe("valid");
    expect(session.getSnapshot()).toMatchObject({
      pending: true,
      error: expect.stringContaining("1,000,001"),
    });
    session.dispose();
  });
  it("preserves and explicitly repairs a legacy oversized record without losing other tools", async () => {
    const { data, store } = storage();
    const legacy: AutomationDraftState = {
      version: 1,
      utility: "마크다운 보고서",
      drafts: {
        "마크다운 보고서": field("x".repeat(AUTOMATION_FIELD_LIMIT + 1)),
        "금액 한글화": field("2345"),
      },
    };
    data.set("A", structuredClone(legacy));
    const session = new AutomationSession({ store, key: "A" });
    await expect(session.start()).rejects.toThrow("1,000,001");
    expect(session.canRepair()).toBe(true);
    expect(session.recoveryData()).toEqual(legacy);
    session.repairStoredDraft();
    expect(session.getSnapshot()).toMatchObject({ ready: true, pending: true });
    expect(session.get("금액 한글화").input).toBe("2345");
    expect(session.get("마크다운 보고서").input).toHaveLength(
      AUTOMATION_FIELD_LIMIT + 1,
    );
    await expect(session.flush()).rejects.toThrow("1,000,001");
    expect(store.put).not.toHaveBeenCalled();
    expect(data.get("A")).toEqual(legacy);
    session.put("마크다운 보고서", field("edited safely"));
    await session.flush();
    session.dispose();
    const restored = new AutomationSession({ store, key: "A" });
    await restored.start();
    expect(restored.get("금액 한글화").input).toBe("2345");
    expect(restored.get("마크다운 보고서").input).toBe("edited safely");
    restored.dispose();
  });
  it("validates browser adapter writes before opening or replacing IndexedDB data", async () => {
    const open = vi.fn();
    vi.stubGlobal("indexedDB", { open });
    const invalid: AutomationDraftState = {
      version: 1,
      utility: "마크다운 보고서",
      drafts: {
        "마크다운 보고서": field("x".repeat(AUTOMATION_FIELD_LIMIT + 1)),
      },
    };
    await expect(
      browserAutomationDraftStore().put("A", invalid),
    ).rejects.toThrow("1,000,001");
    expect(open).not.toHaveBeenCalled();
  });
  it.each([
    null,
    [],
    { version: 2, utility: "금액 한글화", drafts: {} },
    { version: 1, utility: "금액 한글화", drafts: [] },
    {
      version: 1,
      utility: "금액 한글화",
      drafts: { "금액 한글화": { ...field("x"), delimiter: "invalid" } },
    },
  ])("rejects malformed records with the shared validator: %j", (value) => {
    expect(() => validateAutomationDraftState(value)).toThrow("올바르지");
  });
  it("round trips multiple tools and options, scoped by owner/workspace/document", async () => {
    const { store } = storage();
    const first = new AutomationSession({ store, key: "alice/work/A" });
    await first.start();
    first.put("마크다운 보고서", field("# 직접 쓴 보고서"));
    first.put("표 데이터 정리", {
      ...field("1\t2"),
      transform: "multiply",
      argument: "7",
      delimiter: "\t",
    });
    await first.flush();
    first.dispose();
    const restored = new AutomationSession({ store, key: "alice/work/A" });
    await restored.start();
    expect(restored.utility).toBe("표 데이터 정리");
    expect(restored.get("마크다운 보고서").input).toBe("# 직접 쓴 보고서");
    expect(restored.get("표 데이터 정리")).toMatchObject({
      argument: "7",
      delimiter: "\t",
      transform: "multiply",
    });
    const other = new AutomationSession({ store, key: "bob/work/A" });
    await other.start();
    expect(other.get("마크다운 보고서").input).not.toBe("# 직접 쓴 보고서");
    expect(restored.getSnapshot()).toMatchObject({
      ready: true,
      pending: false,
      storage: "local",
    });
    restored.dispose();
    other.dispose();
  });
  it("debounces writes and cancels a pending write on disposal", async () => {
    vi.useFakeTimers();
    const { store } = storage();
    const session = new AutomationSession({ store, key: "A" });
    await session.start();
    session.put("금액 한글화", field("123"));
    session.put("금액 한글화", field("456"));
    await vi.advanceTimersByTimeAsync(249);
    expect(store.put).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(store.put).toHaveBeenCalledTimes(1);
    session.put("금액 한글화", field("789"));
    session.dispose();
    await vi.advanceTimersByTimeAsync(500);
    expect(store.put).toHaveBeenCalledTimes(1);
  });
  it("keeps failed writes pending and retries without discarding input", async () => {
    const { store } = storage();
    vi.mocked(store.put).mockRejectedValueOnce(new Error("quota"));
    const session = new AutomationSession({ store, key: "A" });
    await session.start();
    session.put("금액 한글화", field("123"));
    await expect(session.flush()).rejects.toThrow("quota");
    expect(session.getSnapshot()).toMatchObject({
      pending: true,
      error: expect.stringContaining("quota"),
    });
    expect(session.get("금액 한글화").input).toBe("123");
    await session.flush();
    expect(session.getSnapshot()).toMatchObject({ pending: false, error: "" });
    session.dispose();
  });
  it("serializes overlapping writes and flushes edits made during the first write", async () => {
    const { store, data } = storage();
    const gate = deferred();
    vi.mocked(store.put).mockImplementationOnce(async (key, state) => {
      await gate.promise;
      data.set(key, structuredClone(state));
    });
    const session = new AutomationSession({ store, key: "A" });
    await session.start();
    session.put("금액 한글화", field("first"));
    const first = session.flush();
    await vi.waitFor(() => expect(store.put).toHaveBeenCalledTimes(1));
    session.put("금액 한글화", field("latest"));
    const second = session.flush();
    gate.resolve();
    await Promise.all([first, second]);
    expect(data.get("A")!.drafts["금액 한글화"]!.input).toBe("latest");
    expect(store.put).toHaveBeenCalledTimes(2);
    expect(session.getSnapshot().pending).toBe(false);
    session.dispose();
  });
  it("rejects corrupt stored input without overwriting it, and explicitly discards it", async () => {
    const { data, store } = storage();
    data.set("A", {
      version: 1,
      utility: "금액 한글화",
      drafts: {
        "금액 한글화": { ...field("corrupt"), transform: "unknown" as never },
      },
    });
    const session = new AutomationSession({ store, key: "A" });
    await expect(session.start()).rejects.toThrow("올바르지");
    await expect(session.flush()).rejects.toThrow();
    expect(store.put).not.toHaveBeenCalled();
    expect(data.get("A")!.drafts["금액 한글화"]!.input).toBe("corrupt");
    await session.discardStoredDraft();
    expect(store.delete).toHaveBeenCalledWith("A");
    expect(session.getSnapshot().ready).toBe(true);
    session.dispose();
  });
  it("ignores a stale load after effect cleanup and restart", async () => {
    const { store } = storage();
    const gate = deferred();
    vi.mocked(store.get).mockImplementationOnce(async () => {
      await gate.promise;
      return {
        version: 1,
        utility: "금액 한글화",
        drafts: { "금액 한글화": field("stale") },
      };
    });
    const session = new AutomationSession({ store, key: "A" });
    const stale = session.start();
    session.dispose();
    await session.start();
    session.put("금액 한글화", field("current"));
    gate.resolve();
    await stale;
    expect(session.get("금액 한글화").input).toBe("current");
    await session.flush();
    session.dispose();
  });
  it("does not persist in memory-only mode and reports pending inputs for close protection", async () => {
    const session = new AutomationSession();
    await session.start();
    session.put("금액 한글화", field("123"));
    await session.flush();
    expect(session.getSnapshot()).toMatchObject({
      storage: "memory",
      pending: true,
    });
    session.dispose();
  });
});
