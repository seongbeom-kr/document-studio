import { strToU8, zipSync } from "fflate";
import { createHash } from "node:crypto";
import {
  digestV3,
  inspectTemplateV3,
  regionReviewDigestV3,
  validateRenderPlanV3,
  type TemplateDefinitionV3,
  type RenderPlanV3,
  type RegionDefinitionV3,
  type TemplateFormat,
} from "../../packages/template/src/index";
export const hashV3 = (bytes: Uint8Array) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}` as const;
export const wordNS =
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
export const hpNS = "http://www.hancom.co.kr/hwpml/2011/paragraph";
export function renderSourceV3(format: TemplateFormat) {
  const p = (text: string, id: number) =>
    format === "docx"
      ? `<w:p><w:pPr><w:spacing w:after="120"/></w:pPr><w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>${text}</w:t></w:r></w:p>`
      : `<hp:p id="${id}" paraPrIDRef="0" styleIDRef="0"><hp:run charPrIDRef="0"><hp:t>${text}</hp:t></hp:run></hp:p>`;
  const rows = Array.from({ length: 3 }, (_, r) =>
    format === "docx"
      ? `<w:tr>${Array.from({ length: 2 }, (_, c) => `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/>${c === 0 && r > 0 ? `<w:vMerge${r === 1 ? ' w:val="restart"' : ""}/>` : ""}</w:tcPr>${p(r === 2 && c === 0 ? "" : "옛 예시", r * 2 + c + 10)}</w:tc>`).join("")}</w:tr>`
      : `<hp:tr>${Array.from({ length: 2 }, (_, c) => `<hp:tc borderFillIDRef="1" header="0"><hp:subList id="0">${p("옛 예시", r * 2 + c + 10)}</hp:subList><hp:cellAddr colAddr="${c}" rowAddr="${r}"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="15000" height="2000"/><hp:cellMargin left="100" right="100" top="100" bottom="100"/></hp:tc>`).join("")}</hp:tr>`,
  ).join("");
  const body =
    format === "docx"
      ? `${p("고정 제목", 1)}${p("반복 내용", 2)}<w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>${rows}</w:tbl>${p("보호 꼬리말", 3)}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:bottom="1440" w:left="1440" w:right="1440"/></w:sectPr>`
      : `<hp:p id="1"><hp:run charPrIDRef="0"><hp:secPr><hp:pagePr width="59530" height="84190" landscape="NARROWLY"><hp:margin top="7200" bottom="7200" left="7200" right="7200"/></hp:pagePr></hp:secPr><hp:t>고정 제목</hp:t></hp:run></hp:p>${p("반복 내용", 2)}<hp:p id="3"><hp:run charPrIDRef="0"><hp:tbl id="40" rowCnt="3" colCnt="2" pageBreak="CELL" repeatHeader="1"><hp:sz width="30000" height="6000"/>${rows}</hp:tbl></hp:run></hp:p>${p("보호 꼬리말", 4)}`;
  return zipSync(
    format === "docx"
      ? {
          "[Content_Types].xml": strToU8(
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
          ),
          "word/document.xml": strToU8(
            `<w:document xmlns:w="${wordNS}"><w:body>${body}</w:body></w:document>`,
          ),
          "word/styles.xml": strToU8(
            `<w:styles xmlns:w="${wordNS}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`,
          ),
          "word/media/logo.png": new Uint8Array([1, 2, 3]),
        }
      : {
          mimetype: strToU8("application/hwp+zip"),
          "Contents/header.xml": strToU8(
            '<hh:head xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head"/>',
          ),
          "Contents/section0.xml": strToU8(
            `<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="${hpNS}">${body}</hs:sec>`,
          ),
          "BinData/logo.png": new Uint8Array([1, 2, 3]),
        },
  );
}
export async function renderScenarioV3(
  format: TemplateFormat,
  empty?: "remove" | "keep" | "blank",
  providedBytes?: Uint8Array,
) {
  const bytes = providedBytes ?? renderSourceV3(format),
    identity = {
      sourceHash: hashV3(bytes),
      normalizedHash: hashV3(bytes),
      structureRevision: 1,
    };
  const structure = await inspectTemplateV3({ bytes, format, identity }),
    table = structure.regions.find((r) => r.kind === "table")!,
    paragraph = structure.regions.find((r) => r.text === "반복 내용")!;
  const policy = {
    allowRowChanges: true,
    allowColumnChanges: true,
    allowMerges: true,
    allowParagraphRepeat: true,
    maxRows: 1000,
    maxColumns: 64,
    minColumnWidth: 500,
    empty: empty ?? "blank",
  };
  const intent = {
    purpose: "자료 작성",
    sources: [],
    include: [],
    exclude: [],
    tone: "간결",
    instructions: "",
    fixedText: [],
  };
  const defs: RegionDefinitionV3[] = [
    {
      id: "table",
      sourceRegionId: table.id,
      kind: "table",
      enabled: true,
      intent,
      reviewState: "confirmed",
      reviewDigest: null,
      styleIds: table.styleIds,
      policy,
      columnRoles: [0, 1].map((c) => ({
        id: `role${c}`,
        label: `열${c}`,
        prototypeColumn: c,
        styleId: table.table!.rows[0]!.cells[c]!.styleIds[0]!,
        minWidth: 600,
        repeatable: true,
      })),
      headerRows: 0,
      prototypeRow: 0,
    },
    {
      id: "paragraphs",
      sourceRegionId: paragraph.id,
      kind: "paragraphRepeat",
      enabled: true,
      intent,
      reviewState: "confirmed",
      reviewDigest: null,
      styleIds: paragraph.styleIds,
      policy,
      columnRoles: [],
    },
  ];
  for (const d of defs) d.reviewDigest = await regionReviewDigestV3(d);
  const definition: TemplateDefinitionV3 = {
    schemaVersion: 3,
    identity,
    regions: defs,
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    output: {
      defaultFormat: format,
      allowedFormats: format === "docx" ? ["docx"] : ["hwpx", "hwp"],
    },
    policy: {
      pageSize: "preserve",
      orientation: "preserve",
      fontSize: "preserve",
    },
  };
  const columns = [1, 0, 1, 1].map((role, i) => ({
    key: `c${i}`,
    roleId: `role${role}`,
    dataKey: `/value${i}`,
    styleId: defs[0]!.columnRoles[role]!.styleId,
    widthWeight: 1,
  }));
  const rows = Array.from({ length: empty ? 0 : 30 }, (_, r) => ({
    key: `r${r}`,
    groupKey: r < 2 ? "pair" : `g${r}`,
    cells: columns.flatMap((c, i) =>
      r === 1 && i === 0
        ? []
        : [
            {
              columnKey: c.key,
              text: `${r + 1}행 ${i + 1}열 한글😀\n줄바꿈`,
              evidenceRefs: ["source_ref"],
            },
          ],
    ),
  }));
  const input = {
    values: {},
    evidenceRefs: ["source_ref"],
    sourceSnapshotDigest: await digestV3({ refs: ["source_ref"] }),
  };
  const plan: RenderPlanV3 = {
    schemaVersion: 3,
    identity,
    definitionDigest: await digestV3(definition),
    inputDigest: await digestV3(input.values),
    sourceSnapshotDigest: input.sourceSnapshotDigest,
    regions: [
      {
        regionId: "table",
        kind: "table",
        columns,
        rows,
        merges: empty ? [] : [{ row: 0, column: 0, rowSpan: 2, columnSpan: 1 }],
      },
      {
        regionId: "paragraphs",
        kind: "paragraphRepeat",
        items: empty
          ? []
          : [
              { key: "a", text: "새 문단 하나", evidenceRefs: ["source_ref"] },
              { key: "b", text: "새 문단 둘", evidenceRefs: ["source_ref"] },
            ],
      },
    ],
  };
  const validatedPlan = await validateRenderPlanV3({
    structure,
    definition,
    ...input,
    inputDigest: plan.inputDigest,
    plan,
  });
  return { bytes, structure, definition, input, validatedPlan };
}
