import { writeFile, mkdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
const [name, version] = process.argv.slice(2);
if (
  !/^(@[\w.-]+\/)?[\w.-]+$/.test(name ?? "") ||
  !/^\d+\.\d+\.\d+$/.test(version ?? "")
)
  throw new Error("Provide a pinned npm name and version.");
const response = await fetch(
  `https://registry.npmjs.org/${encodeURIComponent(name)}/${version}`,
);
if (!response.ok) throw new Error("Registry metadata unavailable.");
const metadata = await response.json();
const repository = metadata.repository?.url?.match(
  /github\.com\/([^?#]+?)(?:\.git)?$/,
)?.[1];
if (!repository || !/^[a-f0-9]{40}$/.test(metadata.gitHead ?? ""))
  throw new Error("Pinned repository commit unavailable.");
let source, license;
for (const name of [
  "LICENSE",
  "LICENSE.md",
  "LICENCE",
  "LICENSE.txt",
  "LICENCE.md",
]) {
  const url = `https://raw.githubusercontent.com/${repository}/${metadata.gitHead}/${name}`;
  const response = await fetch(url);
  if (response.ok) {
    source = url;
    license = response;
    break;
  }
}
let text,
  basis = "Pinned source license file";
if (license) text = await license.text();
else {
  if (metadata.license !== "MIT")
    throw new Error("Pinned source LICENSE unavailable.");
  const terms = await fetch(
    "https://raw.githubusercontent.com/spdx/license-list-data/v3.27.0/text/MIT.txt",
  );
  if (!terms.ok) throw new Error("Standard MIT terms unavailable.");
  const installed = fileURLToPath(
    new URL(`../node_modules/${name}/`, import.meta.url),
  );
  text = `The npm release declares MIT; no standalone license file was included. Original metadata and README are retained below.\n\n${await readFile(path.join(installed, "package.json"), "utf8")}\n\n${await readFile(path.join(installed, "README.md"), "utf8")}\n\nStandard MIT terms (SPDX v3.27.0; copyright placeholders are not new claims):\n${await terms.text()}`;
  source = `https://registry.npmjs.org/${encodeURIComponent(name)}/${version}`;
  basis =
    "Release metadata, original attribution and standard MIT terms; no standalone license file";
}
const output = fileURLToPath(new URL("../third_party/npm/", import.meta.url));
await mkdir(output, { recursive: true });
const key = `${name.replaceAll("/", "_")}@${version}`;
await writeFile(path.join(output, `${key}.txt`), text);
await writeFile(
  path.join(output, `${key}.json`),
  JSON.stringify(
    {
      name,
      version,
      source,
      commit: metadata.gitHead,
      license: metadata.license,
      basis,
      sha256: createHash("sha256").update(text).digest("hex"),
    },
    null,
    2,
  ) + "\n",
);
console.log(`Retained ${name}@${version} LICENSE from its npm release commit.`);
