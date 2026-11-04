import { build } from "vite";
import { readFile, writeFile, cp, mkdir, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { verifyFontAssets } from "./font-assets.mjs";
import {
  verifyRhwpCoreAssets,
  rhwpCoreDirectory,
} from "./rhwp-core-assets.mjs";
import { permittedLicense } from "./license-policy.mjs";
const root = fileURLToPath(new URL("../", import.meta.url)),
  pkg = path.join(root, "packages/template");
const validators = spawnSync(
  process.execPath,
  [path.join(root, "scripts/generate-template-v3-validators.mjs"), "--check"],
  { cwd: root, stdio: "inherit" },
);
if (validators.status !== 0) process.exit(validators.status ?? 1);
const fontPack = await verifyFontAssets(),
  native = await verifyRhwpCoreAssets();
for (const [entry, empty] of [
  ["index", true],
  ["node", false],
])
  await build({
    configFile: false,
    resolve: {
      alias: {
        "@document-studio/core": path.join(root, "packages/core/src/index.ts"),
      },
    },
    build: {
      outDir: path.join(pkg, "dist"),
      emptyOutDir: empty,
      target: "es2022",
      lib: {
        entry: path.join(pkg, `src/${entry}.ts`),
        formats: ["es"],
        fileName: entry,
      },
      rolldownOptions: {
        external: entry === "node" ? (id) => id.startsWith("node:") : [],
        output: { exports: "named" },
      },
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
await cp(rhwpCoreDirectory, path.join(pkg, "dist/runtime"), {
  recursive: true,
});
await cp(
  path.join(root, "packages/core/assets/fonts"),
  path.join(pkg, "dist/fonts"),
  { recursive: true },
);
await cp(path.join(pkg, "contracts/v3"), path.join(pkg, "dist/contracts/v3"), {
  recursive: true,
});
for (const name of ["LICENSE", "NOTICE"])
  await cp(path.join(root, name), path.join(pkg, name));
const npm = new Map(),
  notices = [];
async function dependency(name) {
  const directory = path.join(root, "node_modules", name),
    manifest = JSON.parse(
      await readFile(path.join(directory, "package.json"), "utf8"),
    );
  if (npm.has(name)) return;
  if (!permittedLicense(manifest.license))
    throw new Error(`Unsupported template dependency license: ${name}`);
  const license = (await readdir(directory)).find((n) =>
    /^licen[cs]e(?:\.(?:md|txt))?$/i.test(n),
  );
  if (!license) throw new Error(`Missing license: ${name}`);
  notices.push(
    `--- ${name} ---\n${await readFile(path.join(directory, license), "utf8")}`,
  );
  npm.set(name, { name, version: manifest.version, license: manifest.license });
  for (const child of Object.keys(manifest.dependencies ?? {}))
    await dependency(child);
}
for (const name of ["fflate", "@xmldom/xmldom", "ajv"]) await dependency(name);
const rust = JSON.parse(
  await readFile(path.join(root, "third_party/rust-sbom.json"), "utf8"),
);
for (const dependency of rust.packages) {
  if (!permittedLicense(dependency.license))
    throw new Error(`Unsupported Rust license: ${dependency.name}`);
  notices.push(
    await readFile(path.join(root, "third_party", dependency.notices), "utf8"),
  );
}
notices.push(await readFile(path.join(rhwpCoreDirectory, "LICENSE"), "utf8"));
for (const name of ["OFL.txt", "NotoSansSymbols2-OFL.txt", "COPYRIGHTS.txt"])
  notices.push(
    await readFile(path.join(root, "packages/core/assets/fonts", name), "utf8"),
  );
await mkdir(path.join(pkg, "dist/licenses"), { recursive: true });
await writeFile(
  path.join(pkg, "dist/THIRD_PARTY_NOTICES.txt"),
  notices.join("\n\n"),
);
await writeFile(
  path.join(pkg, "dist/licenses/THIRD_PARTY_NOTICES.txt"),
  notices.join("\n\n"),
);
await writeFile(
  path.join(pkg, "dist/licenses/sbom.json"),
  JSON.stringify(
    {
      ownLicense: "Apache-2.0",
      npm: [...npm.values()],
      rust,
      native,
      fontPack,
    },
    null,
    2,
  ) + "\n",
);
const canonical = (value) =>
  value === null || typeof value !== "object"
    ? JSON.stringify(value)
    : Array.isArray(value)
      ? "[" + value.map(canonical).join(",") + "]"
      : "{" +
        Object.keys(value)
          .sort()
          .map((key) => JSON.stringify(key) + ":" + canonical(value[key]))
          .join(",") +
        "}";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex"),
  digest = (value) => "sha256:" + hash(canonical(value));
const manifest = JSON.parse(
    await readFile(path.join(pkg, "package.json"), "utf8"),
  ),
  schema = JSON.parse(
    await readFile(path.join(pkg, "contracts/v3/bundle.json"), "utf8"),
  ),
  files = {};
async function inventory(directory, prefix) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = path.posix.join(prefix, entry.name),
      file = path.join(directory, entry.name);
    if (entry.isDirectory()) await inventory(file, name);
    else if (entry.isFile()) files[name] = hash(await readFile(file));
    else throw new Error("Unsupported runtime inventory entry");
  }
}
await inventory(path.join(pkg, "dist"), "dist");
files["bin/template-cli.mjs"] = hash(
  await readFile(path.join(pkg, "bin/template-cli.mjs")),
);
const runtimeProfile = {
  parser: `document-studio/template@${manifest.version}`,
  renderer: `document-studio/template@${manifest.version}`,
  exporter: `rhwp@${native.sourceCommit}:wasm:${native.sha256["rhwp_bg.wasm"]}:js:${native.sha256["rhwp.js"]}`,
  verifier: `document-studio/template@${manifest.version}`,
  fontPackDigest: digest(fontPack),
  schemaDigest: digest(schema),
};
const source = spawnSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
});
if (source.status !== 0)
  throw new Error("Cannot determine package source revision");
const dirty = spawnSync(
  "git",
  [
    "status",
    "--porcelain",
    "--untracked-files=all",
    "--",
    "packages/template",
    "packages/core/src/font-pack.json",
    "scripts/build-template.mjs",
    "third_party/rhwp-core",
  ],
  { cwd: root, encoding: "utf8" },
);
if (dirty.status !== 0)
  throw new Error("Cannot determine package source state");
await writeFile(
  path.join(pkg, "runtime-manifest.json"),
  JSON.stringify(
    {
      schemaVersion: 2,
      contractVersions: [2, 3],
      version: manifest.version,
      sourceCommit: source.stdout.trim(),
      sourceDirty: !!dirty.stdout.trim(),
      runtimeProfile,
      limits: {
        sourceBytes: 33554432,
        outputBytes: 67108864,
        rows: 1000,
        columns: 64,
        cells: 64000,
        pages: 200,
      },
      files,
    },
    null,
    2,
  ) + "\n",
);
