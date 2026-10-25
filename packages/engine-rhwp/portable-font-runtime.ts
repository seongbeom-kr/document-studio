import {
  DOCUMENT_STUDIO_FONT_PACK as pack,
  bundledFontFamily,
  fontClass,
  fontReport,
  loadDocumentFontPack,
} from "../core/src/fonts";

const base = new URL(
  new URLSearchParams(location.search).get("fontBaseUrl") ?? "../fonts/",
  location.href,
).href;
export const portableRuleId = pack.id;
export const portableSymbolFamily = "Noto Sans Symbols 2";
const symbolFace = pack.faces.find((face) => face.family === portableSymbolFamily);
if (!symbolFace) throw new Error("기호 글꼴이 기본 팩에 없습니다.");
export const portableSymbolFontUrl = new URL(symbolFace.file, base).href;
const defaultFace = pack.faces.find((face) => face.family === "Noto Sans KR" && face.weight === 400);
if (!defaultFace) throw new Error("본문 글꼴이 기본 팩에 없습니다.");
export const portableDefaultFontUrl = new URL(defaultFace.file, base).href;
let failures = ["font-assets-not-loaded"];
let loading: Promise<void> | undefined;
const choices = new Map<
  string,
  { family: string; source: "provided" | "local" }
>();
const global = window as typeof window & {
  documentStudioFonts?: (names: string[]) => ReturnType<typeof fontReport>;
};
global.documentStudioFonts = (names) => fontReport(names, failures, choices);

export const portableEntries = pack.faces.map((face) => ({
  name: face.family,
  file: new URL(face.file, base).href,
  format: "truetype" as const,
  weight: String(face.weight),
  ruleId: pack.id,
}));
export function portableFamily(requested: string): string {
  return bundledFontFamily(requested);
}
export function portableFamilies(requested: string): string[] {
  return [...new Set([portableFamily(requested), portableSymbolFamily])];
}
export function recordPortableChoice(
  requested: string,
  actual: string,
  source: "local" | "bundled",
): void {
  if (source === "local") choices.set(requested, { family: actual, source });
  else choices.delete(requested);
}
export function portableSupply(name: string) {
  return {
    status: failures.length ? "absent" : "loaded",
    canvasKitSfntPlanned:
      fontClass(name) !== "symbol" ||
      pack.faces.some((face) => face.family.toLowerCase() === name.toLowerCase()),
    ruleIds: [pack.id],
  };
}
export async function loadPortableFonts(): Promise<void> {
  loading ??= (async () => {
    try {
      const faces = await loadDocumentFontPack(base);
      const prepared = await Promise.all(
        faces.map(async (face) => {
          const font = new FontFace(face.family, face.data.slice().buffer, {
            weight: String(face.weight),
            style: "normal",
            display: "block",
          });
          return font.load();
        }),
      );
      for (const face of prepared) document.fonts.add(face);
      failures = [];
    } catch (error) {
      failures = [
        error instanceof Error ? error.message : "기본 글꼴 준비 실패",
      ];
      console.error("Document Studio font pack unavailable", error);
    }
  })();
  await loading;
}
export function portablePlan(names: readonly string[]) {
  return {
    sources: pack.faces.map((face) => ({
      url: new URL(face.file, base).href,
      aliases: [
        face.family,
        ...names.filter(
          (name) =>
            !choices.has(name) && bundledFontFamily(name) === face.family,
        ),
      ],
    })),
    unavailableFonts: names.filter(
      (name) =>
        fontClass(name) === "symbol" &&
        !pack.faces.some((face) => face.family.toLowerCase() === name.toLowerCase()),
    ),
    ruleIds: [pack.id],
  };
}
