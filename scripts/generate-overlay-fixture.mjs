// Original synthetic content; no customer document or upstream sample is copied.
import { readFile, writeFile } from "node:fs/promises";
import init, { HwpDocument } from "@rhwp/core";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { PNG } from "pngjs";

await init({
  module_or_path: await readFile(
    new URL("../node_modules/@rhwp/core/rhwp_bg.wasm", import.meta.url),
  ),
});
const pixels = new PNG({ width: 80, height: 12 });
for (let i = 0; i < pixels.data.length; i += 4)
  pixels.data.set([20, 180, 50, 255], i);
const doc = HwpDocument.createEmpty();
try {
  doc.createBlankDocument();
  const table = JSON.parse(doc.createTable(0, 0, 0, 1, 1));
  if (!table.ok) throw new Error("Synthetic table creation failed.");
  doc.insertTextInCell(0, 0, table.controlIdx, 0, 0, 0, "합성 제목 테스트");
  const picture = JSON.parse(
    doc.insertPicture(
      0,
      0,
      8,
      "",
      PNG.sync.write(pixels),
      18000,
      1800,
      80,
      12,
      "png",
      "paragraph anchor marker",
    ),
  );
  if (!picture.ok) throw new Error("Synthetic picture creation failed.");
  const parts = unzipSync(doc.exportHwpx());
  let xml = strFromU8(parts["Contents/section0.xml"]);
  xml = xml.replace(/<hp:tbl\b[\s\S]*?<\/hp:tbl>/, (tableXml) =>
    tableXml.replace(
      /(<hp:pos\b[^>]*\btreatAsChar=")0"/,
      (_, prefix) => `${prefix}1"`,
    ),
  );
  xml = xml.replace(/<hp:pic\b[\s\S]*?<\/hp:pic>/, (picXml) =>
    picXml
      .replace('textWrap="SQUARE"', 'textWrap="IN_FRONT_OF_TEXT"')
      .replace('vertRelTo="PAPER"', 'vertRelTo="PARA"')
      .replace('horzRelTo="PAPER"', 'horzRelTo="PARA"')
      .replace('vertOffset="0"', 'vertOffset="-2000"')
      .replace('horzOffset="0"', 'horzOffset="1000"'),
  );
  if (!xml.includes('treatAsChar="1"') || !xml.includes('vertOffset="-2000"'))
    throw new Error("Synthetic source contract changed.");
  parts["Contents/section0.xml"] = strToU8(xml);
  await writeFile(
    new URL("../fixtures/paragraph-overlay.hwpx", import.meta.url),
    zipSync(parts),
  );
} finally {
  doc.free();
}
