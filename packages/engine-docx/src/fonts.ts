import {
  composeFontConfiguration,
  createFontSource,
  type FontResolver,
} from "@docx-editor.dev/core/editor";
import {
  bundledFontFamily,
  fontReport,
  loadDocumentFontPack,
  type DocumentFontReport,
} from "@document-studio/core";

export function portableDocxFonts(
  baseUrl: string | undefined,
  report: (value: DocumentFontReport) => void,
): FontResolver {
  let faces: ReturnType<typeof loadDocumentFontPack> | undefined;
  const requested = new Set<string>();
  return async (request) => {
    request.families.forEach((name) => requested.add(name));
    requested.add(request.defaultFamily);
    const provided = new Map<string, { source: "provided" }>();
    // resolvedFaces proves coverage, not the substitute selected by an earlier host origin.
    for (const face of request.resolvedFaces ?? [])
      provided.set(face.family, { source: "provided" });
    try {
      faces ??= loadDocumentFontPack(baseUrl, request.signal);
      const loaded = await faces;
      request.signal?.throwIfAborted();
      const sources = loaded.map((face) => {
        const result = createFontSource(
          face.data,
          { family: face.family, weight: face.weight, style: "normal" },
          {
            id: `document-studio:${face.file}`,
            maxFontBytes: 16 * 1024 * 1024,
          },
        );
        if ("failure" in result)
          throw new Error(
            `기본 글꼴 등록 실패: ${face.file} (${result.failure.reason})`,
          );
        return result.source;
      });
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
        sources,
        substitutions,
        language: "ko-KR",
      });
    } catch (error) {
      if (request.signal?.aborted) throw error;
      faces = undefined; // Failed loads may be retried after the host fixes its asset route.
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
