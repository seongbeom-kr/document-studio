import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url)),
  target = path.join(root, ".cache", `clean-install-${Date.now()}`);
await mkdir(target, { recursive: true });
for (const file of ["package.json", "yarn.lock", ".yarnrc.yml"])
  await cp(path.join(root, file), path.join(target, file));
for (const directory of ["packages", "apps", "examples"]) {
  for (const entry of await readdir(path.join(root, directory), {
    withFileTypes: true,
  })) {
    if (!entry.isDirectory()) continue;
    const manifest = path.join(root, directory, entry.name, "package.json");
    if (!existsSync(manifest)) continue;
    await mkdir(path.join(target, directory, entry.name), { recursive: true });
    await cp(
      manifest,
      path.join(target, directory, entry.name, "package.json"),
    );
  }
}
const nodeDirectory = path.dirname(process.execPath),
  cli = [
    path.join(nodeDirectory, "node_modules/corepack/dist/yarn.js"),
    path.resolve(nodeDirectory, "../lib/node_modules/corepack/dist/yarn.js"),
  ].find(existsSync);
if (!cli) throw new Error("Corepack is required.");
const result = spawnSync(process.execPath, [cli, "install", "--immutable"], {
  cwd: target,
  stdio: "inherit",
});
await writeFile(
  path.join(root, ".build/clean-install.json"),
  JSON.stringify(
    {
      passed: result.status === 0,
      directory: path.relative(root, target),
      completedAt: new Date().toISOString(),
      scope:
        "Fresh workspace manifest/lock installation; source build is tested separately.",
    },
    null,
    2,
  ),
);
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(
  "Fresh immutable workspace installation passed without touching active preview dependencies.",
);
