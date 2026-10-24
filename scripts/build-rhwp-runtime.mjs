import path from "node:path";
import { pathToFileURL } from "node:url";
import { cp } from "node:fs/promises";
import { nativeHistoryPlugin } from "../packages/engine-rhwp/native-history-plugin.mjs";
import { portableFontPlugin } from "../packages/engine-rhwp/portable-font-plugin.mjs";
const [source, output] = process.argv.slice(2);
if (!source || !output) throw new Error("Source and output are required.");
const studio = path.join(source, "rhwp-studio");
const { build, loadConfigFromFile } = await import(
  pathToFileURL(path.join(studio, "node_modules/vite/dist/node/index.js")).href
);
const loaded = await loadConfigFromFile(
  { command: "build", mode: "production" },
  path.join(studio, "vite.config.ts"),
);
if (!loaded) throw new Error("Could not load pinned RHWP config.");
const plugins = loaded.config.plugins
  .flat(Infinity)
  .filter((plugin) => plugin && !plugin.name?.startsWith("vite-plugin-pwa"));
await build({
  ...loaded.config,
  configFile: false,
  root: studio,
  base: "./",
  publicDir: false,
  plugins: [...plugins, nativeHistoryPlugin(), portableFontPlugin()],
  build: { ...loaded.config.build, outDir: output, emptyOutDir: true },
});
// Only the runtime's own static UI files are copied. Ignore fonts symlinks and upstream sample documents.
for (const name of ["theme-init.js", "favicon.ico", "icons", "images"])
  await cp(path.join(studio, "public", name), path.join(output, name), {
    recursive: true,
  });
