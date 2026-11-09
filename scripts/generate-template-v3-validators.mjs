import Ajv2020 from "ajv/dist/2020.js";
import standaloneCode from "ajv/dist/standalone/index.js";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
const root = new URL("../", import.meta.url),
  schemaPath = new URL("packages/template/contracts/v3/bundle.json", root),
  target = new URL("packages/template/src/v3/generated/validators.js", root);
const raw = await readFile(schemaPath),
  schema = JSON.parse(raw);
const ajv = new Ajv2020({
  strict: true,
  allErrors: false,
  validateFormats: false,
  ownProperties: true,
  code: { source: true, esm: true },
});
ajv.addSchema(schema);
const kinds = ["structure", "definition", "plan", "artifact", "result"];
// Ajv's ESM output still require()s its runtime helpers. Inline them so the
// module loads unchanged in Vite dev, bundlers, Node and strict-CSP browsers.
const ucs2length = `(function ucs2length(str) {
  const len = str.length;
  let length = 0;
  let pos = 0;
  while (pos < len) {
    length++;
    const value = str.charCodeAt(pos++);
    if (value >= 0xd800 && value <= 0xdbff && pos < len && (str.charCodeAt(pos) & 0xfc00) === 0xdc00) pos++;
  }
  return length;
})`;
// Ajv's equal runtime is fast-deep-equal (MIT); embed the installed module unchanged.
const deepEqual = `(function () {
  const module = { exports: {} };
${await readFile(createRequire(createRequire(import.meta.url).resolve("ajv")).resolve("fast-deep-equal"), "utf8")}
  return module.exports;
})()`;
const source = standaloneCode(
  ajv,
  Object.fromEntries(
    kinds.map((kind) => [kind, `${schema.$id}#/$defs/${kind}`]),
  ),
)
  .replaceAll('require("ajv/dist/runtime/ucs2length").default', ucs2length)
  .replaceAll('require("ajv/dist/runtime/equal").default', deepEqual);
if (/\brequire\(/.test(source))
  throw new Error("V3 validators must not require() runtime modules.");
const generated =
  `// Generated from the trusted v3 bundle by scripts/generate-template-v3-validators.mjs.\n// SHA256: ${createHash("sha256").update(raw).digest("hex")}\n` +
  source +
  "\n";
if (process.argv.includes("--check")) {
  if ((await readFile(target, "utf8")) !== generated)
    throw new Error(
      "V3 validators are stale; run node scripts/generate-template-v3-validators.mjs",
    );
} else {
  await mkdir(new URL("./", target), { recursive: true });
  await writeFile(target, generated);
}
