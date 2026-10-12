import { cp, access, readFile, writeFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
const runtime = fileURLToPath(
  new URL("../.build/rhwp-studio/", import.meta.url),
);
const target = fileURLToPath(
  new URL("../apps/playground/public/editor-assets/rhwp/", import.meta.url),
);
try {
  await access(runtime);
} catch {
  throw new Error(
    "Run yarn assets:prepare to build the SDK runtime before starting the playground.",
  );
}
await cp(runtime, target, { recursive: true });
const provenance = JSON.parse(
  await readFile(path.join(target, "provenance.json"), "utf8"),
);
provenance.wasmFile = `assets/${(await readdir(path.join(target, "assets"))).find((name) => /^rhwp_bg-.*\.wasm$/.test(name))}`;
await writeFile(
  path.join(target, "provenance.json"),
  JSON.stringify(provenance, null, 2),
);
await cp(
  new URL(
    "../packages/engine-rhwp/assets/document-studio-extension.js",
    import.meta.url,
  ),
  path.join(target, "document-studio-extension.js"),
);
await cp(
  fileURLToPath(import.meta.resolve("@rhwp/core")),
  path.join(target, "validation-rhwp.js"),
);
console.log("SDK runtime copied to the test playground.");
