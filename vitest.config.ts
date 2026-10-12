import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { include: ["tests/unit/**/*.test.ts"], environment: "node" },
  resolve: {
    alias: {
      "@document-studio/core": new URL(
        "./packages/core/src/index.ts",
        import.meta.url,
      ).pathname,
    },
  },
});
