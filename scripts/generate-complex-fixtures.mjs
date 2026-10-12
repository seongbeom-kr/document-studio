// Owned Apache-2.0 corpus: extend our generated rich fixture; no external documents.
import { readFile, writeFile, cp } from "node:fs/promises";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
const zip = unzipSync(
  new Uint8Array(
    await readFile(new URL("../fixtures/rich.docx", import.meta.url)),
  ),
);
const body = strFromU8(zip["word/document.xml"]);
const annotation =
  '<w:p><w:r><w:t xml:space="preserve">필드와 각주 보존: </w:t></w:r><w:fldSimple w:instr=" DATE \\@ &quot;yyyy.MM.dd&quot; "><w:r><w:t>2026.10.06</w:t></w:r></w:fldSimple><w:r><w:footnoteReference w:id="1"/></w:r></w:p>';
zip["word/document.xml"] = strToU8(
  body.replace("<w:sectPr", `${annotation}<w:sectPr`),
);
zip["word/footnotes.xml"] = strToU8(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote><w:footnote w:id="1"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:t>자체 제작 각주 보존 문구</w:t></w:r></w:p></w:footnote></w:footnotes>',
);
const relationships=strFromU8(zip["word/_rels/document.xml.rels"]);
if(!relationships.includes('/relationships/footnotes')) zip["word/_rels/document.xml.rels"] = strToU8(
  relationships.replace(
    "</Relationships>",
    '<Relationship Id="rIdStudioFootnote" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/></Relationships>',
  ),
);
const types=strFromU8(zip["[Content_Types].xml"]);
if(!types.includes('PartName="/word/footnotes.xml"')) zip["[Content_Types].xml"] = strToU8(
  types.replace(
    "</Types>",
    '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/></Types>',
  ),
);
await writeFile(
  new URL("../fixtures/complex.docx", import.meta.url),
  zipSync(zip),
);
await cp(
  new URL("../fixtures/complex.docx", import.meta.url),
  new URL("../apps/playground/public/samples/complex.docx", import.meta.url),
);
console.log(
  "Owned DOCX corpus: merged table, image, headers, footers, field and footnote.",
);
