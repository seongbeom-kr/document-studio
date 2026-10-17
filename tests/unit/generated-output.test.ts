import { describe, expect, it } from "vitest";
import {
  GeneratedOutputLedger,
  GeneratedOutputPendingError,
  type MailMergeReceipt,
} from "../../packages/core/src/index";

const batch = (operationId = "one"): MailMergeReceipt => ({
  documentId: "doc",
  sessionId: "session",
  operationId,
  previewId: "preview",
  committed: false,
  files: [
    {
      id: "a",
      fileName: "A.docx",
      format: "docx",
      digest: "sha256:aaa",
      byteLength: 100,
    },
    {
      id: "b",
      fileName: "B.docx",
      format: "docx",
      digest: "sha256:bbb",
      byteLength: 100,
    },
  ],
});
describe("generated output delivery ledger", () => {
  it("blocks replacement and closing even after bytes/download are requested", () => {
    const ledger = new GeneratedOutputLedger();
    ledger.retain(batch());
    ledger.noteDownload("one");
    expect(() => ledger.assertSettled()).toThrow(GeneratedOutputPendingError);
    expect(() => ledger.retain(batch("two"))).toThrow(
      GeneratedOutputPendingError,
    );
    expect(() => ledger.reset()).toThrow(GeneratedOutputPendingError);
    expect(ledger.pending()?.receipt.files).toHaveLength(2);
  });
  it("confirms only matching delivered files, and requires explicit user confirmation after download", () => {
    const ledger = new GeneratedOutputLedger();
    ledger.retain(batch());
    expect(() =>
      ledger.acknowledge("one", [
        { id: "a", digest: "sha256:aaa", destination: "download-confirmed" },
      ]),
    ).toThrow();
    ledger.acknowledge("one", [
      { id: "a", digest: "sha256:aaa", destination: "storage", version: "v1" },
    ]);
    expect(ledger.pending()?.receipt.files.map((f) => f.id)).toEqual(["b"]);
    ledger.noteDownload("one");
    ledger.acknowledge("one", [
      { id: "b", digest: "sha256:bbb", destination: "download-confirmed" },
    ]);
    expect(() => ledger.assertSettled()).not.toThrow();
    ledger.retain(batch("two"));
    expect(() => ledger.discard("one")).toThrow();
    ledger.discard("two");
    expect(ledger.pending()).toBeUndefined();
  });
  it("validates the entire delivery receipt before changing any pending state", () => {
    const ledger = new GeneratedOutputLedger();
    ledger.retain(batch());
    for (const second of [
      { id: "b", digest: "wrong", destination: "storage", version: "v1" },
      { id: "b", digest: "sha256:bbb", destination: "storage", version: "" },
      { id: "a", digest: "sha256:aaa", destination: "storage", version: "v1" },
    ]) {
      expect(() =>
        ledger.acknowledge("one", [
          {
            id: "a",
            digest: "sha256:aaa",
            destination: "storage",
            version: "v1",
          },
          second as any,
        ]),
      ).toThrow();
      expect(ledger.pending()?.receipt.files).toHaveLength(2);
    }
  });
  it("does not trust callers' mutations of retained metadata or pending state", () => {
    const ledger = new GeneratedOutputLedger(),
      value = batch();
    ledger.retain(value);
    (value.files[0] as { digest: string }).digest = "changed";
    (ledger.pending()!.receipt.files as unknown[]).length = 0;
    expect(ledger.pending()?.receipt.files[0]?.digest).toBe("sha256:aaa");
    expect(ledger.pending()?.receipt.files).toHaveLength(2);
  });
});
