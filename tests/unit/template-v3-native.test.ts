import { beforeAll, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
let api: typeof import("../../packages/template/src/node");
beforeAll(async () => {
  const url = new URL("../../packages/template/dist/node.js", import.meta.url);
  expect(
    existsSync(url),
    "build:template must provide the separate Node subpath",
  ).toBe(true);
  api = await import(url.href);
});
it("loads only pinned packaged native JS/WASM/fonts and rejects a different profile", async () => {
  const profile = await api.nativeRuntimeProfileV3(),
    runtime = await api.loadNativeRuntime(profile);
  expect(runtime.HwpDocument).toBeTypeOf("function");
  expect(runtime.runtimeProfile).toEqual(profile);
  await expect(
    api.loadNativeRuntime({
      ...profile,
      fontPackDigest: `sha256:${"0".repeat(64)}`,
    }),
  ).rejects.toThrow("REPORT_NATIVE_RUNTIME_MISMATCH");
});
it("keeps Node builtins and the native loader out of the browser entry", async () => {
  const source = await readFile(
    new URL("../../packages/template/dist/index.js", import.meta.url),
    "utf8",
  );
  expect(source).not.toMatch(/from ["']node:|import\(["']node:/);
  expect(source).not.toContain("registerExactFontSource");
});
