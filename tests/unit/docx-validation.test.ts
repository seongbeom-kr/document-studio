import { readFileSync } from "node:fs";
import { unzipSync, zipSync, strToU8 } from "fflate";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());
async function validate(bytes: Uint8Array) {
  const postMessage = vi.fn();
  const worker: {
    postMessage: typeof postMessage;
    onmessage?: (event: { data: { bytes: Uint8Array } }) => void;
  } = { postMessage };
  vi.stubGlobal("self", worker);
  vi.resetModules();
  await import("../../packages/engine-docx/src/validation-worker");
  worker.onmessage!({ data: { bytes } });
  return postMessage.mock.calls[0]?.[0];
}
it("accepts a real DOCX fixture through the packaged validation parser", async () => {
  expect(
    await validate(new Uint8Array(readFileSync("fixtures/sample.docx"))),
  ).toEqual({ ok: true });
});
it("rejects invalid source bytes before attempting a document parse", async () => {
  expect(await validate(new Uint8Array([99]))).toMatchObject({
    error: expect.stringContaining("ZIP"),
  });
});
it("rejects a valid ZIP container whose DOCX main XML is malformed", async () => {
  const files = unzipSync(new Uint8Array(readFileSync("fixtures/sample.docx")));
  files["word/document.xml"] = strToU8("<broken");
  expect(await validate(zipSync(files))).toMatchObject({
    error: expect.stringContaining("DOCX"),
  });
});
