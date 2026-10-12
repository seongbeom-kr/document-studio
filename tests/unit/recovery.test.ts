import { describe, it, expect, vi } from "vitest";
import { resolveRecovery } from "../../packages/react/src/recovery";
import type {
  EditorDocument,
  DocumentDraft,
  DraftStore,
} from "@document-studio/core";
const source: EditorDocument = {
  id: "B",
  format: "docx",
  fileName: "B.docx",
  bytes: new Uint8Array([1]),
  version: "v1",
};
const draft: DocumentDraft = {
  key: "key",
  format: "docx",
  fileName: "B.docx",
  bytes: new Uint8Array([2]),
  baseVersion: "v1",
  updatedAt: 1,
};
const store = (get: DraftStore["get"]): DraftStore => ({
  get,
  put: vi.fn(),
  delete: vi.fn(),
});
describe("recovery resolution before mounting a document", () => {
  it("offers an existing draft without writing or deleting it", async () => {
    const storage = store(async () => draft),
      validate = vi.fn().mockResolvedValue(undefined);
    expect(
      await resolveRecovery(
        source,
        storage,
        "key",
        validate,
        new AbortController().signal,
      ),
    ).toEqual({ kind: "draft", draft });
    expect(validate).toHaveBeenCalledWith(
      { ...source, bytes: draft.bytes },
      expect.any(AbortSignal),
    );
    expect(storage.put).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
  });
  it("returns a discardable corrupt draft and preserves the valid source", async () => {
    const storage = store(async () => draft);
    expect(
      await resolveRecovery(
        source,
        storage,
        "key",
        async () => {
          throw new Error("broken");
        },
        new AbortController().signal,
      ),
    ).toMatchObject({ kind: "corrupt", draft });
    expect(source.bytes[0]).toBe(1);
    expect(storage.delete).not.toHaveBeenCalled();
  });
  it.each([
    { ...draft, key: "other" },
    { ...draft, format: "hwpx" as const },
  ])("does not silently overwrite a mismatched recovery entry", async (bad) => {
    expect(
      await resolveRecovery(
        source,
        store(async () => bad),
        "key",
        async () => {},
        new AbortController().signal,
      ),
    ).toMatchObject({ kind: "corrupt", draft: bad });
  });
  it("refuses to authorize an unread recovery key when its store is unavailable", async () => {
    await expect(
      resolveRecovery(
        source,
        store(async () => {
          throw new Error("offline");
        }),
        "key",
        async () => {},
        new AbortController().signal,
      ),
    ).rejects.toThrow("offline");
  });
  it("does not access a disabled store", async () => {
    const validate = vi.fn();
    expect(
      await resolveRecovery(
        source,
        null,
        "key",
        validate,
        new AbortController().signal,
      ),
    ).toEqual({ kind: "source" });
    expect(validate).not.toHaveBeenCalled();
  });
  it("ignores a delayed result from a cancelled initialization", async () => {
    const abort = new AbortController();
    let complete!: (d: DocumentDraft) => void;
    const pending = resolveRecovery(
      source,
      store(
        () =>
          new Promise((resolve) => {
            complete = resolve;
          }),
      ),
      "key",
      async () => {},
      abort.signal,
    );
    await Promise.resolve();
    abort.abort();
    complete(draft);
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
