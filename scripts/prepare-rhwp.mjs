import { spawnSync } from "node:child_process";
import { prepareRhwpObservation } from "./prepare-rhwp-observation.mjs";
import { prepareFontConfig, verifyFontAssets } from "./font-assets.mjs";
import {
  cp,
  mkdir,
  readFile,
  writeFile,
  rm,
  lstat,
  readdir,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createHash } from "node:crypto";

const root = fileURLToPath(new URL("../", import.meta.url));
await prepareFontConfig();
await verifyFontAssets();
const source = path.join(root, ".cache/rhwp-source");
const commit = "e8800c8def63449808a4092798442652ed460552";
const output = path.resolve(root, ".build/rhwp-studio");
if (!output.startsWith(path.resolve(root) + path.sep))
  throw new Error("Asset output must stay inside the workspace.");
function run(command, args, cwd = root, env = process.env) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    stdio: "inherit",
    shell: command.endsWith(".cmd"),
  });
  if (result.status !== 0)
    throw new Error(`${command} failed (${result.status}).`);
}
if (!existsSync(path.join(source, ".git"))) {
  run("git", ["init", source]);
  run("git", [
    "-C",
    source,
    "remote",
    "add",
    "origin",
    "https://github.com/edwardkim/rhwp.git",
  ]);
  run("git", ["-C", source, "config", "core.longpaths", "true"]);
  run("git", ["-C", source, "sparse-checkout", "init", "--cone"]);
  run("git", [
    "-C",
    source,
    "sparse-checkout",
    "set",
    "rhwp-studio",
    "rhwp-shared",
    "scripts",
    "npm/editor",
    "npm/hwpctrl-ocx",
    "typescript",
  ]);
  run("git", [
    "-C",
    source,
    "fetch",
    "--depth=1",
    "--filter=blob:none",
    "origin",
    commit,
  ]);
  run("git", ["-C", source, "checkout", "--detach", "FETCH_HEAD"]);
}
const current = spawnSync("git", ["-C", source, "rev-parse", "HEAD"], {
  encoding: "utf8",
});
if (current.stdout.trim() !== commit)
  throw new Error("RHWP source commit does not match the pinned npm SDK.");
await mkdir(path.join(source, "pkg"), { recursive: true });
await cp(path.join(root, "node_modules/@rhwp/core"), path.join(source, "pkg"), {
  recursive: true,
});
const studio = path.join(source, "rhwp-studio");
if (process.platform === "win32") {
  const npmCli = path.join(
    path.dirname(process.execPath),
    "node_modules/npm/bin/npm-cli.js",
  );
  run(
    process.execPath,
    [npmCli, "ci", "--ignore-scripts", "--no-audit", "--no-fund"],
    studio,
  );
} else
  run("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], studio);
run(
  process.execPath,
  [path.join(root, "scripts/build-rhwp-runtime.mjs"), source, output],
  studio,
  { ...process.env, RHWP_DISABLE_EXTERNAL_WEBFONTS: "1" },
);
let html = await readFile(path.join(output, "index.html"), "utf8");
html = html.replace(
  /<script\b[^>]*id="vite-plugin-pwa:register-sw"[^>]*>[\s\S]*?<\/script>/g,
  "",
);
html = html.replace(
  /(src|href)="\/(theme-init\.js|favicon\.ico|images\/[^\"]+|icons\/[^\"]+)"/g,
  '$1="./$2"',
);
html = html.replace(
  "</head>",
  '<script type="module" src="./document-studio-extension.js"></script></head>',
);
await writeFile(path.join(output, "index.html"), html);
await prepareRhwpObservation(output);
const runtimeAssets = path.join(output, "assets");
for (const name of await readdir(runtimeAssets)) {
  if (!name.endsWith(".css")) continue;
  const cssPath = path.join(runtimeAssets, name);
  const css = await readFile(cssPath, "utf8");
  await writeFile(
    cssPath,
    css.replace(/url\((['"]?)\/images\//g, "url($1../images/"),
  );
}
await cp(
  path.join(root, "packages/engine-rhwp/assets/document-studio-extension.js"),
  path.join(output, "document-studio-extension.js"),
);
// Public runtime assets exclude upstream demo documents and images without a verified fixture license.
for (const relative of [
  "samples",
  "sw.js",
  "registerSW.js",
  "workbox-dcde9eb3.js",
]) {
  const target = path.resolve(output, relative);
  if (
    !target.startsWith(path.resolve(output) + path.sep) ||
    !target.startsWith(path.resolve(root) + path.sep)
  )
    throw new Error("Unsafe generated asset cleanup path.");
  await rm(target, { recursive: true, force: true });
}
const fontPath = path.resolve(output, "fonts");
if (existsSync(fontPath)) {
  if (!fontPath.startsWith(path.resolve(output) + path.sep))
    throw new Error("Unsafe font cleanup path.");
  await rm(fontPath, { recursive: true, force: true });
}
await cp(path.join(source, "LICENSE"), path.join(output, "LICENSE-RHWP.txt"));
await cp(
  path.join(root, "LICENSE"),
  path.join(output, "LICENSE-DOCUMENT-STUDIO.txt"),
);
await cp(
  path.join(root, "NOTICE"),
  path.join(output, "NOTICE-DOCUMENT-STUDIO.txt"),
);
await cp(
  path.join(source, "THIRD_PARTY_LICENSES.md"),
  path.join(output, "THIRD_PARTY_LICENSES.md"),
);
await writeFile(
  path.join(output, "provenance.json"),
  JSON.stringify(
    {
      engine: "@rhwp/core",
      version: "0.8.6",
      sourceCommit: commit,
      downstreamHistoryGrouping: {
        file: "packages/engine-rhwp/native-history-plugin.mjs",
        sha256: createHash("sha256")
          .update(
            await readFile(
              path.join(root, "packages/engine-rhwp/native-history-plugin.mjs"),
            ),
          )
          .digest("hex"),
      },
      externalWebFonts: false,
      downstreamFontPolicy: {
        files: await Promise.all(
          [
            "packages/engine-rhwp/portable-font-plugin.mjs",
            "packages/engine-rhwp/portable-font-runtime.ts",
            "packages/core/src/fonts.ts",
          ].map(async (file) => ({
            file,
            sha256: createHash("sha256")
              .update(await readFile(path.join(root, file)))
              .digest("hex"),
          })),
        ),
      },
      fontPack: JSON.parse(
        await readFile(
          path.join(root, "packages/core/assets/fonts/manifest.json"),
          "utf8",
        ),
      ),
      wasmFile: `assets/${(await readdir(runtimeAssets)).find((name) => /^rhwp_bg-.*\.wasm$/.test(name))}`,
    },
    null,
    2,
  ),
);
console.log("Self-hosted RHWP assets prepared:", output);
