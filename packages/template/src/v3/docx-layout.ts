import { mkdtemp, writeFile, readFile, mkdir, rm } from "node:fs/promises";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { digest, digest as digestBytes, parseXml, walk, attr } from "../xml";
import { digestV3 } from "./contract";
import type { FinalExportRequestV3 } from "./final-output";
import type { FinalDocumentV3, PagePreviewV3, DigestV3 } from "./types";
const execFile = promisify(execFileCallback);
/** Fixed worker tools produce previews; the final DOCX remains the verified working bytes. */
export async function finalizeDocxV3(
  input: FinalExportRequestV3,
): Promise<FinalDocumentV3> {
  const root = await mkdtemp(path.join(tmpdir(), "document-studio-v3-"));
  try {
    const profile = path.join(root, "profile"),
      user = path.join(profile, "user");
    await mkdir(user, { recursive: true });
    await writeFile(
      path.join(user, "registrymodifications.xcu"),
      '<?xml version="1.0"?><oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item><item oor:path="/org.openoffice.Office.Writer/Content/Update"><prop oor:name="Link" oor:op="fuse"><value>0</value></prop></item></oor:items>',
    );
    const source = path.join(root, "working.docx"),
      pdf = path.join(root, "working.pdf");
    await writeFile(source, input.working.bytes, { flag: "wx", mode: 0o600 });
    const versions: string[] = [];
    for (const [tool, args] of [
      ["soffice", ["--version"]],
      ["pdfinfo", ["-v"]],
      ["pdftocairo", ["-v"]],
    ] as [string, string[]][]) {
      try {
        const version = await execFile(tool, args, {
          timeout: 10000,
          maxBuffer: 1024 * 1024,
        });
        versions.push(tool + ":" + version.stdout + version.stderr);
      } catch {
        throw new Error("REPORT_LAYOUT_RUNTIME_UNAVAILABLE");
      }
    }
    const config = new URL("./fonts/fontconfig.conf", import.meta.url),
      fontConfig = await readFile(config);
    const env = { ...process.env, FONTCONFIG_FILE: fileURLToPath(config) };
    await execFile(
      "soffice",
      [
        "--headless",
        "--norestore",
        "--nodefault",
        "--nofirststartwizard",
        `-env:UserInstallation=${pathToFileURL(profile).href}`,
        "--convert-to",
        "pdf:writer_pdf_Export",
        "--outdir",
        root,
        source,
      ],
      { timeout: 60000, maxBuffer: 1024 * 1024, env },
    );
    const info = await execFile("pdfinfo", [pdf], {
        timeout: 10000,
        maxBuffer: 1024 * 1024,
      }),
      count = Number(info.stdout.match(/^Pages:\s*(\d+)/m)?.[1]);
    if (!Number.isInteger(count) || count < 1 || count > 200)
      throw new Error("REPORT_PAGE_LIMIT");
    const bbox = path.join(root, "bbox.xml");
    await execFile("pdftotext", ["-bbox", pdf, bbox], {
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    });
    const xml = (await readFile(bbox, "utf8")).replace(/<!DOCTYPE[^>]*>/g, ""),
      doc = parseXml(new TextEncoder().encode(xml));
    for (const page of walk(doc).filter((n) => n.localName === "page")) {
      const width = Number(attr(page, "width")),
        height = Number(attr(page, "height"));
      for (const word of walk(page).filter((n) => n.localName === "word"))
        if (
          Number(attr(word, "xMin")) < -0.5 ||
          Number(attr(word, "yMin")) < -0.5 ||
          Number(attr(word, "xMax")) > width + 0.5 ||
          Number(attr(word, "yMax")) > height + 0.5
        )
          throw new Error("REPORT_LAYOUT_OVERFLOW");
    }
    const previews: PagePreviewV3[] = [];
    let total = 0;
    for (let page = 1; page <= count; page++) {
      const output = path.join(root, `page-${page}.svg`);
      await execFile(
        "pdftocairo",
        ["-svg", "-f", String(page), "-l", String(page), pdf, output],
        { timeout: 30000, maxBuffer: 1024 * 1024 },
      );
      const bytes = await readFile(output);
      total += bytes.length;
      if (total > 64 * 1024 * 1024) throw new Error("REPORT_PREVIEW_LIMIT");
      const svg = bytes.toString("utf8"),
        parsed = parseXml(bytes),
        width = Number(
          (parsed.documentElement?.getAttribute("width") ?? "").replace(
            /pt$/,
            "",
          ),
        ),
        height = Number(
          (parsed.documentElement?.getAttribute("height") ?? "").replace(
            /pt$/,
            "",
          ),
        );
      if (!width || !height) throw new Error("REPORT_PREVIEW_INVALID");
      previews.push({
        page: page - 1,
        width: Math.round(width * 1000),
        height: Math.round(height * 1000),
        svg,
        digest: (await digest(bytes)) as DigestV3,
      });
    }
    const bytes = new Uint8Array(input.working.bytes),
      outputDigest = (await digestBytes(bytes)) as DigestV3,
      layoutDigest = await digestV3(previews.map(({ svg: _svg, ...p }) => p));
    const proof = {
      sourceIdentity: input.definition.identity,
      planDigest: input.validatedPlan.planDigest,
      workingDigest: outputDigest,
      outputDigest,
      outputFormat: "docx" as const,
      contentLoss: { count: 0 as const, losses: [] },
      pageCountBefore: count,
      pageCountAfter: count,
      gridPreserved: true as const,
      protectedStylesPreserved: true as const,
      runtimeProfile: structuredClone(input.runtimeProfile),
      pageLayoutDigestBefore: layoutDigest,
      pageLayoutDigestAfter: layoutDigest,
      fontBindings: [],
      previewDigests: previews.map((p) => p.digest),
      layoutRuntime: await digestV3({
        versions,
        fontConfigDigest: await digest(fontConfig),
      }),
    };
    return {
      bytes,
      outputFormat: "docx",
      digest: outputDigest,
      byteLength: bytes.length,
      verificationDigest: await digestV3(proof),
      proof,
      previews,
    };
  } finally {
    if (
      path.dirname(root) === path.resolve(tmpdir()) &&
      path.basename(root).startsWith("document-studio-v3-")
    )
      await rm(root, { recursive: true, force: true });
  }
}
