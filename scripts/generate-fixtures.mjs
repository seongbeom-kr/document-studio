import { mkdir, readFile, writeFile, cp, readdir } from "node:fs/promises";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  Header,
  Footer,
  ImageRun,
} from "docx";
import init, { HwpDocument } from "@rhwp/core";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const fixtures = fileURLToPath(new URL("../fixtures/", import.meta.url));
await mkdir(fixtures, { recursive: true });
const document = new Document({
  creator: "Document Studio",
  title: "공개 편집 검증 문서",
  sections: [
    {
      children: [
        new Paragraph({
          children: [
            new TextRun({ text: "공개 편집 검증 문서", bold: true, size: 32 }),
          ],
        }),
        new Paragraph("한국어 문장을 편집하고 저장한 뒤 다시 열어 확인합니다."),
        new Paragraph(
          "표와 본문의 서식은 편집하지 않은 부분에서 유지되어야 합니다.",
        ),
        new Table({
          rows: [
            new TableRow({
              children: [
                new TableCell({ children: [new Paragraph("항목")] }),
                new TableCell({ children: [new Paragraph("내용")] }),
              ],
            }),
            new TableRow({
              children: [
                new TableCell({ children: [new Paragraph("검증")] }),
                new TableCell({
                  children: [new Paragraph("한글 입력과 원본 저장")],
                }),
              ],
            }),
          ],
        }),
      ],
    },
  ],
});
await writeFile(
  new URL("../fixtures/sample.docx", import.meta.url),
  await Packer.toBuffer(document),
);
await init({
  module_or_path: await readFile(
    new URL("../node_modules/@rhwp/core/rhwp_bg.wasm", import.meta.url),
  ),
});
const hwpx = HwpDocument.createEmpty();
hwpx.createBlankDocument();
hwpx.insertText(
  0,
  0,
  0,
  "공개 편집 검증 문서 — 한국어 문장을 편집하고 저장한 뒤 다시 열어 확인합니다.",
);
await writeFile(
  new URL("../fixtures/sample.hwpx", import.meta.url),
  hwpx.exportHwpx(),
);
hwpx.free();
const picturePixels = new PNG({ width: 32, height: 24 });
for (let index = 0; index < picturePixels.data.length; index += 4) {
  picturePixels.data[index] = 30;
  picturePixels.data[index + 1] = 120;
  picturePixels.data[index + 2] = 180;
  picturePixels.data[index + 3] = 255;
}
const image = new Uint8Array(PNG.sync.write(picturePixels));
const richDocx = new Document({
  title: "복합 구조 검증 문서",
  creator: "Document Studio",
  sections: [
    {
      headers: {
        default: new Header({ children: [new Paragraph("머리말 보존 검증")] }),
      },
      footers: {
        default: new Footer({ children: [new Paragraph("꼬리말 보존 검증")] }),
      },
      children: [
        new Paragraph({
          children: [
            new TextRun({ text: "복합 구조 검증", bold: true, size: 36 }),
          ],
        }),
        new Paragraph({
          children: [
            new ImageRun({
              type: "png",
              data: image,
              transformation: { width: 48, height: 48 },
              altText: {
                title: "합성 그림",
                description: "자체 생성 테스트 이미지",
                name: "fixture",
              },
            }),
          ],
        }),
        new Table({
          rows: [
            new TableRow({
              children: [
                new TableCell({
                  columnSpan: 2,
                  children: [new Paragraph("병합 셀 검증")],
                }),
              ],
            }),
            new TableRow({
              children: [
                new TableCell({ children: [new Paragraph("왼쪽 셀")] }),
                new TableCell({ children: [new Paragraph("오른쪽 셀")] }),
              ],
            }),
          ],
        }),
        ...Array.from(
          { length: 40 },
          (_, i) =>
            new Paragraph({
              spacing: { line: 360, after: 120 },
              children: [
                new TextRun({
                  text: `문단 ${i + 1}: 한국어와 English, 숫자 123, 기호 & < >, 줄바꿈과 페이지를 검증합니다.`,
                  italics: i % 3 === 0,
                  color: i % 2 === 0 ? "245F56" : "222222",
                  size: 24,
                }),
              ],
            }),
        ),
      ],
    },
  ],
});
await writeFile(
  new URL("../fixtures/rich.docx", import.meta.url),
  await Packer.toBuffer(richDocx),
);
const richHwpx = HwpDocument.createEmpty();
richHwpx.createBlankDocument();
richHwpx.insertText(0, 0, 0, "복합 구조 검증 문서");
const picture = JSON.parse(
  richHwpx.insertPicture(
    0,
    0,
    0,
    "",
    image,
    3600,
    3600,
    32,
    24,
    "png",
    "합성 이미지",
  ),
);
if (!picture.ok) throw new Error("Could not generate HWPX image fixture.");
const table = JSON.parse(richHwpx.createTable(0, 0, 1, 2, 2));
if (!table.ok) throw new Error("Could not generate HWPX table fixture.");
const tableControl = table.controlIdx ?? table.controlIndex ?? 1;
for (let cell = 0; cell < 4; cell++)
  richHwpx.insertTextInCell(
    0,
    table.paraIdx,
    tableControl,
    cell,
    0,
    0,
    `표 셀 ${cell + 1}`,
  );
for (let i = 1; i <= 30; i++) {
  richHwpx.insertParagraph(0, i - 1);
  richHwpx.insertText(
    0,
    i,
    0,
    `문단 ${i}: 한국어와 English, 숫자 123, 기호 & < >를 검증합니다.`,
  );
  richHwpx.applyParaFormat(
    0,
    i,
    JSON.stringify({ lineSpacing: 160, lineSpacingType: "Percent" }),
  );
}
await writeFile(
  new URL("../fixtures/rich.hwpx", import.meta.url),
  richHwpx.exportHwpx(),
);
richHwpx.free();
const blankHwpx = HwpDocument.createEmpty();
blankHwpx.createBlankDocument();
await writeFile(
  new URL("../fixtures/blank.hwpx", import.meta.url),
  blankHwpx.exportHwpx(),
);
blankHwpx.free();
const corpus = {
  unicode: [
    "한글 · English · 日本語 · العربية · 😀🚀 · é · 가족 👨‍👩‍👧‍👦",
    "cat concatenate cat · CAT · catalog",
    "특수 기호 & < > \" ' 와 줄 끝 공백  ",
    "원본 보존 끝 문단",
  ],
  long: Array.from(
    { length: 200 },
    (_, i) =>
      `업무 문단 ${i + 1}: 신청인과 검토 의견, 금액 ${i * 1234}원, 날짜 2026-10-05를 확인합니다.`,
  ),
};
for (const [kind, texts] of Object.entries(corpus)) {
  await writeFile(
    new URL(`../fixtures/${kind}.docx`, import.meta.url),
    await Packer.toBuffer(
      new Document({
        creator: "Document Studio",
        sections: [
          {
            children: texts.map(
              (text, i) =>
                new Paragraph({
                  spacing: { line: i % 2 ? 300 : 384, after: 100 },
                  children: [
                    new TextRun({ text, bold: i % 2 === 0, color: "245F56" }),
                  ],
                }),
            ),
          },
        ],
      }),
    ),
  );
  const native = HwpDocument.createEmpty();
  native.createBlankDocument();
  for (const [index, text] of texts.entries()) {
    if (index) native.insertParagraph(0, index - 1);
    native.insertText(0, index, 0, text);
    native.applyParaFormat(
      0,
      index,
      JSON.stringify({
        lineSpacing: index % 2 ? 125 : 160,
        lineSpacingType: "Percent",
      }),
    );
  }
  await writeFile(
    new URL(`../fixtures/${kind}.hwpx`, import.meta.url),
    native.exportHwpx(),
  );
  native.free();
}
const nested = new Table({
  rows: [
    new TableRow({
      children: [
        new TableCell({
          children: [
            new Paragraph("외부 셀"),
            new Table({
              rows: [
                new TableRow({
                  children: [
                    new TableCell({
                      children: [new Paragraph("중첩 표 보존 텍스트")],
                    }),
                    new TableCell({ children: [new Paragraph("안쪽 셀")] }),
                  ],
                }),
              ],
            }),
            new Paragraph("셀 끝"),
          ],
        }),
        new TableCell({ children: [new Paragraph("외부 오른쪽 셀")] }),
      ],
    }),
  ],
});
await writeFile(
  new URL("../fixtures/nested.docx", import.meta.url),
  await Packer.toBuffer(
    new Document({
      sections: [
        {
          children: [
            new Paragraph("중첩 구조 검증"),
            nested,
            new Paragraph("표 뒤 본문"),
          ],
        },
      ],
    }),
  ),
);
await writeFile(
  new URL("../fixtures/blank.docx", import.meta.url),
  await Packer.toBuffer(
    new Document({ sections: [{ children: [new Paragraph("")] }] }),
  ),
);
await mkdir(new URL("../apps/playground/public/samples/", import.meta.url), {
  recursive: true,
});
for (const name of (await readdir(fixtures)).filter((name) =>
  /\.(docx|hwpx)$/.test(name),
))
  await cp(
    new URL(`../fixtures/${name}`, import.meta.url),
    new URL(`../apps/playground/public/samples/${name}`, import.meta.url),
  );
console.log("Generated original, redistributable DOCX and HWPX fixtures.");
