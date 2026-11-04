import { readFile, lstat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { canonicalV3, digestV3 } from "./contract";
import { openArchive, walk, attr, elements } from "../xml";
import fontPack from "../../../core/src/font-pack.json";
import type { RuntimeProfileV3 } from "./types";
export interface NativeHwpDocumentV3 {
  free(): void;
  exportHwpx(): Uint8Array;
  exportHwpVerify(): string;
  exportHwpWithReport(): {
    contentLoss(): string;
    takeBytes(): Uint8Array;
    free(): void;
  };
  pageCount(): number;
  reflowLinesegs(): number;
  getDocumentInfo(): string;
  getPageText(page: number): string;
  getPageInfo(page: number): string;
  getPageTextLayout(page: number): string;
  getPageRenderTree(page: number): string;
  renderPageSvg(page: number): string;
  registerExactFontSource(
    shape: number,
    language: number,
    bytes: Uint8Array,
    index: number,
  ): string;
}
export interface FontBindingV3 {
  charShapeId: number;
  languageIndex: number;
  requestedFamily: string;
  resolvedFamily: string;
  fontDigest: string;
}
export interface NativeHwpRuntimeV3 {
  HwpDocument: new (bytes: Uint8Array) => NativeHwpDocumentV3;
  runtimeProfile: RuntimeProfileV3;
  bindFonts(document: NativeHwpDocumentV3, bytes: Uint8Array): FontBindingV3[];
}
interface NativeManifestV3 {
  schemaVersion: number;
  contractVersions: number[];
  runtimeProfile: RuntimeProfileV3;
  files: Record<string, string>;
}
const installedDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = pathToFileURL(path.dirname(installedDirectory) + path.sep);
const runtimeRoot = pathToFileURL(
  path.join(installedDirectory, "runtime") + path.sep,
);
async function manifestV3(): Promise<NativeManifestV3> {
  const value = JSON.parse(
    await readFile(new URL("runtime-manifest.json", packageRoot), "utf8"),
  ) as NativeManifestV3;
  if (
    value.schemaVersion !== 2 ||
    !value.contractVersions.includes(3) ||
    !value.runtimeProfile ||
    !value.files
  )
    throw new Error("REPORT_NATIVE_RUNTIME_UNAVAILABLE");
  return value;
}
export async function nativeRuntimeProfileV3(): Promise<RuntimeProfileV3> {
  return structuredClone((await manifestV3()).runtimeProfile);
}
let modulePromise:
  | Promise<{ HwpDocument: NativeHwpRuntimeV3["HwpDocument"] }>
  | undefined;
let loadedModuleKey: string | undefined;
export async function loadNativeRuntime(
  profile: RuntimeProfileV3,
): Promise<NativeHwpRuntimeV3> {
  const manifest = await manifestV3();
  if (
    canonicalV3(profile) !== canonicalV3(manifest.runtimeProfile) ||
    profile.fontPackDigest !== (await digestV3(fontPack))
  )
    throw new Error("REPORT_NATIVE_RUNTIME_MISMATCH");
  const required = [
    "dist/runtime/rhwp.js",
    "dist/runtime/rhwp_bg.wasm",
    "dist/fonts/manifest.json",
    ...fontPack.faces.map((face) => "dist/fonts/" + face.file),
    ...fontPack.supportFiles.map((file) => "dist/fonts/" + file.file),
  ];
  const bytes = new Map<string, Uint8Array>();
  for (const name of required) {
    if (!/^[a-f0-9]{64}$/.test(manifest.files[name] ?? ""))
      throw new Error("REPORT_NATIVE_RUNTIME_MISMATCH");
    const url = new URL(name, packageRoot),
      stat = await lstat(url);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error("REPORT_NATIVE_RUNTIME_MISMATCH");
    const data = await readFile(url);
    if (
      createHash("sha256").update(data).digest("hex") !== manifest.files[name]
    )
      throw new Error("REPORT_NATIVE_RUNTIME_MISMATCH");
    bytes.set(name, data);
  }
  const moduleKey =
    manifest.files["dist/runtime/rhwp.js"] +
    ":" +
    manifest.files["dist/runtime/rhwp_bg.wasm"];
  if (loadedModuleKey && loadedModuleKey !== moduleKey)
    throw new Error("REPORT_NATIVE_RUNTIME_MISMATCH");
  if (!modulePromise) {
    loadedModuleKey = moduleKey;
    modulePromise = (async () => {
      const url = new URL("rhwp.js", runtimeRoot),
        module = await import(/* @vite-ignore */ url.href);
      await module.default({
        module_or_path: bytes.get("dist/runtime/rhwp_bg.wasm"),
      });
      return module;
    })();
  }
  let module: Awaited<NonNullable<typeof modulePromise>>;
  try {
    module = await modulePromise;
  } catch (error) {
    modulePromise = undefined;
    loadedModuleKey = undefined;
    throw error;
  }
  return {
    HwpDocument: module.HwpDocument,
    runtimeProfile: structuredClone(profile),
    bindFonts(document, source) {
      const opened = openArchive(source, "hwpx"),
        header = opened.xml.get("Contents/header.xml");
      if (!header) throw new Error("REPORT_FONT_BINDING_FAILED");
      const language = [
          "HANGUL",
          "LATIN",
          "HANJA",
          "JAPANESE",
          "OTHER",
          "SYMBOL",
          "USER",
        ],
        slots = [
          "hangul",
          "latin",
          "hanja",
          "japanese",
          "other",
          "symbol",
          "user",
        ];
      const fonts = new Map<string, string>();
      for (const face of walk(header).filter((n) => n.localName === "fontface"))
        for (const font of elements(face).filter((n) => n.localName === "font"))
          fonts.set(
            `${attr(face, "lang")}:${attr(font, "id")}`,
            attr(font, "face") ?? "",
          );
      const used = new Set(
        opened.bodyParts.flatMap((part) =>
          walk(opened.xml.get(part)!)
            .filter((n) => n.localName === "run")
            .map((n) => Number(attr(n, "charPrIDRef") ?? 0)),
        ),
      );
      const bindings: FontBindingV3[] = [];
      for (const shape of walk(header).filter(
        (n) => n.localName === "charPr",
      )) {
        const id = Number(attr(shape, "id"));
        if (!used.has(id)) continue;
        const reference = elements(shape).find(
            (n) => n.localName === "fontRef",
          ),
          bold = elements(shape).some((n) => n.localName === "bold");
        for (let slot = 0; slot < 7; slot++) {
          const requestedFamily =
            fonts.get(
              `${language[slot]}:${reference ? attr(reference, slots[slot]!) : "0"}`,
            ) ?? "";
          const family =
            /바탕|명조|serif|times|georgia/i.test(requestedFamily) &&
            !/sans/i.test(requestedFamily)
              ? "Noto Serif KR"
              : "Noto Sans KR";
          const face = fontPack.faces.find(
            (f) => f.family === family && f.weight === (bold ? 700 : 400),
          )!;
          const result = JSON.parse(
            document.registerExactFontSource(
              id,
              slot,
              bytes.get("dist/fonts/" + face.file)!,
              0,
            ),
          );
          if (
            result.ok !== true ||
            result.handle?.fontSourceSha256 !== face.sha256
          )
            throw new Error("REPORT_FONT_BINDING_FAILED");
          bindings.push({
            charShapeId: id,
            languageIndex: slot,
            requestedFamily,
            resolvedFamily: family,
            fontDigest: "sha256:" + face.sha256,
          });
        }
      }
      if (used.size && !bindings.length)
        throw new Error("REPORT_FONT_BINDING_FAILED");
      return bindings;
    },
  };
}
