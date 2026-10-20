import { describe, it, expect, vi, afterEach } from "vitest";
import { zipSync, Zip, ZipDeflate, strToU8 } from "fflate";
import {
  captureExportSnapshot,
  validateSaveResult,
  validateDocumentArchive,
  runValidationWorker,
  SaveConflictError,
} from "@document-studio/core";

const required = {
  "Contents/header.xml": strToU8("<head/>"),
  "Contents/section0.xml": strToU8("<section/>"),
};
function entries(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  const end = bytes.length - 22;
  let offset = view.getUint32(end + 16, true);
  const result: { central: number; local: number; name: string }[] = [];
  while (offset < end) {
    const len = view.getUint16(offset + 28, true);
    result.push({
      central: offset,
      local: view.getUint32(offset + 42, true),
      name: new TextDecoder().decode(
        bytes.subarray(offset + 46, offset + 46 + len),
      ),
    });
    offset +=
      46 +
      len +
      view.getUint16(offset + 30, true) +
      view.getUint16(offset + 32, true);
  }
  return result;
}
describe("actual archive extraction boundaries", () => {
  it("rejects the 65 MiB review exploit with matching forged local and central sizes", () => {
    const bytes = zipSync(
      {
        ...required,
        "Contents/section0.xml": new Uint8Array(65 * 1024 * 1024).fill(32),
      },
      { level: 9 },
    );
    expect(bytes.length).toBeLessThan(100000);
    const view = new DataView(bytes.buffer);
    const entry = entries(bytes).find(
      (e) => e.name === "Contents/section0.xml",
    )!;
    view.setUint32(entry.local + 22, 1, true);
    view.setUint32(entry.central + 24, 1, true);
    expect(() => validateDocumentArchive(bytes, "hwpx")).toThrow(/크기/);
  });
  it.each([0, 8])(
    "checks actual CRC for method %s even if both checksums are forged",
    (level) => {
      const bytes = zipSync(required, { level: level === 0 ? 0 : 6 });
      const view = new DataView(bytes.buffer);
      const entry = entries(bytes)[0]!;
      view.setUint32(entry.local + 14, 123, true);
      view.setUint32(entry.central + 16, 123, true);
      expect(() => validateDocumentArchive(bytes, "hwpx")).toThrow();
    },
  );
  it("accepts streaming descriptors and rejects a forged descriptor size", () => {
    const chunks: Uint8Array[] = [];
    const zip = new Zip((error, chunk) => {
      if (error) throw error;
      chunks.push(chunk);
    });
    for (const [name, data] of Object.entries(required)) {
      const entry = new ZipDeflate(name);
      zip.add(entry);
      entry.push(data, true);
    }
    zip.end();
    const bytes = new Uint8Array(
      chunks.reduce((sum, chunk) => sum + chunk.length, 0),
    );
    let at = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, at);
      at += chunk.length;
    }
    expect(() => validateDocumentArchive(bytes, "hwpx")).not.toThrow();
    const view = new DataView(bytes.buffer);
    const entry = entries(bytes)[0]!;
    const data =
      entry.local +
      30 +
      view.getUint16(entry.local + 26, true) +
      view.getUint16(entry.local + 28, true);
    const descriptor = data + view.getUint32(entry.central + 20, true);
    view.setUint32(descriptor + 12, 0, true);
    expect(() => validateDocumentArchive(bytes, "hwpx")).toThrow();
  });
});
describe("confirmed save contract", () => {
  it.each([
    null,
    {},
    { version: undefined },
    { version: "" },
    { version: "\n" },
    { version: 3 },
  ])("rejects invalid committed version %j", (result) =>
    expect(() => validateSaveResult(result)).toThrow(),
  );
  it("keeps a valid commit and reports malformed warning metadata separately", () => {
    expect(
      validateSaveResult({ version: "v2", warnings: [null] }),
    ).toMatchObject({
      version: "v2",
      warnings: [{ code: "storage-warning-invalid" }],
    });
  });
});
describe.each(["docx", "hwpx"] as const)(
  "%s serialization revision",
  (format) => {
    it("rejects edits during asynchronous serialization", async () => {
      let revision = "1";
      let complete!: (bytes: Uint8Array) => void;
      const pending = captureExportSnapshot(
        format,
        () => revision,
        () =>
          new Promise((resolve) => {
            complete = resolve;
          }),
        () => undefined,
      );
      revision = "2";
      complete(new Uint8Array([1]));
      await expect(pending).rejects.toBeInstanceOf(SaveConflictError);
    });
    it("returns the bytes and their captured revision", async () => {
      expect(
        await captureExportSnapshot(
          format,
          () => "5",
          async () => new Uint8Array([5]),
          () => undefined,
        ),
      ).toEqual({ format, revision: "5", bytes: new Uint8Array([5]) });
    });
  },
);
describe("validation worker lifetime", () => {
  afterEach(() => vi.useRealTimers());
  function worker() {
    return {
      terminate: vi.fn(),
      postMessage: vi.fn(),
      onmessage: null,
      onerror: null,
    } as unknown as Worker;
  }
  it("releases success only after the terminated worker's task has completed", async () => {
    vi.useFakeTimers();
    const w = worker();
    const ready = vi.fn();
    const pending = runValidationWorker(w, { bytes: new Uint8Array([1]) }).then(
      ready,
    );
    w.onmessage!.call(w, new MessageEvent("message", { data: { ok: true } }));
    await Promise.resolve();
    expect(w.terminate).toHaveBeenCalledOnce();
    expect(w.onmessage).toBeNull();
    expect(ready).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);
    await pending;
    expect(ready).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("aborting the successful-worker handoff cannot open an old document", async () => {
    vi.useFakeTimers();
    const w = worker(),
      abort = new AbortController();
    const pending = runValidationWorker(
      w,
      { bytes: new Uint8Array([1]) },
      abort.signal,
    );
    const rejected = expect(pending).rejects.toMatchObject({
      name: "AbortError",
    });
    w.onmessage!.call(w, new MessageEvent("message", { data: { ok: true } }));
    abort.abort();
    await rejected;
    await vi.advanceTimersByTimeAsync(0);
    expect(w.terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("rejects an oversized input before cloning or transferring it", async () => {
    const w = worker();
    await expect(
      runValidationWorker(w, { bytes: new Uint8Array(33 * 1024 * 1024) }),
    ).rejects.toThrow("크기");
    expect(w.postMessage).not.toHaveBeenCalled();
    expect(w.terminate).toHaveBeenCalledOnce();
  });
  it("terminates and rejects an aborted worker without detaching the original bytes", async () => {
    const w = worker(),
      abort = new AbortController(),
      bytes = new Uint8Array([1]);
    const pending = runValidationWorker(w, { bytes }, abort.signal);
    abort.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(w.terminate).toHaveBeenCalledOnce();
    expect(bytes[0]).toBe(1);
  });
  it("cleans up when message transfer fails", async () => {
    const w = worker();
    vi.mocked(w.postMessage).mockImplementation(() => {
      throw new Error("transfer failed");
    });
    await expect(
      runValidationWorker(w, { bytes: new Uint8Array([1]) }),
    ).rejects.toThrow("transfer failed");
    expect(w.terminate).toHaveBeenCalledOnce();
  });
  it("terminates a stalled worker", async () => {
    vi.useFakeTimers();
    const w = worker();
    const result = runValidationWorker(w, { bytes: new Uint8Array([1]) }).catch(
      (e) => e,
    );
    await vi.advanceTimersByTimeAsync(15000);
    expect(await result).toBeInstanceOf(Error);
    expect(w.terminate).toHaveBeenCalledOnce();
  });
});
