import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it, vi, afterEach } from "vitest";
import {
  bundledFontFamily,
  fontClass,
  fontReport,
  loadDocumentFontPack,
  DOCUMENT_STUDIO_FONT_PACK as pack,
} from "../../packages/core/src/fonts";
import { verifyFontAssets } from "../../scripts/font-assets.mjs";

afterEach(() => vi.unstubAllGlobals());
const bytes = async (file: string) =>
  new Uint8Array(
    await readFile(
      new URL(`../../packages/core/assets/fonts/${file}`, import.meta.url),
    ),
  );

describe("portable font pack", () => {
  it("all four real faces cover Hanja, Korean, bullets and report symbols", async () => {
    for (const face of pack.faces) {
      const data = await bytes(face.file);
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      let cmap = 0;
      for (let i = 0; i < view.getUint16(4); i++) {
        const offset = 12 + i * 16;
        if (String.fromCharCode(...data.slice(offset, offset + 4)) === "cmap")
          cmap = view.getUint32(offset + 8);
      }
      const tables = Array.from(
        { length: view.getUint16(cmap + 2) },
        (_, i) => cmap + view.getUint32(cmap + 4 + i * 8 + 4),
      );
      const hasGlyph = (code: number) =>
        tables.some((table) => {
          const format = view.getUint16(table);
          if (format === 12) {
            for (let i = 0; i < view.getUint32(table + 12); i++) {
              const group = table + 16 + i * 12;
              if (
                code >= view.getUint32(group) &&
                code <= view.getUint32(group + 4)
              )
                return (
                  view.getUint32(group + 8) + code - view.getUint32(group) !== 0
                );
            }
          }
          if (format === 4 && code <= 0xffff) {
            const count = view.getUint16(table + 6) / 2;
            for (let i = 0; i < count; i++) {
              const end = view.getUint16(table + 14 + i * 2);
              const start = view.getUint16(table + 16 + count * 2 + i * 2);
              if (code < start || code > end) continue;
              const delta = view.getInt16(table + 16 + count * 4 + i * 2);
              const address = table + 16 + count * 6 + i * 2;
              const range = view.getUint16(address);
              const glyph = range
                ? view.getUint16(address + range + (code - start) * 2)
                : code;
              return glyph !== 0 && ((glyph + delta) & 0xffff) !== 0;
            }
          }
          return false;
        });
      for (const character of "가힣한글漢字■▪□○─①ⅠΩ")
        expect(
          hasGlyph(character.codePointAt(0)!),
          `${face.file}: ${character}`,
        ).toBe(true);
    }
  });
  it("ships the audited files, copyright notices and immutable runtime manifest", async () => {
    const verified = await verifyFontAssets();
    expect(verified.id).toBe(pack.id);
    expect(pack.faces.map((face) => [face.family, face.weight])).toEqual([
      ["Noto Sans KR", 400],
      ["Noto Sans KR", 700],
      ["Noto Serif KR", 400],
      ["Noto Serif KR", 700],
    ]);
  });
  it.each([
    "휴먼명조",
    "한양신명조",
    "함초롬바탕",
    "KoPub바탕체 Light",
    "Times New Roman",
  ])("preserves serif classification for %s", (name) => {
    expect(bundledFontFamily(name)).toBe("Noto Serif KR");
  });
  it.each([
    "HY헤드라인M",
    "한양중고딕",
    "맑은 고딕",
    "KoPub돋움체 Medium",
    "함초롬돋움",
  ])("preserves sans classification for %s", (name) => {
    expect(bundledFontFamily(name)).toBe("Noto Sans KR");
  });
  it("does not confuse a known name with an installed font or silently promise symbol/mono fidelity", () => {
    expect(fontClass("sans-serif")).toBe("sans");
    const names = ["휴먼명조", "Wingdings", "Consolas"];
    const report = fontReport(names);
    expect(names).toEqual(["휴먼명조", "Wingdings", "Consolas"]);
    expect(report.families[0]).toMatchObject({
      requested: "휴먼명조",
      resolved: "Noto Serif KR",
      status: "substituted",
    });
    expect(report.families[1]).toMatchObject({
      status: "missing",
      reason: "symbol-font-not-bundled",
    });
    expect(report.families[2]?.reason).toBe("monospace-font-not-bundled");
    expect(report.glyphCoverage).toBe("not-assessed");
    expect(fontClass("굴림체")).toBe("monospace");
  });
  it("prefers an explicitly supplied original and bounds agent diagnostics", () => {
    const report = fontReport(
      ["휴먼명조", ...Array.from({ length: 100 }, (_, i) => `font ${i}`)],
      [],
      new Map([["휴먼명조", { family: "휴먼명조", source: "provided" }]]),
    );
    expect(report.families[0]).toMatchObject({
      resolved: "휴먼명조",
      status: "available",
      source: "provided",
    });
    expect(report.families).toHaveLength(64);
    expect(report.truncated).toBe(true);
  });
  it("loads local fixed filenames and verifies the actual bytes", async () => {
    const requested: string[] = [];
    vi.stubGlobal("fetch", async (url: URL) => {
      requested.push(String(url));
      return new Response(await bytes(url.pathname.split("/").at(-1)!));
    });
    const faces = await loadDocumentFontPack("http://localhost:4173/a/fonts");
    expect(faces).toHaveLength(4);
    expect(
      requested.every((url) =>
        url.startsWith("http://localhost:4173/a/fonts/Noto"),
      ),
    ).toBe(true);
    expect(createHash("sha256").update(faces[0]!.data).digest("hex")).toBe(
      pack.faces[0]!.sha256,
    );
  });
  it("rejects a changed font with a forged matching Content-Length", async () => {
    vi.stubGlobal("fetch", async (url: URL) => {
      const data = await bytes(url.pathname.split("/").at(-1)!);
      data[128] = data[128]! ^ 1;
      return new Response(data, {
        headers: { "Content-Length": String(data.length) },
      });
    });
    await expect(
      loadDocumentFontPack("http://localhost/fonts/"),
    ).rejects.toThrow("해시");
  });
  it("bounds the actual stream even when the header understates its length", async () => {
    vi.stubGlobal("fetch", async (url: URL) => {
      const face = pack.faces.find((face) => url.pathname.endsWith(face.file))!;
      return new Response(new Uint8Array(face.bytes + 1), {
        headers: { "Content-Length": "1" },
      });
    });
    await expect(
      loadDocumentFontPack("http://localhost/fonts/"),
    ).rejects.toThrow("크기");
  });
  it("reports inaccessible assets and forbids a file or data URL", async () => {
    vi.stubGlobal(
      "fetch",
      async () => new Response("not found", { status: 404 }),
    );
    await expect(
      loadDocumentFontPack("http://localhost/fonts/"),
    ).rejects.toThrow("404");
    await expect(loadDocumentFontPack("file:///fonts/")).rejects.toThrow(
      "HTTP",
    );
    expect(fontReport(["함초롬바탕"], ["404"]).families[0]?.status).toBe(
      "missing",
    );
  });
});
