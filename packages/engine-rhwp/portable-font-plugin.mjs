import { fileURLToPath } from "node:url";
const runtime = fileURLToPath(
  new URL("./portable-font-runtime.ts", import.meta.url),
).replaceAll("\\", "/");
function insert(code, anchor, addition) {
  if (code.split(anchor).length !== 2)
    throw new Error(
      `Pinned RHWP font contract changed: ${anchor.slice(0, 80)}`,
    );
  return code.replace(anchor, anchor + addition);
}
export function portableFontPlugin() {
  return {
    name: "document-studio-portable-fonts",
    enforce: "pre",
    transform(code, file) {
      const id = file.replaceAll("\\", "/");
      code = code.replaceAll("\r\n", "\n");
      if (id.endsWith("/core/font-loader.ts")) {
        const anchor =
          "const FONT_LIST: readonly FontEntry[] = FONT_RULE_WEBFONT_ENTRIES;";
        if (!code.includes(anchor))
          throw new Error("Pinned RHWP font registry changed.");
        code = code.replace(
          anchor,
          "const FONT_LIST: readonly FontEntry[] = portableEntries;",
        );
        code = insert(code, "): Promise<void> {\n  // 0) 문서 요청명", "");
        code = code.replace(
          "): Promise<void> {\n  // 0) 문서 요청명",
          "): Promise<void> {\n  return loadPortableFonts();\n  // 0) 문서 요청명",
        );
        code = insert(
          code,
          "): CanvasKitFontPlanDecision {",
          "\n  return portablePlan(requiredFontFamilies);",
        );
        code = insert(
          code,
          "export function getWebFontSupplySnapshotWithRules(fontName: string): WebFontSupplyDecision {",
          "\n  return portableSupply(fontName) as WebFontSupplyDecision;",
        );
        return {
          code:
            `import { portableEntries, loadPortableFonts, portablePlan, portableSupply } from ${JSON.stringify(runtime)};\n` +
            code,
          map: null,
        };
      }
      if (id.endsWith("/core/font-substitution.ts")) {
        code = insert(code, "): FontRuleResolution {\n  if (!fontName", "");
        code = code.replace(
          "): FontRuleResolution {\n  if (!fontName",
          "): FontRuleResolution {\n  return { fontName: installedFaceName(fontName) ?? portableFamily(fontName), ruleIds: ['document-studio-noto-1'] };\n  if (!fontName",
        );
        code = insert(
          code,
          "): FontFamilyCandidatesDecision {",
          `
  const exact = installedFaceName(fontName, options.confirmedLocalFonts);
  recordPortableChoice(fontName, exact ?? portableFamily(fontName), exact ? 'local' : 'bundled');
  return { candidates: [...new Set([exact, portableFamily(fontName)].filter(Boolean))] as string[], ruleIds: ['document-studio-noto-1'] };
`,
        );
        return {
          code:
            `import { portableFamily, recordPortableChoice } from ${JSON.stringify(runtime)};\n` +
            code,
          map: null,
        };
      }
    },
  };
}
