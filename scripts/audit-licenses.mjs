import {
  readFile,
  writeFile,
  readdir,
  realpath,
  mkdir,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { permittedLicense } from "./license-policy.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, ".build/licenses");
await mkdir(output, { recursive: true });
const packages = new Map(),
  notices = [],
  missing = [];
async function resolve(name, from) {
  for (let dir = from; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, "node_modules", name);
    try {
      await readFile(path.join(candidate, "package.json"));
      return await realpath(candidate);
    } catch {}
    if (path.dirname(dir) === dir)
      throw new Error(`Missing dependency: ${name}`);
  }
}
async function visit(directory, bundled = false) {
  const manifest = JSON.parse(
    await readFile(path.join(directory, "package.json"), "utf8"),
  );
  const key = `${manifest.name}@${manifest.version}`;
  bundled ||= manifest.name === "@rhwp/editor";
  if (packages.has(key)) return;
  if (
    /\/pro(?:-|$)|editor-api|collaboration/.test(manifest.name) ||
    !permittedLicense(manifest.license)
  )
    throw new Error(`License requires review: ${key}: ${manifest.license}`);
  const files = [];
  async function licenses(dir, prefix = "", depth = 0) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const relative = prefix + entry.name;
      if (
        entry.isFile() &&
        /^(?:licen[cs]e|notice|copying|copyright|third_party_notices|readme)/i.test(
          entry.name,
        )
      ) {
        const content = await readFile(path.join(dir, entry.name), "utf8");
        if (
          !/^readme/i.test(entry.name) ||
          /Permission is hereby granted/.test(content)
        )
          files.push({ path: relative, content });
      } else if (
        entry.isDirectory() &&
        depth < 2 &&
        /licenses?|legal/i.test(entry.name)
      )
        await licenses(path.join(dir, entry.name), relative + "/", depth + 1);
    }
  }
  await licenses(directory);
  if (!files.length) {
    const base = path.join(
      root,
      "third_party/npm",
      `${key.replaceAll("/", "_")}`,
    );
    try {
      const source = JSON.parse(await readFile(base + ".json", "utf8"));
      const content = await readFile(base + ".txt", "utf8");
      if (
        source.name !== manifest.name ||
        source.version !== manifest.version ||
        source.license !== manifest.license ||
        source.sha256 !== createHash("sha256").update(content).digest("hex")
      )
        throw new Error(`License supplement mismatch: ${key}`);
      files.push({ path: source.source, content });
    } catch (cause) {
      if (cause.code !== "ENOENT") throw cause;
      missing.push(key);
    }
  }
  packages.set(key, {
    name: manifest.name,
    version: manifest.version,
    license: manifest.license,
    bundled,
    licenseFiles: files.map((file) => ({
      path: file.path,
      sha256: createHash("sha256").update(file.content).digest("hex"),
    })),
  });
  notices.push(
    ...files.map(
      (file) =>
        `--- ${key}/${file.path} (${manifest.license}) ---\n${file.content}`,
    ),
  );
  for (const name of Object.keys(manifest.dependencies ?? {}))
    await visit(await resolve(name, directory), bundled);
  for (const name of Object.keys(manifest.peerDependencies ?? {})) {
    if (manifest.peerDependenciesMeta?.[name]?.optional) continue;
    await visit(await resolve(name, directory), bundled);
  }
}
for (const name of ["core", "react", "engine-docx", "engine-rhwp"])
  await visit(path.join(root, "packages", name));
const studio = path.join(root, ".cache/rhwp-source/rhwp-studio");
const studioManifest = JSON.parse(
  await readFile(path.join(studio, "package.json"), "utf8"),
);
for (const name of Object.keys(studioManifest.dependencies))
  await visit(await resolve(name, studio), true);
if (missing.length)
  throw new Error(`Missing license texts: ${missing.join(", ")}`);
const rust = JSON.parse(
  await readFile(path.join(root, "third_party/rust-sbom.json"), "utf8"),
);
const lock = await readFile(path.join(root, ".cache/rhwp-source/Cargo.lock"));
if (createHash("sha256").update(lock).digest("hex") !== rust.lockSha256)
  throw new Error("Pinned Rust dependency inventory is stale.");
for (const pkg of rust.packages) {
  if (!permittedLicense(pkg.license))
    throw new Error(`Rust license requires review: ${pkg.name}`);
  const file = await readFile(
    path.join(root, "third_party", pkg.notices),
    "utf8",
  );
  if (!file.trim()) throw new Error(`Missing Rust notice: ${pkg.name}`);
  notices.push(file);
}
const inventory = {
  schemaVersion: 1,
  ownLicense: "Apache-2.0",
  npm: [...packages.values()].sort((a, b) => a.name.localeCompare(b.name)),
  rust,
  exclusions: [
    "government executables/code/templates",
    "DOCX Pro/editor-api",
    "external fonts",
    "upstream sample documents/photos",
  ],
  basis:
    "Installed production dependency graphs, bundled RHWP Studio runtime dependencies, and conservative pinned Cargo.lock inventory. This is not an independent WASM linker trace.",
};
await writeFile(
  path.join(output, "sbom.json"),
  JSON.stringify(inventory, null, 2) + "\n",
);
await writeFile(
  path.join(output, "THIRD_PARTY_NOTICES.txt"),
  notices.join("\n\n") + "\n",
);
console.log(
  `License gate passed: ${packages.size} npm packages; ${rust.packages.length} pinned registry crates.`,
);
