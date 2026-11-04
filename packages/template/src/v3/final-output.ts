import {
  digest,
  openArchive,
  walk,
  attr,
  elements,
  NS,
  textOf,
  parseXml,
} from "../xml";
import { canonicalV3, digestV3, validateContractV3 } from "./contract";
import { loadNativeRuntime, type NativeHwpDocumentV3 } from "./native-runtime";
import { verifiedHwpBytesV3 } from "./hwp";
import { inspectTemplateV3 } from "./structure";
import { checkNativeBoundsV3 } from "./native-layout-bounds";
import type {
  FinalDocumentV3,
  PagePreviewV3,
  WorkingDocumentProofV3,
  OutputFormatV3,
  TemplateDefinitionV3,
  ValidatedPlanV3,
  RuntimeProfileV3,
  DigestV3,
} from "./types";

const same = (a: unknown, b: unknown) => canonicalV3(a) === canonicalV3(b);
/** Native geometry uses decimal coordinates; the portable proof stores decimal strings. */
function geometry(value: unknown): unknown {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("REPORT_LAYOUT_INVALID");
    return Number.isInteger(value) ? value : String(value);
  }
  if (Array.isArray(value)) return value.map(geometry);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, geometry(v)]),
    );
  return value;
}
function safeSvg(svg: string) {
  const doc = parseXml(new TextEncoder().encode(svg));
  if (
    doc.documentElement?.namespaceURI !== "http://www.w3.org/2000/svg" ||
    doc.documentElement.localName !== "svg"
  )
    throw new Error("REPORT_PREVIEW_INVALID");
  for (const n of walk(doc)) {
    if (["script", "foreignObject", "iframe"].includes(n.localName ?? ""))
      throw new Error("REPORT_PREVIEW_INVALID");
    for (const a of Array.from(n.attributes))
      if (
        /^on/i.test(a.localName ?? "") ||
        (a.localName === "href" &&
          !a.value.startsWith("#") &&
          !/^data:image\/(png|jpeg|gif);base64,[A-Za-z0-9+/=]+$/.test(
            a.value,
          )) ||
        (a.localName === "style" && /url\((?!\s*["']?#)/i.test(a.value))
      )
        throw new Error("REPORT_PREVIEW_INVALID");
    if (
      n.localName === "style" &&
      /@import|url\((?!\s*["']?#)/i.test(n.textContent ?? "")
    )
      throw new Error("REPORT_PREVIEW_INVALID");
  }
}
async function pages(document: NativeHwpDocumentV3) {
  const count = document.pageCount();
  if (!Number.isInteger(count) || count < 1 || count > 200)
    throw new Error("REPORT_PAGE_LIMIT");
  const layout: unknown[] = [],
    previews: PagePreviewV3[] = [];
  let total = 0;
  for (let page = 0; page < count; page++) {
    const info = JSON.parse(document.getPageInfo(page)),
      tree = JSON.parse(document.getPageRenderTree(page)),
      text = JSON.parse(document.getPageTextLayout(page));
    checkNativeBoundsV3(tree, info.width, info.height, text);
    layout.push(geometry({ info, tree, text }));
    const svg = document.renderPageSvg(page),
      bytes = new TextEncoder().encode(svg);
    total += bytes.length;
    if (total > 64 * 1024 * 1024) throw new Error("REPORT_PREVIEW_LIMIT");
    safeSvg(svg);
    previews.push({
      page,
      width: Math.round(info.width * 1000),
      height: Math.round(info.height * 1000),
      digest: (await digest(bytes)) as DigestV3,
      svg,
    });
  }
  return { layout, digest: await digestV3(layout), previews };
}
/** Logical source projection is independent of native node/shape identifiers. */
async function snapshot(bytes: Uint8Array) {
  const hash = (await digest(bytes)) as DigestV3,
    structure = await inspectTemplateV3({
      bytes,
      format: "hwpx",
      identity: {
        sourceHash: hash,
        normalizedHash: hash,
        structureRevision: 1,
      },
    }),
    opened = openArchive(bytes, "hwpx"),
    header = opened.xml.get("Contents/header.xml");
  if (!header) throw new Error("REPORT_HWP_STRUCTURE_MISMATCH");
  const shapes = new Map(
    walk(header)
      .filter((n) => n.localName === "charPr")
      .map((shape) => {
        const ref = elements(shape).find((n) => n.localName === "fontRef");
        const fonts = ref
          ? Array.from(ref.attributes)
              .filter((a) => a.namespaceURI !== "http://www.w3.org/2000/xmlns/")
              .map((a) => [a.localName, a.value])
              .sort()
          : [];
        return [
          attr(shape, "id"),
          {
            height: attr(shape, "height") ?? "",
            color: attr(shape, "textColor") ?? "",
            bold: elements(shape).some((n) => n.localName === "bold"),
            italic: elements(shape).some((n) => n.localName === "italic"),
            fonts,
          },
        ];
      }),
  );
  const paragraphs = opened.bodyParts.flatMap((part) =>
    walk(opened.xml.get(part)!)
      .filter((n) => n.namespaceURI === NS.hwpx && n.localName === "p")
      .map((p) => ({
        text: textOf(p, NS.hwpx),
        runs: elements(p)
          .filter((n) => n.localName === "run")
          .map((run) => ({
            text: textOf(run, NS.hwpx),
            style: shapes.get(attr(run, "charPrIDRef")) ?? null,
          }))
          .filter((r) => r.text),
      })),
  );
  const tables = structure.regions
    .filter((r) => r.table)
    .map((r) => ({
      columns: r.table!.columns.map((c) => c.width),
      rows: r.table!.rows.map((row) =>
        row.cells.map((c) => ({
          row: c.row,
          column: c.column,
          rowSpan: c.rowSpan,
          columnSpan: c.columnSpan,
          text: c.text,
        })),
      ),
    }));
  const images = await Promise.all(
    Object.entries(opened.parts)
      .filter(
        ([name]) =>
          /^BinData\//.test(name) &&
          /\.(png|jpe?g|gif|bmp|wmf|emf)$/i.test(name),
      )
      .map(async ([, data]) => digest(data)),
  );
  return { page: structure.page, paragraphs, tables, images: images.sort() };
}
export interface FinalExportRequestV3 {
  working: { bytes: Uint8Array; proof: WorkingDocumentProofV3 };
  outputFormat: OutputFormatV3;
  definition: TemplateDefinitionV3;
  validatedPlan: ValidatedPlanV3;
  runtimeProfile: RuntimeProfileV3;
}
export async function exportFinalDocumentV3(
  input: FinalExportRequestV3,
): Promise<FinalDocumentV3> {
  const { working, definition, validatedPlan, outputFormat, runtimeProfile } =
    input;
  validateContractV3("definition", definition);
  const workingDigest = (await digest(working.bytes)) as DigestV3;
  if (
    workingDigest !== working.proof.outputDigest ||
    working.proof.planDigest !== validatedPlan.planDigest ||
    validatedPlan.planDigest !== (await digestV3(validatedPlan.plan)) ||
    validatedPlan.plan.definitionDigest !== (await digestV3(definition)) ||
    !same(working.proof.sourceIdentity, definition.identity) ||
    working.proof.gridValid !== true ||
    working.proof.stylesPreserved !== true ||
    working.proof.runtimeProfile.fontPackDigest !==
      runtimeProfile.fontPackDigest ||
    working.proof.runtimeProfile.schemaDigest !== runtimeProfile.schemaDigest
  )
    throw new Error("REPORT_FINAL_PROOF_MISMATCH");
  if (!definition.output.allowedFormats.includes(outputFormat))
    throw new Error("REPORT_OUTPUT_FORMAT_NOT_ALLOWED");
  if (outputFormat === "docx") {
    if (definition.output.defaultFormat !== "docx")
      throw new Error("REPORT_OUTPUT_FORMAT_NOT_ALLOWED");
    const { finalizeDocxV3 } = await import("./docx-layout");
    return finalizeDocxV3(input);
  }
  if (definition.output.defaultFormat === "docx")
    throw new Error("REPORT_OUTPUT_FORMAT_NOT_ALLOWED");
  const runtime = await loadNativeRuntime(runtimeProfile),
    document = new runtime.HwpDocument(working.bytes);
  try {
    const fontBindings = runtime.bindFonts(document, working.bytes);
    document.reflowLinesegs();
    const normalized = document.exportHwpx();
    if (!same(await snapshot(working.bytes), await snapshot(normalized)))
      throw new Error("REPORT_HWP_STRUCTURE_MISMATCH");
    const before = await pages(document),
      bytes =
        outputFormat === "hwp"
          ? verifiedHwpBytesV3(document)
          : new Uint8Array(working.bytes);
    if (bytes.length > 64 * 1024 * 1024) throw new Error("REPORT_OUTPUT_LIMIT");
    const reopened = new runtime.HwpDocument(bytes);
    try {
      const reopenedWorking = reopened.exportHwpx();
      runtime.bindFonts(reopened, reopenedWorking);
      reopened.reflowLinesegs();
      if (
        !same(await snapshot(normalized), await snapshot(reopened.exportHwpx()))
      )
        throw new Error("REPORT_HWP_STRUCTURE_MISMATCH");
      const after = await pages(reopened);
      if (
        before.previews.length !== after.previews.length ||
        before.digest !== after.digest
      )
        throw new Error("REPORT_HWP_LAYOUT_MISMATCH");
      const outputDigest = (await digest(bytes)) as DigestV3,
        proof = {
          sourceIdentity: definition.identity,
          planDigest: validatedPlan.planDigest,
          workingDigest,
          outputDigest,
          outputFormat,
          contentLoss: { count: 0 as const, losses: [] },
          pageCountBefore: before.previews.length,
          pageCountAfter: after.previews.length,
          gridPreserved: true as const,
          protectedStylesPreserved: true as const,
          runtimeProfile: structuredClone(runtimeProfile),
          pageLayoutDigestBefore: before.digest,
          pageLayoutDigestAfter: after.digest,
          fontBindings,
          previewDigests: after.previews.map((p) => p.digest),
          layoutRuntime: runtimeProfile.exporter,
        };
      return {
        bytes,
        outputFormat,
        digest: outputDigest,
        byteLength: bytes.length,
        verificationDigest: await digestV3(proof),
        proof,
        previews: after.previews,
      };
    } finally {
      reopened.free();
    }
  } finally {
    document.free();
  }
}
