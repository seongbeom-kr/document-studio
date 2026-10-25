import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
export const fontDirectory = fileURLToPath(
  new URL("../packages/core/assets/fonts/", import.meta.url),
);
export async function verifyFontAssets(directory = fontDirectory) {
  const manifest = JSON.parse(
    await readFile(path.join(directory, "manifest.json"), "utf8"),
  );
  if (manifest.license !== "OFL-1.1" || manifest.faces.length !== 5)
    throw new Error("Unexpected font pack policy.");
  for (const face of manifest.faces) {
    if (!/^(?:(NotoSansKR|NotoSerifKR)-(Regular|Bold)|NotoSansSymbols2-Regular)\.ttf$/.test(face.file))
      throw new Error("Unexpected font file.");
    const bytes = await readFile(path.join(directory, face.file));
    if (
      bytes.length !== face.bytes ||
      createHash("sha256").update(bytes).digest("hex") !== face.sha256
    )
      throw new Error(`Font integrity failed: ${face.file}`);
  }
  const license = await readFile(path.join(directory, "OFL.txt"), "utf8");
  const copyrights = await readFile(
    path.join(directory, "COPYRIGHTS.txt"),
    "utf8",
  );
  if (
    !license.includes("SIL OPEN FONT LICENSE Version 1.1") ||
    !copyrights.includes("2017-2024 Adobe")
  )
    throw new Error("Font notices missing.");
  const runtime = JSON.parse(
    await readFile(
      new URL("../packages/core/src/font-pack.json", import.meta.url),
      "utf8",
    ),
  );
  if (JSON.stringify(runtime) !== JSON.stringify(manifest))
    throw new Error("Runtime font manifest is stale.");
  if (
    manifest.supportFiles?.length !== 4 ||
    manifest.supportFiles.some(
      (entry) =>
        !["OFL.txt", "COPYRIGHTS.txt", "fontconfig.conf", "NotoSansSymbols2-OFL.txt"].includes(entry.file),
    )
  )
    throw new Error("Font support inventory is invalid.");
  for (const entry of manifest.supportFiles)
    if (
      createHash("sha256")
        .update(await readFile(path.join(directory, entry.file)))
        .digest("hex") !== entry.sha256
    )
      throw new Error(`Font notice/config integrity failed: ${entry.file}`);
  return manifest;
}
export async function prepareFontConfig() {
  const serif = [
    "serif",
    "함초롬바탕",
    "HCR Batang",
    "한컴바탕",
    "휴먼명조",
    "HumanMyeongJo",
    "한양신명조",
    "HY신명조",
    "HY명조",
    "바탕",
    "Batang",
    "명조",
    "KoPub바탕체 Light",
    "KoPub바탕체 Medium",
    "Times New Roman",
    "Georgia",
  ];
  const sans = [
    "sans",
    "sans-serif",
    "함초롬돋움",
    "HCR Dotum",
    "한컴돋움",
    "맑은 고딕",
    "맑은고딕",
    "Malgun Gothic",
    "한양중고딕",
    "HY중고딕",
    "HY헤드라인M",
    "HYHeadLine-Medium",
    "KoPub돋움체 Light",
    "KoPub돋움체 Medium",
    "KoPub돋움체 Bold",
    "돋움",
    "Dotum",
    "굴림",
    "Gulim",
    "Arial",
    "Calibri",
    "HCI Poppy",
  ];
  const config = `<?xml version="1.0"?>\n<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">\n<fontconfig>\n<include ignore_missing="yes">/etc/fonts/fonts.conf</include>\n<dir prefix="relative">.</dir>\n<cachedir>/tmp/document-studio-font-cache</cachedir>\n${[...serif.map((name) => [name, "Noto Serif KR"]), ...sans.map((name) => [name, "Noto Sans KR"])].map(([name, target]) => `<alias binding="same"><family>${name}</family><accept><family>${target}</family></accept></alias>`).join("\n")}\n</fontconfig>\n`;
  // Host distro aliases (e.g. Times -> Liberation) must not precede this pack.
  // Keep system files discoverable so an exact licensed original still wins.
  const isolated = config
    .replace(
      '<include ignore_missing="yes">/etc/fonts/fonts.conf</include>',
      "<dir>/usr/share/fonts</dir>",
    )
    .replace(
      "</fontconfig>",
      '<selectfont><rejectfont><glob>/usr/share/fonts/opentype/noto/*</glob></rejectfont></selectfont>\n<match target="pattern"><edit name="family" mode="append" binding="strong"><string>Noto Sans KR</string><string>Noto Sans Symbols 2</string></edit></match>\n</fontconfig>',
    );
  await writeFile(path.join(fontDirectory, "fontconfig.conf"), isolated);
}
