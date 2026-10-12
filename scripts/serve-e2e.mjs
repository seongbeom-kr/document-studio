import { build, preview } from "vite";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { access, readdir } from "node:fs/promises";

// Bundle once so hundreds of browser navigations do not fetch the development module graph.
const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, ".build", "e2e-site");
const configFile = path.join(root, "apps", "playground", "vite.config.ts");
const port = Number(process.argv[process.argv.indexOf("--port") + 1]);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("Provide an explicit test port between 1024 and 65535.");

await import("./prepare-playground.mjs");
const appRoot = path.join(root, "apps", "playground");
const pages = (await readdir(appRoot, { withFileTypes: true }))
  .filter((file) => file.isFile() && file.name.endsWith(".html"))
  .map((file) => file.name);
await build({
  configFile,
  build: {
    outDir: output,
    emptyOutDir: false,
    rolldownOptions: {
      input: Object.fromEntries(
        pages.map((page) => [page, path.join(appRoot, page)]),
      ),
    },
  },
});
for (const page of pages) await access(path.join(output, page));
const server = await preview({
  configFile,
  build: { outDir: output },
  preview: { host: "127.0.0.1", port, strictPort: true },
});
server.printUrls();
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => server.httpServer.close(() => process.exit(0)));
