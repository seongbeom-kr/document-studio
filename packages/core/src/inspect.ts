import { unzipSync, strFromU8 } from "fflate";
import { validateDocumentArchive } from "./archive";
import type { ExportSnapshot } from "./index";

/** Browser XML inspection of the exported snapshot, not a native page-layout assertion. */
export function inspectExport(snapshot: ExportSnapshot) {
  if (snapshot.format === "hwp")
    throw new Error("HWP 구조 조회에는 편집기의 HWPX 구조 투영이 필요합니다.");
  validateDocumentArchive(snapshot.bytes, snapshot.format);
  const parts = unzipSync(snapshot.bytes, {
    filter: (entry) =>
      snapshot.format === "docx"
        ? entry.name === "word/document.xml"
        : /^Contents\/section\d+\.xml$/.test(entry.name),
  });
  const tables: {
    address: string;
    rows: number;
    columns: number;
    cells: {
      row: number;
      column: number;
      rowSpan: number | null;
      columnSpan: number;
      text: string;
      verticalMerge?: string;
    }[];
  }[] = [];
  const images: {
    address: string;
    widthMm: number | null;
    heightMm: number | null;
    alt: string;
  }[] = [];
  const pages: { part: string; widthMm: number; heightMm: number }[] = [];
  let truncated = false;
  const all = (node: Element | Document, name: string) =>
    Array.from(node.getElementsByTagNameNS("*", name));
  const attr = (node: Element | undefined, name: string) =>
    node &&
    Array.from(node.attributes).find(
      (attribute) => attribute.localName === name,
    )?.value;
  const direct = (node: Element, name: string) =>
    Array.from(node.children).filter((child) => child.localName === name);
  const count = (value: string | undefined, fallback: number, minimum = 0) => {
    if (value === undefined) return fallback;
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < minimum)
      throw new Error("문서의 표 크기·셀 주소·병합 정보를 읽지 못했습니다.");
    return parsed;
  };
  const bounded = (value: string) => {
    if (value.length > 2000) truncated = true;
    return value.slice(0, 2000);
  };
  // A nested table has its own address and text; do not duplicate it in its parent cell.
  const cellText = (cell: Element) => {
    const pending = Array.from(cell.children).reverse();
    let text = "";
    while (pending.length) {
      const node = pending.pop()!;
      if (node.localName === "tbl") continue;
      if (node.localName === "t") {
        const value = node.textContent ?? "";
        if (text.length + value.length > 2000) {
          truncated = true;
          return (text + value).slice(0, 2000);
        }
        text += value;
      } else {
        for (let index = node.children.length - 1; index >= 0; index--)
          pending.push(node.children[index]!);
      }
    }
    return text;
  };
  for (const [part, bytes] of Object.entries(parts).sort(([a], [b]) =>
    a.localeCompare(b, undefined, { numeric: true }),
  )) {
    const xml = strFromU8(bytes);
    if (/<!DOCTYPE|<!ENTITY/i.test(xml))
      throw new Error("문서 XML 선언을 지원하지 않습니다.");
    const document = new DOMParser().parseFromString(xml, "application/xml");
    if (all(document, "parsererror").length)
      throw new Error("내보낸 문서 XML을 읽지 못했습니다.");
    const nativeTables = all(document, "tbl");
    nativeTables.forEach((table, index) => {
      if (tables.length >= 100) {
        truncated = true;
        return;
      }
      const rows = direct(table, "tr");
      const cells: (typeof tables)[number]["cells"] = [];
      const grid = direct(table, "tblGrid")[0];
      let columns = count(
        attr(table, "colCnt"),
        grid ? direct(grid, "gridCol").length : 0,
      );
      let rowCount = count(attr(table, "rowCnt"), rows.length);
      rows.forEach((row, rowIndex) => {
        const rowProperties = direct(row, "trPr")[0];
        let column = count(
          attr(rowProperties && direct(rowProperties, "gridBefore")[0], "val"),
          0,
        );
        for (const cell of direct(row, "tc")) {
          const properties = direct(cell, "tcPr")[0];
          const span = direct(cell, "cellSpan")[0];
          const columnSpan = count(
            attr(properties && direct(properties, "gridSpan")[0], "val") ??
              attr(span, "colSpan"),
            1,
            1,
          );
          const merge = properties && direct(properties, "vMerge")[0];
          const address = direct(cell, "cellAddr")[0];
          const cellRow = count(attr(address, "rowAddr"), rowIndex);
          const cellColumn = count(attr(address, "colAddr"), column);
          const rowSpan =
            snapshot.format === "hwpx"
              ? count(attr(span, "rowSpan"), 1, 1)
              : merge
                ? null
                : 1;
          if (cells.length < 2000)
            cells.push({
              row: cellRow,
              column: cellColumn,
              columnSpan,
              rowSpan,
              ...(merge
                ? { verticalMerge: attr(merge, "val") ?? "continue" }
                : {}),
              text: cellText(cell),
            });
          else truncated = true;
          column = cellColumn + columnSpan;
          columns = Math.max(columns, column);
          rowCount = Math.max(rowCount, cellRow + (rowSpan ?? 1));
        }
        columns = Math.max(
          columns,
          column +
            count(
              attr(
                rowProperties && direct(rowProperties, "gridAfter")[0],
                "val",
              ),
              0,
            ),
        );
      });
      tables.push({
        address: `${part}#table:${index}`,
        rows: rowCount,
        columns,
        cells,
      });
    });
    const nativeImages = all(
      document,
      snapshot.format === "docx" ? "drawing" : "pic",
    );
    nativeImages.forEach((image, index) => {
      if (images.length >= 100) {
        truncated = true;
        return;
      }
      const extent = all(
        image,
        snapshot.format === "docx" ? "extent" : "curSz",
      )[0];
      const props = all(image, "docPr")[0];
      const divisor = snapshot.format === "docx" ? 36000 : 7200 / 25.4;
      const width = attr(extent, snapshot.format === "docx" ? "cx" : "width");
      const height = attr(extent, snapshot.format === "docx" ? "cy" : "height");
      images.push({
        address: `${part}#image:${index}`,
        widthMm: width ? Number(width) / divisor : null,
        heightMm: height ? Number(height) / divisor : null,
        alt: bounded(
          attr(props, "descr") ??
            all(image, "shapeComment")[0]?.textContent ??
            "",
        ),
      });
    });
    for (const page of all(
      document,
      snapshot.format === "docx" ? "pgSz" : "pagePr",
    )) {
      const divisor = snapshot.format === "docx" ? 1440 / 25.4 : 7200 / 25.4;
      const width = Number(
        attr(page, snapshot.format === "docx" ? "w" : "width"),
      );
      const height = Number(
        attr(page, snapshot.format === "docx" ? "h" : "height"),
      );
      if (pages.length < 100)
        pages.push({
          part,
          widthMm: width / divisor,
          heightMm: height / divisor,
        });
      else truncated = true;
    }
  }
  return {
    revision: snapshot.revision,
    format: snapshot.format,
    tables,
    images,
    pages,
    truncated,
    scope: "exported-body-structure" as const,
    limitations: [
      "머리말·꼬리말·각주 구조와 글자 서식은 제외",
      "실제 페이지 배치·인쇄 결과는 검증하지 않음",
      "DOCX 세로 병합은 원본 merge 상태로 반환; rowSpan은 미확정",
      "셀 텍스트는 해당 셀의 텍스트만 연결하며 중첩 표 텍스트는 별도 표에 반환",
      "주소는 이 내보내기 snapshot에서만 유효",
    ],
  };
}
