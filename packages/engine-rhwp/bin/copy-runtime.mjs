#!/usr/bin/env node
import { createHash } from "node:crypto";
import { cp, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const required = ["rhwp.js", "rhwp_bg.wasm", "rhwp.d.ts", "rhwp_bg.wasm.d.ts", "paragraph-overlay.patch", "LICENSE"];
export async function verifyRuntime(directory) {
  const metadata = JSON.parse(await readFile(path.join(directory, "provenance.json"), "utf8"));
  if (metadata.sourceCommit !== "e8800c8def63449808a4092798442652ed460552" || metadata.license !== "MIT")
    throw new Error("Unexpected RHWP runtime provenance.");
  if (!metadata.sha256 || required.some(name => !metadata.sha256[name])) throw new Error("Incomplete RHWP runtime.");
  for (const [name, hash] of Object.entries(metadata.sha256)) {
    if (path.basename(name) !== name || /[\\/]/.test(name) || !/^[a-f0-9]{64}$/.test(hash))
      throw new Error("Invalid RHWP runtime asset path or digest.");
    if (createHash("sha256").update(await readFile(path.join(directory, name))).digest("hex") !== hash)
      throw new Error(`RHWP runtime asset mismatch: ${name}`);
  }
  return metadata;
}

export async function copyRuntime(source, destination) {
  const metadata = await verifyRuntime(source);
  const target = path.resolve(destination);
  let exists = false;
  try {
    const stat = await lstat(target);
    exists = true;
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Runtime destination must be a directory.");
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (exists) {
    const current = await verifyRuntime(path.join(target, "third_party/rhwp-core"));
    if (JSON.stringify(current.sha256) !== JSON.stringify(metadata.sha256))
      throw new Error("A different runtime is already installed. Select a new destination.");
    return { directory: target, sourceCommit: metadata.sourceCommit, installed: false };
  }
  await mkdir(path.dirname(target), { recursive: true });
  const stage = await mkdtemp(path.join(path.dirname(target), ".document-studio-runtime-"));
  try {
    const core = path.join(stage, "third_party/rhwp-core");
    await mkdir(core, { recursive: true });
    for (const name of [...Object.keys(metadata.sha256), "provenance.json"])
      await cp(path.join(source, name), path.join(core, name), { errorOnExist: true, force: false });
    await writeFile(path.join(core, "package.json"), '{"type":"module","private":true}\n');
    await verifyRuntime(core);
    await rename(stage, target);
    return { directory: target, sourceCommit: metadata.sourceCommit, installed: true };
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw new Error("Usage: document-studio-rhwp-runtime <new-runtime-directory>");
    console.log(JSON.stringify(await copyRuntime(fileURLToPath(new URL("../dist/runtime/", import.meta.url)), process.argv[2])));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, code: "RUNTIME_INSTALL_FAILED", message: error.message }));
    process.exitCode = 1;
  }
}
