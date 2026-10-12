import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { HwpDocument } from "@rhwp/core";
import { unzipSync, strFromU8 } from "fflate";
import { XMLParser } from "fast-xml-parser";
import { createHwpxDocument } from "../../packages/engine-rhwp/src/templates";
beforeAll(async () => {
  const wasm = await readFile("node_modules/@rhwp/core/rhwp_bg.wasm");
  vi.stubGlobal("window", {
    location: { href: "http://localhost/harness.html" },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL) =>
      String(url).endsWith("provenance.json")
        ? Response.json({
            version: "0.8.6",
            wasmFile: "assets/rhwp_bg-test.wasm",
          })
        : new Response(wasm, {
            headers: { "Content-Type": "application/wasm" },
          }),
    ),
  );
});
afterAll(() => vi.unstubAllGlobals());
it("creates distinct heading/body/table/following paragraphs in order on the first page", async () => {
  const created = await createHwpxDocument(
    {
      fileName: "report",
      blocks: [
        { kind: "heading", level: 1, text: "보고서 제목" },
        { kind: "paragraph", text: "본문 내용" },
        {
          kind: "table",
          rows: [
            ["항목", "결과"],
            ["생성", "통과"],
          ],
        },
        { kind: "paragraph", text: "마지막 문단" },
      ],
    },
    "/studio/index.html",
  );
  const zip = unzipSync(created.bytes);
  const parsed = new XMLParser({ ignoreAttributes: false }).parse(
    strFromU8(zip["Contents/section0.xml"]!),
  );
  const paragraphs = parsed["hs:sec"]["hp:p"];
  const texts = paragraphs.map((paragraph: any) => JSON.stringify(paragraph));
  expect(texts[0]).toContain("보고서 제목");
  expect(texts[0]).not.toContain("본문 내용");
  expect(texts[1]).toContain("본문 내용");
  expect(texts[2]).toContain("hp:tbl");
  expect(texts[3]).toContain("마지막 문단");
  const reopened = new HwpDocument(created.bytes);
  try {
    expect(reopened.pageCount()).toBe(1);
  } finally {
    reopened.free();
  }
});
