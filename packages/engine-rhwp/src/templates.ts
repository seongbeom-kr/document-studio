import init, { HwpDocument } from "@rhwp/core";
import {
  validateTemplate,
  validateCommand,
  type DocumentTemplate,
  type EditorDocument,
} from "@document-studio/core";
let initialization: Promise<unknown> | undefined;
export async function createHwpxDocument(
  template: DocumentTemplate,
  studioUrl: string,
): Promise<EditorDocument> {
  validateTemplate(template);
  if (template.page) validateCommand({ id: "pageSetup", value: template.page });
  const base = new URL(studioUrl, window.location.href);
  const response = await fetch(new URL("provenance.json", base));
  if (!response.ok) throw new Error("HWPX 자산 정보를 읽지 못했습니다.");
  const metadata = (await response.json()) as {
    version: string;
    wasmFile?: string;
  };
  if (
    metadata.version !== "0.8.6" ||
    !metadata.wasmFile ||
    !/^assets\/rhwp_bg-[\w-]+\.wasm$/.test(metadata.wasmFile)
  )
    throw new Error("HWPX 자산 버전 또는 경로가 올바르지 않습니다.");
  initialization ??= init({
    module_or_path: new URL(metadata.wasmFile, base),
  }).catch((cause) => {
    initialization = undefined;
    throw cause;
  });
  await initialization;
  const document = HwpDocument.createEmpty();
  document.createBlankDocument();
  const requireSuccess = (raw: string) => {
    const result = JSON.parse(raw) as { ok: boolean };
    if (!result.ok) throw new Error("문서 서식을 생성하지 못했습니다.");
  };
  try {
    const page = template.page;
    if (page) {
      const current = JSON.parse(document.getPageDef(0));
      requireSuccess(
        document.setPageDef(
          0,
          JSON.stringify({
            ...current,
            width: Math.round((page.widthMm * 7200) / 25.4),
            height: Math.round((page.heightMm * 7200) / 25.4),
            marginTop: Math.round((page.topMm * 7200) / 25.4),
            marginBottom: Math.round((page.bottomMm * 7200) / 25.4),
            marginLeft: Math.round((page.leftMm * 7200) / 25.4),
            marginRight: Math.round((page.rightMm * 7200) / 25.4),
            landscape: page.orientation === "landscape",
          }),
        ),
      );
    }
    let paragraph = 0;
    for (const [index, block] of template.blocks.entries()) {
      if (index) {
        // RHWP inserts BEFORE the given index; using the current index shifts the
        // preceding text forward and concatenates the next block with it.
        requireSuccess(document.insertParagraph(0, paragraph + 1));
        paragraph++;
      }
      if (block.kind === "table") {
        const table = JSON.parse(
          document.createTable(
            0,
            paragraph,
            0,
            block.rows.length,
            block.rows[0]!.length,
          ),
        ) as { ok: boolean; paraIdx: number; controlIdx: number };
        if (!table.ok) throw new Error("서식의 표를 만들지 못했습니다.");
        for (const [row, values] of block.rows.entries())
          for (const [column, text] of values.entries()) {
            if (text)
              requireSuccess(
                document.insertTextInCell(
                  0,
                  table.paraIdx,
                  table.controlIdx,
                  row * values.length + column,
                  0,
                  0,
                  text,
                ),
              );
            if (row === 0)
              requireSuccess(
                document.setCellProperties(
                  0,
                  table.paraIdx,
                  table.controlIdx,
                  column,
                  JSON.stringify({ fillType: "solid", fillColor: "#e8eef4" }),
                ),
              );
          }
        paragraph = table.paraIdx;
      } else {
        if (block.text)
          requireSuccess(document.insertText(0, paragraph, 0, block.text));
        requireSuccess(
          document.applyParaFormat(
            0,
            paragraph,
            JSON.stringify({
              lineSpacing: 160,
              lineSpacingType: "Percent",
              spacingAfter: 600,
              keepWithNext: block.kind === "heading",
              ...(block.kind === "bullet"
                ? {
                    headType: "Bullet",
                    numberingId: document.ensureDefaultBullet("●"),
                    paraLevel: 0,
                  }
                : {}),
              ...(block.kind === "numbered"
                ? {
                    headType: "Number",
                    numberingId: document.ensureDefaultNumbering(),
                    paraLevel: 0,
                  }
                : {}),
            }),
          ),
        );
        if (block.text)
          requireSuccess(
            document.applyCharFormat(
              0,
              paragraph,
              0,
              [...block.text].length,
              JSON.stringify({
                fontSize:
                  block.kind === "heading"
                    ? Math.max(12, 20 - block.level * 2) * 100
                    : 1200,
                bold: block.kind === "heading",
              }),
            ),
          );
      }
    }
    return {
      id: crypto.randomUUID(),
      version: crypto.randomUUID(),
      fileName: template.fileName.replace(/\.(docx|hwpx|hwp)$/i, "") + ".hwpx",
      format: "hwpx",
      bytes: document.exportHwpx(),
    };
  } finally {
    document.free();
  }
}
