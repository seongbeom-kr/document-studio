import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const rhwpCoreDirectory = fileURLToPath(
  new URL("../third_party/rhwp-core/", import.meta.url),
);
export async function verifyRhwpCoreAssets() {
  const metadata = JSON.parse(
    await readFile(path.join(rhwpCoreDirectory, "provenance.json"), "utf8"),
  );
  if (
    metadata.sourceCommit !== "e8800c8def63449808a4092798442652ed460552" ||
    metadata.license !== "MIT"
  )
    throw new Error("Unexpected downstream RHWP core source.");
  for (const [name, expected] of Object.entries(metadata.sha256)) {
    if (path.basename(name) !== name)
      throw new Error("Unexpected RHWP core asset path.");
    const digest = createHash("sha256")
      .update(await readFile(path.join(rhwpCoreDirectory, name)))
      .digest("hex");
    if (digest !== expected)
      throw new Error(`Downstream RHWP core asset mismatch: ${name}`);
  }
  for (const name of [
    "rhwp.js",
    "rhwp_bg.wasm",
    "rhwp.d.ts",
    "rhwp_bg.wasm.d.ts",
    "paragraph-overlay.patch",
    "LICENSE",
  ]) {
    if (!metadata.sha256[name])
      throw new Error(`Missing RHWP core asset digest: ${name}`);
  }
  return metadata;
}
