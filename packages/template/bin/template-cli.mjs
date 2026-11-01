#!/usr/bin/env node
import { webcrypto } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import {
  inspectTemplate,
  renderTemplate,
  verifyTemplateOutput,
} from "../dist/index.js";
if (!globalThis.crypto) globalThis.crypto = webcrypto;
// Only this installed entry runs. Request data never supplies executable code.
try {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== "--input" || args[2] !== "--output")
    throw new Error("REPORT_INVALID_REQUEST");
  const data = await readFile(args[1]);
  if (data.length > 48 * 1024 * 1024)
    throw new Error("REPORT_REQUEST_TOO_LARGE");
  const request = JSON.parse(data.toString("utf8"));
  if (
    !request ||
    typeof request !== "object" ||
    Array.isArray(request) ||
    Object.keys(request).some(
      (k) =>
        ![
          "operation",
          "sourceBase64",
          "format",
          "definition",
          "input",
        ].includes(k),
    )
  )
    throw new Error("REPORT_INVALID_REQUEST");
  if (
    !["inspect", "render"].includes(request.operation) ||
    !["docx", "hwpx"].includes(request.format) ||
    typeof request.sourceBase64 !== "string"
  )
    throw new Error("REPORT_INVALID_REQUEST");
  const source = Buffer.from(request.sourceBase64, "base64");
  if (
    source.toString("base64") !== request.sourceBase64 ||
    !source.length ||
    source.length > 32 * 1024 * 1024
  )
    throw new Error("REPORT_INVALID_SOURCE");
  let result;
  if (request.operation === "inspect")
    result = {
      structure: await inspectTemplate({
        bytes: source,
        format: request.format,
      }),
    };
  else {
    const generated = await renderTemplate({
      bytes: source,
      format: request.format,
      definition: request.definition,
      input: request.input,
    });
    const proof = await verifyTemplateOutput({
      source,
      output: generated.bytes,
      format: request.format,
      definition: request.definition,
      input: request.input,
    });
    result = {
      outputBase64: Buffer.from(generated.bytes).toString("base64"),
      receipt: {
        sourceHash: generated.sourceHash,
        outputHash: generated.outputHash,
        changes: generated.changes,
        ...proof,
      },
    };
  }
  await writeFile(args[3], JSON.stringify(result), { flag: "wx", mode: 0o600 });
} catch (error) {
  const raw = String(error?.code ?? error?.message ?? "REPORT_TEMPLATE_FAILED");
  const code = /^(?:TEMPLATE|REPORT)_[A-Z0-9_]+$/.test(raw)
    ? raw.replace(/^TEMPLATE_/, "REPORT_TEMPLATE_")
    : "REPORT_TEMPLATE_FAILED";
  process.stderr.write(
    JSON.stringify({
      code,
      effect: "none",
      ...(typeof error?.fieldId === "string" ? { fieldId: error.fieldId } : {}),
    }),
  );
  process.exitCode = 1;
}
