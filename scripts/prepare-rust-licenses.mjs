import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { permittedLicense } from "./license-policy.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
const lock = await readFile(
  path.join(root, ".cache/rhwp-source/Cargo.lock"),
  "utf8",
);
const packages = lock
  .split("[[package]]")
  .slice(1)
  .map((entry) =>
    Object.fromEntries(
      [...entry.matchAll(/^(name|version|source|checksum) = "([^"]+)"$/gm)].map(
        (m) => [m[1], m[2]],
      ),
    ),
  )
  .filter((p) => p.source);
const cache = path.join(root, ".cache/crate-licenses"),
  output = path.join(root, "third_party/rust");
await mkdir(cache, { recursive: true });
await mkdir(output, { recursive: true });
const results = [];
let cursor = 0;
async function worker() {
  while (cursor < packages.length) {
    const p = packages[cursor++],
      key = `${p.name}-${p.version}`;
    const git =
      /^git\+https:\/\/github\.com\/([\w.-]+\/[\w.-]+)(?:\?[^#]+)?#([a-f0-9]{40})$/.exec(
        p.source,
      );
    if ((!p.source.startsWith("registry+") || !p.checksum) && !git)
      throw new Error(`Unverified crate source: ${key}`);
    const downloadUrl = git
      ? `https://codeload.github.com/${git[1]}/tar.gz/${git[2]}`
      : `https://static.crates.io/crates/${p.name}/${key}.crate`;
    const cachePath = path.join(cache, `${key}.crate`);
    let compressed;
    try {
      compressed = await readFile(cachePath);
    } catch {}
    if (
      !compressed?.length ||
      (!git &&
        createHash("sha256").update(compressed).digest("hex") !== p.checksum)
    ) {
      const response = await fetch(downloadUrl);
      if (!response.ok) throw new Error(`${key}: HTTP ${response.status}`);
      compressed = Buffer.from(await response.arrayBuffer());
      if (
        !git &&
        createHash("sha256").update(compressed).digest("hex") !== p.checksum
      )
        throw new Error(`Downloaded crate checksum mismatch: ${key}`);
      await writeFile(cachePath, compressed);
    }
    if (
      !git &&
      createHash("sha256").update(compressed).digest("hex") !== p.checksum
    )
      throw new Error(`Crate checksum mismatch: ${key}`);
    const tar = gunzipSync(compressed),
      files = [];
    let manifest, vcs;
    const attribution = [];
    for (let offset = 0; offset + 512 <= tar.length; ) {
      const name = tar
        .subarray(offset, offset + 100)
        .toString()
        .replace(/\0.*$/s, "");
      if (!name) break;
      const size = parseInt(
        tar
          .subarray(offset + 124, offset + 136)
          .toString()
          .replace(/\0.*$/s, "")
          .trim(),
        8,
      );
      const content = tar
        .subarray(offset + 512, offset + 512 + size)
        .toString("utf8");
      const relative = name.slice(name.indexOf("/") + 1);
      if (relative === "Cargo.toml") manifest = content;
      if (relative === ".cargo_vcs_info.json") vcs = JSON.parse(content);
      if (/^README|^AUTHORS$|^src\/lib\.rs$/i.test(relative))
        attribution.push({
          name: relative,
          content: relative.startsWith("src/")
            ? content.split("\n").slice(0, 100).join("\n")
            : content,
        });
      if (
        /^(?:[^/]+\/){0,2}(?:license|licence|copying|notice|copyright)[^/]*$/i.test(
          relative,
        )
      )
        files.push({ name: relative, content });
      offset += 512 + Math.ceil(size / 512) * 512;
    }
    const license = /^license\s*=\s*"([^"]+)"/m.exec(manifest ?? "")?.[1];
    if (!permittedLicense(license))
      throw new Error(`Crate license needs review: ${key} ${license}`);
    if (!files.length) {
      const repository = /^repository\s*=\s*"https:\/\/github\.com\/([^"?#]+)"/m
        .exec(manifest ?? "")?.[1]
        ?.replace(/\.git$/, "");
      const commit = vcs?.git?.sha1;
      if (repository && /^[a-f0-9]{40}$/.test(commit ?? "")) {
        const treeResponse = await fetch(
          `https://api.github.com/repos/${repository}/git/trees/${commit}?recursive=1`,
        );
        const tree = treeResponse.ok ? await treeResponse.json() : { tree: [] };
        const candidates = tree.tree.filter(
          (entry) =>
            entry.type === "blob" &&
            /^(?:[^/]+\/){0,2}(?:license|licence|copying|copyright|unlicense)[^/]*$/i.test(
              entry.path,
            ),
        );
        for (const entry of candidates) {
          const name = entry.path;
          const url = `https://raw.githubusercontent.com/${repository}/${commit}/${name}`;
          const response = await fetch(url);
          if (response.ok)
            files.push({
              name: `repository/${name} (${url})`,
              content: await response.text(),
            });
        }
      }
      if (!files.length) {
        // Some published crates only declare their standard license in Cargo.toml.
        // Retain that declaration and original authors/headers, plus the selected standard terms.
        const chosen = license.includes("Apache-2.0")
          ? "Apache-2.0"
          : license.includes("MIT")
            ? "MIT"
            : license === "CC0-1.0"
              ? "CC0-1.0"
              : undefined;
        if (!chosen) throw new Error(`Crate license text is missing: ${key}`);
        const response = await fetch(
          `https://raw.githubusercontent.com/spdx/license-list-data/v3.27.0/text/${chosen}.txt`,
        );
        if (!response.ok)
          throw new Error(`Standard license text unavailable: ${key}`);
        files.push({
          name: `declared-license-${chosen}.txt`,
          content: `This crate archive declares ${license}; the selected option is ${chosen}. No standalone license file was included. Original authors and notices are retained below.\n\n${manifest}\n\n${attribution.map((file) => `--- ${file.name} ---\n${file.content}`).join("\n\n")}\n\nStandard ${chosen} terms (SPDX license-list-data v3.27.0; copyright placeholders are not new copyright claims):\n${await response.text()}`,
        });
      }
    }
    const text = files
      .map((file) => `--- ${key}/${file.name} ---\n${file.content}`)
      .join("\n\n");
    await writeFile(path.join(output, `${key}.txt`), text);
    results.push({
      name: p.name,
      version: p.version,
      license,
      checksum: p.checksum,
      ...(git
        ? {
            gitCommit: git[2],
            archiveSha256: createHash("sha256")
              .update(compressed)
              .digest("hex"),
          }
        : {}),
      source: git
        ? `https://github.com/${git[1]}/tree/${git[2]}`
        : `https://crates.io/crates/${p.name}/${p.version}`,
      notices: `rust/${key}.txt`,
    });
  }
}
const workers = await Promise.allSettled(Array.from({ length: 6 }, worker));
const failures = workers.filter((worker) => worker.status === "rejected");
if (failures.length)
  throw new AggregateError(
    failures.map((worker) => worker.reason),
    "Crate license preparation failed",
  );
results.sort((a, b) =>
  `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`),
);
await writeFile(
  path.join(root, "third_party/rust-sbom.json"),
  JSON.stringify(
    {
      scope:
        "Conservative inventory of all registry entries in pinned RHWP Cargo.lock; includes optional and native-only crates, not a WASM linker trace.",
      lockSha256: createHash("sha256").update(lock).digest("hex"),
      packages: results,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Verified ${results.length} crate archives and retained their license texts.`,
);
