import { afterEach, expect, test } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
// The same dependency-free installer runs from an installed package on Node.
// @ts-expect-error Node CLI is deliberately distributed as plain JavaScript.
import { copyRuntime, verifyRuntime } from "../../packages/engine-rhwp/bin/copy-runtime.mjs";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function target() { const root = await mkdtemp(path.join(tmpdir(), "document-studio-runtime-test-")); roots.push(root); return path.join(root, "runtime"); }
test("portable runtime installs without a checkout and an identical retry is idempotent", async () => {
  const dest = await target();
  expect((await copyRuntime("third_party/rhwp-core", dest)).installed).toBe(true);
  expect((await copyRuntime("third_party/rhwp-core", dest)).installed).toBe(false);
  const core = path.join(dest, "third_party/rhwp-core");
  await verifyRuntime(core);
  expect(JSON.parse(await readFile(path.join(core, "package.json"), "utf8")).type).toBe("module");
});
test("a corrupted installed runtime is rejected instead of silently overwritten", async () => {
  const dest = await target(); await copyRuntime("third_party/rhwp-core", dest);
  await writeFile(path.join(dest, "third_party/rhwp-core/rhwp.js"), "corrupt");
  await expect(copyRuntime("third_party/rhwp-core", dest)).rejects.toThrow("mismatch");
  expect(await readFile(path.join(dest, "third_party/rhwp-core/rhwp.js"), "utf8")).toBe("corrupt");
});
