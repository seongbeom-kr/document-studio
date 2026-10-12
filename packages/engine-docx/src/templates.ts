import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  HeadingLevel,
  WidthType,
} from "docx";
import {
  validateTemplate,
  validateCommand,
  type DocumentTemplate,
  type EditorDocument,
} from "@document-studio/core";
import { mmToTwips } from "./commands";
export async function createDocxDocument(
  template: DocumentTemplate,
): Promise<EditorDocument> {
  validateTemplate(template);
  if (template.page) validateCommand({ id: "pageSetup", value: template.page });
  const paragraph = (text: string) =>
    new Paragraph({
      children: [new TextRun({ text, font: "Arial", size: 24 })],
      spacing: { line: 384, after: 120 },
    });
  const children = template.blocks.map((block) => {
    if (block.kind === "table")
      return new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: block.rows.map(
          (row, index) =>
            new TableRow({
              children: row.map(
                (text) =>
                  new TableCell({
                    children: [paragraph(text)],
                    shading: index === 0 ? { fill: "E8EEF4" } : undefined,
                  }),
              ),
            }),
        ),
      });
    if (block.kind === "heading")
      return new Paragraph({
        text: block.text,
        heading: (
          [
            HeadingLevel.HEADING_1,
            HeadingLevel.HEADING_2,
            HeadingLevel.HEADING_3,
            HeadingLevel.HEADING_4,
            HeadingLevel.HEADING_5,
            HeadingLevel.HEADING_6,
          ] as const
        )[Math.max(0, Math.min(5, block.level - 1))],
        spacing: { before: 180, after: 120 },
        keepNext: true,
      });
    if (block.kind === "bullet")
      return new Paragraph({
        text: block.text,
        bullet: { level: 0 },
        spacing: { line: 384, after: 80 },
      });
    if (block.kind === "numbered")
      return new Paragraph({
        text: block.text,
        numbering: { reference: "report-numbers", level: 0 },
        spacing: { line: 384, after: 80 },
      });
    return paragraph(block.text);
  });
  const page = template.page;
  const document = new Document({
    creator: "Document Studio",
    title: template.title,
    numbering: {
      config: [
        {
          reference: "report-numbers",
          levels: [
            {
              level: 0,
              format: "decimal",
              text: "%1.",
              alignment: "left",
              style: { paragraph: { indent: { left: 360, hanging: 180 } } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: page
          ? {
              page: {
                size: {
                  // docx's landscape constructor swaps its input dimensions.
                  width: mmToTwips(
                    page.orientation === "landscape"
                      ? page.heightMm
                      : page.widthMm,
                  ),
                  height: mmToTwips(
                    page.orientation === "landscape"
                      ? page.widthMm
                      : page.heightMm,
                  ),
                  orientation: page.orientation,
                },
                margin: {
                  top: mmToTwips(page.topMm),
                  bottom: mmToTwips(page.bottomMm),
                  left: mmToTwips(page.leftMm),
                  right: mmToTwips(page.rightMm),
                },
              },
            }
          : undefined,
        children: children.length ? children : [paragraph("")],
      },
    ],
  });
  const bytes = new Uint8Array(await Packer.toArrayBuffer(document));
  return {
    id: crypto.randomUUID(),
    version: crypto.randomUUID(),
    fileName: template.fileName.replace(/\.(docx|hwpx)$/i, "") + ".docx",
    format: "docx",
    bytes,
  };
}
