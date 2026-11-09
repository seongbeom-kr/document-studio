import Ajv2020 from "ajv/dist/2020.js";
import standaloneCode from "ajv/dist/standalone/index.js";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
const root = new URL("../", import.meta.url),
  schemaPath = new URL("packages/template/contracts/v3/bundle.json", root),
  target = new URL("packages/template/src/v3/generated/validators.cjs", root);
const raw = await readFile(schemaPath),
  schema = JSON.parse(raw);
const ajv = new Ajv2020({
  strict: true,
  allErrors: false,
  validateFormats: false,
  ownProperties: true,
  code: { source: true },
});
ajv.addSchema(schema);
const kinds = ["structure", "definition", "plan", "artifact", "result"];
const generated =
  `// Generated from the trusted v3 bundle by scripts/generate-template-v3-validators.mjs.\n// SHA256: ${createHash("sha256").update(raw).digest("hex")}\n` +
  standaloneCode(
    ajv,
    Object.fromEntries(
      kinds.map((kind) => [kind, `${schema.$id}#/$defs/${kind}`]),
    ),
  ) +
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
