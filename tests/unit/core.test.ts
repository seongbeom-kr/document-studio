import { describe, expect, it } from "vitest";
import {
  detectFormat,
  draftKey,
  RevisionState,
  SessionStore,
  validateCommand,
  type EditorCommand,
} from "../../packages/core/src/index";
describe("revision acknowledgement", () => {
  it("keeps edits made after an exported revision dirty", () => {
    const state = new RevisionState("1");
    state.acknowledge("2");
    expect(state.dirty("2")).toBe(false);
    expect(state.dirty("3")).toBe(true);
  });
  it("does not mark an unsaved recovery snapshot clean on import", () => {
    const state = new RevisionState("1", true);
    expect(state.dirty("1")).toBe(true);
    state.acknowledge("1");
    expect(state.dirty("1")).toBe(false);
  });
  it("preserves dirty state when no save was acknowledged", () => {
    const state = new RevisionState("1");
    expect(state.dirty("2")).toBe(true);
  });
});
describe("file and draft identity", () => {
  it.each([
    ["example.DOCX", "docx"],
    ["한글 문서.hwpx", "hwpx"],
    ["한글 원본.HWP", "hwp"],
  ])("recognizes %s", (name, expected) =>
    expect(detectFormat(name)).toBe(expected),
  );
  it.each(["sample.xlsx", "sample.exe", "sample", "sample.docx.exe"])(
    "rejects unsupported %s",
    (name) => expect(() => detectFormat(name)).toThrow(),
  );
  it("separates namespaces even when ids contain delimiters", () => {
    expect(draftKey("user:a", "b")).not.toBe(draftKey("user", "a:b"));
    expect(draftKey("user-a", "same-file")).not.toBe(
      draftKey("user-b", "same-file"),
    );
  });
});
describe("session subscriptions", () => {
  it("notifies on actual state changes and releases subscriptions", () => {
    const store = new SessionStore();
    let calls = 0;
    const off = store.subscribe(() => calls++);
    store.update({ ...store.getSnapshot(), ready: true });
    store.update({ ...store.getSnapshot() });
    expect(calls).toBe(1);
    off();
    store.update({ ...store.getSnapshot(), dirty: true });
    expect(calls).toBe(1);
  });
});
describe("public agent input validation", () => {
  it.each([
    { id: "lineSpacing", value: 0 },
    { id: "lineSpacing", value: 6 },
    { id: "lineSpacing", value: NaN },
    { id: "fontSize", value: 0 },
    { id: "fontSize", value: 201 },
    { id: "fontSize", value: Infinity },
    { id: "zoom", value: 0.1 },
    { id: "zoom", value: 4 },
    { id: "fontFamily", value: "" },
    { id: "fontFamily", value: " ".repeat(2) },
    { id: "fontFamily", value: "a".repeat(129) },
    { id: "deleteEverything" },
  ])("rejects invalid command %j", (command) =>
    expect(() => validateCommand(command as EditorCommand)).toThrow(),
  );
  it.each([
    { id: "fontSize", value: 1 },
    { id: "fontSize", value: 200 },
    { id: "fontSize", value: 12.5 },
    { id: "lineSpacing", value: 0.5 },
    { id: "lineSpacing", value: 5 },
    { id: "fontFamily", value: "맑은 고딕" },
    { id: "zoom", value: 0.25 },
    { id: "zoom", value: 3 },
  ])("accepts supported boundary command %j", (command) =>
    expect(() => validateCommand(command as EditorCommand)).not.toThrow(),
  );
});
