#!/usr/bin/env node
import { cp, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
export async function copyFontAssets(destination) {
  const source = fileURLToPath(new URL("../dist/fonts/", import.meta.url));
  const manifest = JSON.parse(await readFile(path.join(source, "manifest.json"), "utf8"));
  await mkdir(destination, { recursive: true });
  for (const file of [...manifest.faces.map(face => face.file), ...manifest.supportFiles.map(item => item.file), "manifest.json"]) {
    if (path.basename(file) !== file) throw new Error("Invalid font asset path.");
    await cp(path.join(source, file), path.join(destination, file));
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const destination = path.resolve(process.argv[2] ?? "public/editor-assets/fonts");
  await copyFontAssets(destination);
  console.log("Document Studio font assets copied to", destination);
}
