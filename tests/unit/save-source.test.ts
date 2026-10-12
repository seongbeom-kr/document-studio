import { describe, expect, it } from "vitest";
import {
  matchesSavedSource,
  type SavedSource,
} from "../../packages/react/src/save-source";
import type { EditorDocument } from "@document-studio/core";

const saved: SavedSource = {
  documentId: "report",
  format: "hwpx",
  version: "digest",
  sessionId: "session",
  scope: "user-A",
  bytes: new Uint8Array([1, 2, 3]),
};
const source: EditorDocument = {
  id: "report",
  format: "hwpx",
  fileName: "report.hwpx",
  version: "digest",
  bytes: new Uint8Array([1, 2, 3]),
};
describe("confirmed own save", () => {
  it("accepts an equal fresh buffer at the same digest", () => {
    expect(source.bytes).not.toBe(saved.bytes);
    expect(matchesSavedSource(saved, source, "session", "user-A")).toBe(true);
  });
  it.each([
    { bytes: new Uint8Array([1, 2, 4]) },
    { bytes: new Uint8Array([1, 2]) },
    { id: "other" },
    { format: "docx" as const },
    { version: "other" },
  ])("rejects an unapproved source %j", (change) => {
    expect(
      matchesSavedSource(saved, { ...source, ...change }, "session", "user-A"),
    ).toBe(false);
  });
  it("rejects a different session, user scope and missing receipt", () => {
    expect(matchesSavedSource(saved, source, "next-session", "user-A")).toBe(
      false,
    );
    expect(matchesSavedSource(saved, source, "session", "user-B")).toBe(false);
    expect(matchesSavedSource(null, source, "session", "user-A")).toBe(false);
  });
});
