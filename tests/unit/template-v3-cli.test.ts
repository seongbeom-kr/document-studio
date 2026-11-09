import { expect, it } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { renderSourceV3, hashV3 } from "../helpers/template-v3";
import { nativeScenarioV3 } from "../helpers/template-v3-native";
import { inspectTemplate } from "../../packages/template/src/index";
it("accepts v3 inspection while preserving v2 CLI inspection", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "template-v3-cli-"));
  try {
    const bytes = renderSourceV3("docx");
    for (const version of [2, 3]) {
      const request = path.join(root, `request-${version}.json`),
        output = path.join(root, `output-${version}.json`);
      await writeFile(
        request,
        JSON.stringify({
          operation: "inspect",
          sourceBase64: Buffer.from(bytes).toString("base64"),
          format: "docx",
          ...(version === 3
            ? {
                contractVersion: 3,
                identity: {
                  sourceHash: hashV3(bytes),
                  normalizedHash: hashV3(bytes),
                  structureRevision: 1,
                },
              }
            : {}),
        }),
      );
      const result = spawnSync(
        process.execPath,
        [
          fileURLToPath(
            new URL(
              "../../packages/template/bin/template-cli.mjs",
              import.meta.url,
            ),
          ),
          "--input",
          request,
          "--output",
          output,
        ],
        { encoding: "utf8" },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(
        JSON.parse(await readFile(output, "utf8")).structure.schemaVersion,
      ).toBe(version);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("preserves v2 CLI render output and receipt semantics", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "template-v2-cli-"));
  try {
    const bytes = renderSourceV3("docx"),
      structure = await inspectTemplate({ bytes, format: "docx" }),
      request = path.join(root, "request.json"),
      output = path.join(root, "result.json");
    const definition = {
      schemaVersion: 2,
      sourceHash: structure.sourceHash,
      format: "docx",
      fields: [{ id: "text", label: "내용", type: "string", required: true }],
      bindings: [
        { id: "binding", targetId: structure.targets[0]!.id, fieldId: "text" },
      ],
      repeatGroups: [],
      rules: [],
      output: {},
    };
    await writeFile(
      request,
      JSON.stringify({
        operation: "render",
        sourceBase64: Buffer.from(bytes).toString("base64"),
        format: "docx",
        definition,
        input: { text: "새 제목" },
      }),
    );
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(
          new URL(
            "../../packages/template/bin/template-cli.mjs",
            import.meta.url,
          ),
        ),
        "--input",
        request,
        "--output",
        output,
      ],
      { encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
    const data = JSON.parse(await readFile(output, "utf8"));
    expect(data.receipt.structurePreserved).toBe(true);
    expect(data.receipt.outputHash).toBe(
      hashV3(Buffer.from(data.outputBase64, "base64")),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("v3 CLI returns final HWP proof and retains a working copy when final export fails", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "template-v3-cli-"));
  try {
    const scenario = await nativeScenarioV3();
    for (const format of ["hwp", "docx"]) {
      const request = path.join(root, `render-${format}.json`),
        output = path.join(root, `result-${format}.json`);
      await writeFile(
        request,
        JSON.stringify({
          contractVersion: 3,
          operation: "render",
          sourceBase64: Buffer.from(scenario.bytes).toString("base64"),
          format: "hwpx",
          structure: scenario.structure,
          definition: scenario.definition,
          input: scenario.input,
          validatedPlan: scenario.validatedPlan,
          outputFormat: format,
        }),
      );
      const result = spawnSync(
        process.execPath,
        [
          fileURLToPath(
            new URL(
              "../../packages/template/bin/template-cli.mjs",
              import.meta.url,
            ),
          ),
          "--input",
          request,
          "--output",
          output,
        ],
        { encoding: "utf8", timeout: 60000 },
      );
      const data = JSON.parse(await readFile(output, "utf8"));
      if (format === "hwp") {
        expect(result.status, result.stderr).toBe(0);
        expect(data.outputFormat).toBe("hwp");
        expect(data.digest).toBe(
          hashV3(Buffer.from(data.outputBase64, "base64")),
        );
        expect(data.proof.contentLoss.count).toBe(0);
        expect(data.receipt.finalVerified).toBe(true);
      } else {
        expect(result.status).toBe(1);
        expect(JSON.parse(result.stderr).code).toBe(
          "REPORT_OUTPUT_FORMAT_NOT_ALLOWED",
        );
        expect(data.workingBase64).toBeTruthy();
        expect(data.outputBase64).toBeUndefined();
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 60000);
