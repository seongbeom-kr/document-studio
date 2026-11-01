import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  Document,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
} from "docx";
import init, { HwpDocument } from "../third_party/rhwp-core/rhwp.js";

// Public fixtures must exist before Vite copies assets into the static E2E site.
const repeated = "가😀중복 문구";
const directory = new URL(
  "../apps/playground/public/fixtures/",
  import.meta.url,
);
await mkdir(directory, { recursive: true });
const doc = new Document({
  sections: [
    {
      children: [
        new Paragraph("선택 시험 양식"),
        new Paragraph(repeated),
        new Paragraph({
          children: [
            new TextRun("가😀중복"),
            new TextRun({ text: " 문구", bold: true }),
          ],
        }),
        new Table({
          rows: [
            new TableRow({
              children: [
                new TableCell({ children: [new Paragraph("반복 셀")] }),
                new TableCell({ children: [new Paragraph("반복 셀")] }),
              ],
            }),
            new TableRow({
              children: [
                new TableCell({ children: [new Paragraph("")] }),
                new TableCell({ children: [new Paragraph("")] }),
              ],
            }),
          ],
        }),
      ],
    },
  ],
});
await writeFile(
  new URL("template-authoring.docx", directory),
  await Packer.toBuffer(doc),
);
await init({
  module_or_path: await readFile(
    new URL("../third_party/rhwp-core/rhwp_bg.wasm", import.meta.url),
  ),
});
const native = HwpDocument.createEmpty();
try {
  native.createBlankDocument();
  native.insertText(0, 0, 0, "선택 시험 양식");
  for (let i = 1; i <= 3; i++) native.insertParagraph(0, i);
  native.insertText(0, 1, 0, repeated);
  native.insertText(0, 2, 0, repeated);
  const t = JSON.parse(native.createTable(0, 3, 0, 2, 2));
  for (let cell = 0; cell < 2; cell++)
    native.insertTextInCell(
      0,
      t.paraIdx,
      t.controlIdx ?? t.controlIndex ?? 0,
      cell,
      0,
      0,
      "반복 셀",
    );
  await writeFile(
    new URL("template-authoring.hwpx", directory),
    native.exportHwpx(),
  );
} finally {
  native.free();
}
