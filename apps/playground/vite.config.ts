import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { docxPaintPatch } from "../../scripts/docx-paint-patch.mjs";
import { rhwpLifecyclePatch } from "../../scripts/rhwp-lifecycle-patch.mjs";
export default defineConfig({
  root: fileURLToPath(new URL("./", import.meta.url)),
  plugins: [react(), docxPaintPatch(), rhwpLifecyclePatch()],
  optimizeDeps: {
    exclude: [
      "@rhwp/editor",
      "@docx-editor.dev/core",
      "@docx-editor.dev/react",
      "@docx-editor.dev/i18n",
    ],
  },
  resolve: {
    alias: {
      "@document-studio/browser": fileURLToPath(
        new URL("../../packages/browser/src/index.ts", import.meta.url),
      ),
      "@document-studio/core": fileURLToPath(
        new URL("../../packages/core/src/index.ts", import.meta.url),
      ),
      "@document-studio/react": fileURLToPath(
        new URL("../../packages/react/src/index.ts", import.meta.url),
      ),
      "@document-studio/engine-docx": fileURLToPath(
        new URL("../../packages/engine-docx/src/index.tsx", import.meta.url),
      ),
      "@document-studio/engine-rhwp": fileURLToPath(
        new URL("../../packages/engine-rhwp/src/index.tsx", import.meta.url),
      ),
    },
  },
  server: {
    port: 4173,
    strictPort: true,
    fs: { allow: [fileURLToPath(new URL("../../", import.meta.url))] },
    watch: {
      ignored: ["**/.next/**", "**/.cache/**", "**/dist/**", "**/.build/**"],
    },
  },
});
