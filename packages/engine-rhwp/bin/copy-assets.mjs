#!/usr/bin/env node
import { cp, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
const destination = path.resolve(
  process.cwd(),
  process.argv[2] ?? "public/editor-assets/rhwp",
);
await mkdir(destination, { recursive: true });
await cp(
  fileURLToPath(new URL("../dist/studio/", import.meta.url)),
  destination,
  { recursive: true },
);
console.log("RHWP assets copied to", destination);
