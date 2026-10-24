import { build } from "vite";
import { spawnSync } from "node:child_process";
import { cp, readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { docxPaintPatch, DOCX_PAINT_PATCH } from "./docx-paint-patch.mjs";
import { prepareRhwpObservation } from "./prepare-rhwp-observation.mjs";
import { prepareFontConfig, verifyFontAssets } from "./font-assets.mjs";
import {
  rhwpLifecyclePatch,
  RHWP_LIFECYCLE_PATCH,
} from "./rhwp-lifecycle-patch.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
const packages = ["core", "react", "engine-docx", "engine-rhwp", "browser"];
await prepareFontConfig();
await verifyFontAssets();
const licenseAudit = spawnSync(
  process.execPath,
  [path.join(root, "scripts/audit-licenses.mjs")],
  { cwd: root, stdio: "inherit" },
);
if (licenseAudit.status !== 0) process.exit(licenseAudit.status ?? 1);
const types = spawnSync(
  process.execPath,
  [
    path.join(root, "node_modules/typescript/bin/tsc"),
    "-p",
    "tsconfig.build.json",
  ],
  { cwd: root, stdio: "inherit" },
);
if (types.status !== 0) process.exit(types.status ?? 1);
for (const name of packages) {
  const manifest = JSON.parse(
    await readFile(path.join(root, "packages", name, "package.json"), "utf8"),
  );
  await build({
    configFile: false,
    base: "./",
    plugins:
      name === "engine-docx"
        ? [docxPaintPatch()]
        : name === "engine-rhwp"
          ? [rhwpLifecyclePatch()]
          : [],
    build: {
      outDir: path.join(root, "packages", name, "dist"),
      emptyOutDir: true,
      lib: {
        entry: path.join(
          root,
          "packages",
          name,
          "src",
          name.startsWith("engine") ? "index.tsx" : "index.ts",
        ),
        formats: ["es"],
        fileName: "index",
      },
      rolldownOptions: {
        external: (id) => {
          if (name === "engine-rhwp" && id.startsWith("@rhwp/editor"))
            return false;
          if (
            name === "engine-docx" &&
            id.startsWith("@docx-editor.dev/") &&
            !id.endsWith(".css")
          )
            return false;
          return !id.startsWith(".") && !path.isAbsolute(id);
        },
        output: { exports: "named" },
      },
    },
  });
  // Keep the standard static Worker URL expression recognized by consuming bundlers.
  // Vite's nested runtime URL otherwise becomes file:// in Next's client build.
  const entryPath = path.join(root, "packages", name, "dist/index.js");
  const entrySource = await readFile(entryPath, "utf8");
  await writeFile(
    entryPath,
    entrySource.replace(
      /new Worker\(new URL\(\s*\/\* @vite-ignore \*\/\s*new URL\("([^"]+)", import\.meta\.url\)\.href,\s*"" \+ import\.meta\.url\s*\),/g,
      (_, asset) => `new Worker(new URL("./${asset}", import.meta.url),`,
    ),
  );
  await cp(
    path.join(root, ".build/types", name, "src"),
    path.join(root, "packages", name, "dist"),
    { recursive: true },
  );
  if (name === "react" || name === "browser")
    await cp(
      path.join(root, "packages/react/src/styles.css"),
      path.join(root, "packages", name, "dist/styles.css"),
    );
  if (name === "core")
    await cp(
      path.join(root, "packages/core/assets/fonts"),
      path.join(root, "packages/core/dist/fonts"),
      { recursive: true },
    );
  if (name === "engine-docx")
    await writeFile(
      path.join(root, "packages", name, "dist", "native-patch.json"),
      JSON.stringify(DOCX_PAINT_PATCH, null, 2),
    );
  if (name === "engine-rhwp") {
    await writeFile(
      path.join(root, "packages", name, "dist", "native-patch.json"),
      JSON.stringify(RHWP_LIFECYCLE_PATCH, null, 2),
    );
    await cp(
      path.join(root, ".build/rhwp-studio"),
      path.join(root, "packages/engine-rhwp/dist/studio"),
      { recursive: true },
    );
    await cp(
      fileURLToPath(import.meta.resolve("@rhwp/core")),
      path.join(root, "packages/engine-rhwp/dist/studio/validation-rhwp.js"),
    );
    await cp(
      path.join(
        root,
        "packages/engine-rhwp/assets/document-studio-extension.js",
      ),
      path.join(
        root,
        "packages/engine-rhwp/dist/studio/document-studio-extension.js",
      ),
    );
  }
  if (name === "engine-rhwp") {
    const studio = path.join(root, "packages/engine-rhwp/dist/studio");
    await prepareRhwpObservation(studio);
    const provenance = JSON.parse(
      await readFile(path.join(studio, "provenance.json"), "utf8"),
    );
    provenance.wasmFile = `assets/${(await readdir(path.join(studio, "assets"))).find((name) => /^rhwp_bg-.*\.wasm$/.test(name))}`;
    await writeFile(
      path.join(studio, "provenance.json"),
      JSON.stringify(provenance, null, 2),
    );
  }
  for (const file of ["LICENSE", "NOTICE"])
    await cp(path.join(root, file), path.join(root, "packages", name, file));
  await cp(
    path.join(root, ".build/licenses"),
    path.join(root, "packages", name, "dist/licenses"),
    { recursive: true },
  );
  if (name === "engine-rhwp")
    await cp(
      path.join(root, ".build/licenses"),
      path.join(root, "packages", name, "dist/studio/licenses"),
      { recursive: true },
    );
  console.log("Built", manifest.name);
}
