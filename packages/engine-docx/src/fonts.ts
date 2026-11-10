import type { FontSource } from "@docx-editor.dev/core";
import {
  composeFontConfiguration,
  type FontResolver,
} from "@docx-editor.dev/core/editor";
import {
  bundledFontFamily,
  fontReport,
  loadDocumentFontPack,
  type DocumentFontReport,
} from "@document-studio/core";

// One verified pack per font URL for the page lifetime; every DOCX editor reuses the same
// sources instead of downloading, verifying and hashing about 20 MB of fonts on each open.
const packs = new Map<string, Promise<readonly FontSource[]>>();
function documentFontSources(
  baseUrl: string | undefined,
): Promise<readonly FontSource[]> {
  const key = baseUrl ?? "";
  const cached = packs.get(key);
  if (cached) return cached;
  // Shared by later editors, so one editor's abort must not cancel it.
  const pending = loadDocumentFontPack(baseUrl).then((faces) =>
    faces.map(
      (face): FontSource =>
        Object.freeze({
          request: Object.freeze({
            family: face.family,
            weight: face.weight,
            style: "normal" as const,
          }),
          id: `document-studio:${face.file}`,
          bytes: face.data,
          // loadDocumentFontPack checked size and SHA-256 against the audited manifest, so the
          // engine's own JavaScript re-hash in createFontSource would only repeat that work.
          hash: `sha256:${face.sha256}`,
          faceIndex: 0,
        }),
    ),
  );
  packs.set(key, pending);
  // Failed loads may be retried after the host fixes its asset route.
  pending.catch(() => {
    if (packs.get(key) === pending) packs.delete(key);
  });
  return pending;
}

export function portableDocxFonts(
  baseUrl: string | undefined,
  report: (value: DocumentFontReport) => void,
): FontResolver {
  const requested = new Set<string>();
  return async (request) => {
    request.families.forEach((name) => requested.add(name));
    requested.add(request.defaultFamily);
    const provided = new Map<string, { source: "provided" }>();
    // resolvedFaces proves coverage, not the substitute selected by an earlier host origin.
    for (const face of request.resolvedFaces ?? [])
      provided.set(face.family, { source: "provided" });
    try {
      const sources = await documentFontSources(baseUrl);
      request.signal?.throwIfAborted();
      const substitutions = [...requested].slice(0, 64).flatMap((family) =>
        [400, 700].flatMap((weight) =>
          (["normal", "italic"] as const).flatMap((style) => {
            if (
              request.resolvedFaces?.some(
                (face) =>
                  face.family.toLowerCase() === family.toLowerCase() &&
                  face.weight === weight &&
                  face.style === style,
              )
            )
              return [];
            const target = bundledFontFamily(family);
            if (family === target && style === "normal") return [];
            return [
              {
                from: { family, weight, style },
                to: { family: target, weight, style: "normal" as const },
              },
            ];
          }),
        ),
      );
      report(fontReport([...requested], [], provided));
      return composeFontConfiguration({
        sources: [...sources],
        substitutions,
        language: "ko-KR",
      });
    } catch (error) {
      if (request.signal?.aborted) throw error;
      report(
        fontReport(
          [...requested],
          [error instanceof Error ? error.message : "기본 글꼴 준비 실패"],
          provided,
        ),
      );
      return undefined;
    }
  };
}
