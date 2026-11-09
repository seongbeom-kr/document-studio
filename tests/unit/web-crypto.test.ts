import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  randomId,
  sha256,
  sha256Fallback,
  sha256Hex,
} from "../../packages/core/src/web-crypto";

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
const native = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

describe("web crypto helpers outside secure contexts", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("matches native SHA-256 across padding boundaries and large inputs", () => {
    const samples = [
      0,
      1,
      3,
      55,
      56,
      57,
      63,
      64,
      65,
      119,
      120,
      128,
      1000,
      3 * 1024 * 1024 + 7,
    ].map((size) =>
      Uint8Array.from({ length: size }, (_, i) => (i * 31 + size) & 0xff),
    );
    samples.push(new TextEncoder().encode("abc"));
    for (const bytes of samples)
      expect(hex(sha256Fallback(bytes))).toBe(native(bytes));
    expect(hex(sha256Fallback(new TextEncoder().encode("abc")))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("uses the fallback when crypto.subtle and randomUUID are missing (plain http)", async () => {
    const getRandomValues = globalThis.crypto.getRandomValues.bind(
      globalThis.crypto,
    );
    vi.stubGlobal("crypto", { getRandomValues });
    const bytes = new TextEncoder().encode("문서 편집기");
    expect(await sha256Hex(bytes)).toBe(native(bytes));
    expect(hex(await sha256(bytes))).toBe(native(bytes));
    const ids = new Set(Array.from({ length: 200 }, () => randomId()));
    expect(ids.size).toBe(200);
    for (const id of ids)
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
  });

  it("prefers native APIs when they exist", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    expect(await sha256Hex(bytes)).toBe(native(bytes));
    expect(randomId()).toMatch(/^[0-9a-f-]{36}$/);
  });
});
