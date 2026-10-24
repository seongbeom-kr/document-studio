import manifest from "./font-pack.json" with { type: "json" };

/** The font files keep OFL-1.1; this does not change the SDK's Apache-2.0 license. */
export const DOCUMENT_STUDIO_FONT_PACK = manifest;
export const DEFAULT_FONT_BASE_URL = "/editor-assets/fonts/";
export type FontClass = "serif" | "sans" | "monospace" | "symbol";
export interface FontResolution {
  requested: string;
  /** null when an external host resolver covers the face but does not disclose its substitute. */
  resolved: string | null;
  source: "bundled" | "provided" | "local";
  status: "available" | "substituted" | "missing";
  reason?: string;
}
export interface DocumentFontReport {
  packId: string;
  /** Font names requested by the engine, not proof that every name is visible. */
  scope: "requested-fonts";
  ready: boolean;
  truncated: boolean;
  glyphCoverage: "not-assessed";
  families: readonly FontResolution[];
  failures: readonly string[];
}
export function fontClass(family: string): FontClass {
  if (/wingdings|webdings|^symbol$|eqn|수식/i.test(family)) return "symbol";
  if (
    /coding|courier|consolas|monospace|mono\b|굴림체|바탕체|gulimche|batangche/i.test(
      family,
    ) &&
    !/kopub/i.test(family)
  )
    return "monospace";
  if (/sans[ -]?serif/i.test(family)) return "sans";
  return /바탕|명조|궁서|batang|myeong|myung|times|serif|georgia|palatino|hymjr|song|宋|明朝/i.test(
    family,
  )
    ? "serif"
    : "sans";
}
export function bundledFontFamily(requested: string): string {
  return fontClass(requested) === "serif" ? "Noto Serif KR" : "Noto Sans KR";
}
export function fontReport(
  families: readonly string[],
  failures: readonly string[] = [],
  provided: ReadonlyMap<
    string,
    { family?: string; source: "provided" | "local" }
  > = new Map(),
): DocumentFontReport {
  const names = [
    ...new Set(
      families
        .filter((name) => typeof name === "string" && name.trim())
        .map((name) => name.normalize("NFC").trim()),
    ),
  ];
  return {
    packId: manifest.id,
    scope: "requested-fonts",
    ready: failures.length === 0,
    truncated: names.length > 64,
    glyphCoverage: "not-assessed",
    failures: failures.slice(0, 16),
    families: names.slice(0, 64).map((requested) => {
      const exact = [...provided].find(
        ([name]) =>
          name.normalize("NFC").trim().toLowerCase() ===
          requested.toLowerCase(),
      )?.[1];
      const resolved = exact
        ? (exact.family ?? null)
        : bundledFontFamily(requested);
      const category = fontClass(requested);
      return {
        requested,
        resolved,
        source: exact?.source ?? "bundled",
        status: exact
          ? "available"
          : failures.length || category === "symbol"
            ? "missing"
            : requested.toLowerCase() === resolved?.toLowerCase()
              ? "available"
              : "substituted",
        ...(exact
          ? resolved
            ? {}
            : { reason: "host-resolver-details-unavailable" }
          : {
              reason:
                category === "symbol"
                  ? "symbol-font-not-bundled"
                  : category === "monospace"
                    ? "monospace-font-not-bundled"
                    : failures.length
                      ? "font-assets-unavailable"
                      : "portable-font-pack",
            }),
      };
    }),
  };
}
export type LoadedFontFace = (typeof manifest.faces)[number] & {
  data: Uint8Array;
};
/** Only fixed, audited filenames are fetched; document font names never form URLs. */
export async function loadDocumentFontPack(
  baseUrl = DEFAULT_FONT_BASE_URL,
  signal?: AbortSignal,
): Promise<LoadedFontFace[]> {
  const faces = await Promise.all(
    manifest.faces.map(async (face) => {
      const base = new URL(
        baseUrl.endsWith("/") ? baseUrl : baseUrl + "/",
        globalThis.location?.href ?? "http://localhost/",
      );
      if (!["http:", "https:"].includes(base.protocol))
        throw new Error("글꼴 자산 URL은 HTTP(S)여야 합니다.");
      const response = await fetch(new URL(face.file, base), { signal });
      if (!response.ok)
        throw new Error(
          `기본 글꼴을 읽지 못했습니다: ${face.file} (${response.status})`,
        );
      // Bound actual transferred bytes, including absent or misleading Content-Length.
      const reader = response.body?.getReader();
      if (!reader) throw new Error(`글꼴 응답을 읽지 못했습니다: ${face.file}`);
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > face.bytes)
            throw new Error(`글꼴 크기 검증 실패: ${face.file}`);
          chunks.push(value);
        }
      } catch (error) {
        await reader.cancel().catch(() => {});
        throw error;
      } finally {
        reader.releaseLock();
      }
      if (size !== face.bytes)
        throw new Error(`글꼴 크기 검증 실패: ${face.file}`);
      const data = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        data.set(chunk, offset);
        offset += chunk.length;
      }
      const digest = [
        ...new Uint8Array(await crypto.subtle.digest("SHA-256", data)),
      ]
        .map((value) => value.toString(16).padStart(2, "0"))
        .join("");
      if (digest !== face.sha256)
        throw new Error(`글꼴 해시 검증 실패: ${face.file}`);
      return { ...face, data };
    }),
  );
  return faces;
}
