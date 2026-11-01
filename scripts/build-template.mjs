import { build } from "vite";
import { readFile, writeFile, cp, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
const root = fileURLToPath(new URL("../", import.meta.url)),
  pkg = path.join(root, "packages/template");
await build({
  configFile: false,
  resolve: {
    alias: {
      "@document-studio/core": path.join(root, "packages/core/src/index.ts"),
    },
  },
  build: {
    outDir: path.join(pkg, "dist"),
    emptyOutDir: true,
    target: "es2022",
    lib: {
      entry: path.join(pkg, "src/index.ts"),
      formats: ["es"],
      fileName: "index",
    },
    rolldownOptions: { output: { exports: "named" } },
  },
});
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
await cp(path.join(root, ".build/types/template/src"), path.join(pkg, "dist"), {
  recursive: true,
});
for (const name of ["LICENSE", "NOTICE"])
  await cp(path.join(root, name), path.join(pkg, name));
const licenses = [];
for (const [name, relative] of [
  ["fflate", "fflate/LICENSE"],
  ["@xmldom/xmldom", "@xmldom/xmldom/LICENSE"],
])
  licenses.push(
    `--- ${name} ---\n${await readFile(path.join(root, "node_modules", relative), "utf8")}`,
  );
await writeFile(
  path.join(pkg, "dist/THIRD_PARTY_NOTICES.txt"),
  licenses.join("\n\n"),
);
await mkdir(path.join(pkg, "dist/licenses"), { recursive: true });
await writeFile(
  path.join(pkg, "dist/licenses/THIRD_PARTY_NOTICES.txt"),
  licenses.join("\n\n"),
);
const npm = [];
for (const name of ["fflate", "@xmldom/xmldom"]) {
  const p = JSON.parse(
    await readFile(
      path.join(root, "node_modules", name, "package.json"),
      "utf8",
    ),
  );
  if (p.license !== "MIT")
    throw new Error(`Unexpected template dependency license: ${name}`);
  npm.push({ name, version: p.version, license: p.license });
}
await writeFile(
  path.join(pkg, "dist/licenses/sbom.json"),
  JSON.stringify(
    { ownLicense: "Apache-2.0", npm, rust: { packages: [] } },
    null,
    2,
  ) + "\n",
);
const manifest = JSON.parse(
    await readFile(path.join(pkg, "package.json"), "utf8"),
  ),
  files = {};
for (const name of ["dist/index.js", "bin/template-cli.mjs"])
  files[name] = createHash("sha256")
    .update(await readFile(path.join(pkg, name)))
    .digest("hex");
await writeFile(
  path.join(pkg, "runtime-manifest.json"),
  JSON.stringify(
    { schemaVersion: 1, contractVersion: 2, version: manifest.version, files },
    null,
    2,
  ) + "\n",
);
