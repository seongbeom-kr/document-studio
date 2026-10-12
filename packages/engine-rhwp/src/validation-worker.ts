import type { HwpDocument } from "@rhwp/core";
import { validateDocumentArchive } from "@document-studio/core";
self.onmessage = async ({ data }) => {
  let document: HwpDocument | undefined;
  try {
    validateDocumentArchive(data.bytes, "hwpx");
    const base = new URL(data.studioUrl),
      response = await fetch(new URL("provenance.json", base));
    if (!response.ok) throw new Error("HWPX 검증 자산 정보를 읽지 못했습니다.");
    const metadata = await response.json();
    if (
      metadata.version !== "0.8.6" ||
      !/^assets\/rhwp_bg-[\w-]+\.wasm$/.test(metadata.wasmFile ?? "")
    )
      throw new Error("HWPX 검증 자산이 일치하지 않습니다.");
    const module = (await import(
      /* @vite-ignore */ /* webpackIgnore: true */ new URL(
        "validation-rhwp.js",
        base,
      ).href
    )) as typeof import("@rhwp/core");
    await module.default({ module_or_path: new URL(metadata.wasmFile, base) });
    document = new module.HwpDocument(data.bytes);
    const sections = document.getSectionCount();
    let paragraphs = 0;
    if (sections > 1000) throw new Error("문서 구역 수 제한을 넘었습니다.");
    for (let section = 0; section < sections; section++)
      paragraphs += document.getParagraphCount(section);
    if (paragraphs > 10000)
      throw new Error("본문 문단 수 제한은 10,000개입니다.");
    self.postMessage({ ok: true });
  } catch (cause) {
    self.postMessage({
      error: cause instanceof Error ? cause.message : String(cause),
    });
  } finally {
    document?.free();
  }
};
