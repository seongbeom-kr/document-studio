import { cp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export async function prepareRhwpObservation(target) {
  const file = path.join(target, "index.html");
  const html = await readFile(file, "utf8");
  if (!html.includes('src="./document-studio-boot.js"'))
    await writeFile(
      file,
      html.replace(
        /<head([^>]*)>/i,
        '<head$1><script src="./document-studio-boot.js"></script>',
      ),
    );
  await cp(
    new URL(
      "../packages/engine-rhwp/assets/document-studio-boot.js",
      import.meta.url,
    ),
    path.join(target, "document-studio-boot.js"),
  );
}
