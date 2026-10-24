import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { verifyFontAssets } from "./font-assets.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
const consumer = path.join(root, ".cache/package-consumer");
const packs = path.join(root, ".build/packs");
await mkdir(consumer, { recursive: true });
await mkdir(packs, { recursive: true });
const startedAt = new Date().toISOString();
await writeFile(
  path.join(root, ".build/package-verification.json"),
  JSON.stringify({ passed: false, startedAt, inProgress: true }, null, 2),
);
function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
  });
  if (result.status !== 0)
    throw new Error(`${command} failed (${result.status}).`);
}
const nodeDirectory = path.dirname(process.execPath);
const yarnCli = [
  path.join(nodeDirectory, "node_modules/corepack/dist/yarn.js"),
  path.resolve(nodeDirectory, "../lib/node_modules/corepack/dist/yarn.js"),
].find(existsSync);
if (!yarnCli)
  throw new Error(
    "Corepack is required to generate Yarn workspace package archives.",
  );
const names = ["core", "react", "engine-docx", "engine-rhwp", "browser"];
const archives = new Map();
for (const name of names)
  run(
    process.execPath,
    [
      yarnCli,
      "workspace",
      `@document-studio/${name}`,
      "pack",
      "--out",
      path.join(packs, `${name}.tgz`),
    ],
    root,
  );
for (const name of names) {
  const original = path.join(packs, `${name}.tgz`);
  const digest = createHash("sha256")
    .update(await readFile(original))
    .digest("hex");
  const immutable = path.join(packs, `${name}-${digest.slice(0, 16)}.tgz`);
  await cp(original, immutable);
  archives.set(name, immutable);
}
const manifest = {
  name: "document-studio-isolated-consumer",
  private: true,
  version: "0.0.0",
  type: "module",
  dependencies: Object.fromEntries(
    names.map((name) => [
      `@document-studio/${name}`,
      `file:${path.relative(consumer, archives.get(name)).replaceAll("\\", "/")}`,
    ]),
  ),
  devDependencies: {
    vue: "3.5.44",
    next: "16.3.8",
    react: "19.3.0",
    "react-dom": "19.3.0",
    typescript: "5.9.3",
    "@types/react": "19.3.0",
    "@types/react-dom": "19.3.0",
    "@types/node": "24.12.0",
  },
};
await writeFile(
  path.join(consumer, "package.json"),
  JSON.stringify(manifest, null, 2),
);
const npmCli = path.join(nodeDirectory, "node_modules/npm/bin/npm-cli.js");
if (process.platform === "win32")
  run(
    process.execPath,
    [npmCli, "install", "--ignore-scripts", "--no-audit", "--no-fund"],
    consumer,
  );
else
  run(
    "npm",
    ["install", "--ignore-scripts", "--no-audit", "--no-fund"],
    consumer,
  );
await cp(path.join(root, "examples/nextjs/app"), path.join(consumer, "app"), {
  recursive: true,
});
for (const name of ["tsconfig.json", "next.config.ts"])
  await cp(path.join(root, "examples/nextjs", name), path.join(consumer, name));
// Force the isolated consumer root instead of allowing parent workspace inference.
await writeFile(
  path.join(consumer, "next.config.ts"),
  "export default { experimental: { cpus: 1 }, turbopack: { root: process.cwd() } };\n",
);
run(
  process.execPath,
  [
    path.join(
      consumer,
      "node_modules/@document-studio/engine-rhwp/bin/copy-assets.mjs",
    ),
  ],
  consumer,
);
for (const name of names) {
  const licenseDir = path.join(
    consumer,
    "node_modules/@document-studio",
    name,
    "dist/licenses",
  );
  const sbom = JSON.parse(
    await readFile(path.join(licenseDir, "sbom.json"), "utf8"),
  );
  if (
    sbom.ownLicense !== "Apache-2.0" ||
    !sbom.npm.length ||
    !sbom.rust.packages.length ||
    !(
      await readFile(path.join(licenseDir, "THIRD_PARTY_NOTICES.txt"), "utf8")
    ).includes("canvaskit-wasm@0.42.0")
  )
    throw new Error(
      "Third-party inventory or notices are missing from the package.",
    );
  const installed = JSON.parse(
    await readFile(
      path.join(
        consumer,
        "node_modules/@document-studio",
        name,
        "package.json",
      ),
      "utf8",
    ),
  );
  if (
    Object.values(installed.dependencies ?? {}).some((value) =>
      value.startsWith("workspace:"),
    )
  )
    throw new Error(
      "An unresolved workspace dependency escaped into a published archive.",
    );
  if (
    !existsSync(
      path.join(consumer, "node_modules/@document-studio", name, "LICENSE"),
    )
  )
    throw new Error("License is missing from package.");
}
if (existsSync(path.join(consumer, "public/editor-assets/rhwp/samples")))
  throw new Error(
    "Upstream sample documents must not be included in runtime packages.",
  );
await verifyFontAssets(path.join(consumer, "public/editor-assets/fonts"));
run(
  process.execPath,
  [path.join(consumer, "node_modules/next/dist/bin/next"), "build"],
  consumer,
);
const server = spawn(
  process.execPath,
  [
    path.join(consumer, "node_modules/next/dist/bin/next"),
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    "4176",
  ],
  {
    cwd: consumer,
    stdio: "inherit",
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
  },
);
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (server.exitCode !== null)
      throw new Error("Packaged consumer server exited before verification.");
    try {
      ready = (await fetch("http://127.0.0.1:4176")).ok;
    } catch {
      /* Wait for the process we just started. */
    }
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error("Packaged consumer server did not become ready.");
  run(
    process.execPath,
    [
      path.join(root, "scripts/verify-consumer-browser.mjs"),
      "http://127.0.0.1:4176",
    ],
    root,
  );
} finally {
  server.kill();
}
run(
  process.execPath,
  [path.join(root, "scripts/verify-dom-consumer.mjs"), consumer],
  root,
);
await writeFile(
  path.join(root, ".build/package-verification.json"),
  JSON.stringify(
    {
      passed: true,
      startedAt,
      completedAt: new Date().toISOString(),
      consumer: ".cache/package-consumer",
      packages: names,
      framework: "Next.js 16.3.8",
      installation: "npm from Yarn-generated tarballs",
      sourceAliases: false,
    },
    null,
    2,
  ),
);
console.log("Isolated npm consumer build passed.");
