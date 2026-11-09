import { readFile } from "node:fs/promises";
import init, { HwpDocument } from "../../third_party/rhwp-core/rhwp.js";
import { renderScenarioV3 } from "./template-v3";
export async function nativeScenarioV3() {
  await init({
    module_or_path: await readFile(
      new URL("../../third_party/rhwp-core/rhwp_bg.wasm", import.meta.url),
    ),
  });
  const doc = HwpDocument.createEmpty();
  let bytes: Uint8Array;
  try {
    doc.createBlankDocument();
    doc.insertParagraph(0, 0);
    doc.insertParagraph(0, 0);
    doc.insertParagraph(0, 0);
    doc.insertText(0, 0, 0, "고정 제목");
    doc.insertText(0, 1, 0, "반복 내용");
    const t = JSON.parse(doc.createTable(0, 2, 0, 3, 2));
    for (let i = 0; i < 6; i++)
      doc.insertTextInCell(0, t.paraIdx, t.controlIdx ?? 0, i, 0, 0, "예시");
    doc.insertText(0, 3, 0, "보호 꼬리말");
    bytes = doc.exportHwpx();
  } finally {
    doc.free();
  }
  return renderScenarioV3("hwpx", undefined, bytes);
}
