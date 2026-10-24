import { readFile, writeFile, mkdir } from "node:fs/promises";
import init, { HwpDocument } from "@rhwp/core";

await init({
  module_or_path: await readFile(
    new URL("../node_modules/@rhwp/core/rhwp_bg.wasm", import.meta.url),
  ),
});
await mkdir(new URL("../apps/playground/public/samples/", import.meta.url), {
  recursive: true,
});
for (const name of ["blank", "sample", "rich", "long"]) {
  const document = new HwpDocument(
    await readFile(new URL(`../fixtures/${name}.hwpx`, import.meta.url)),
  );
  try {
    const bytes = document.exportHwp();
    await writeFile(new URL(`../fixtures/${name}.hwp`, import.meta.url), bytes);
    await writeFile(
      new URL(`../apps/playground/public/samples/${name}.hwp`, import.meta.url),
      bytes,
    );
  } finally {
    document.free();
  }
}
console.log(
  "Generated four original HWP5 fixtures from project-owned HWPX content.",
);
