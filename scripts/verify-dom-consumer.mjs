import { build, preview } from "vite";
import { chromium, expect } from "@playwright/test";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import initHwp, { HwpDocument } from "@rhwp/core";
let hwpInitialized = false;
async function outputText(bytes, format) {
  if (format !== "hwp")
    return strFromU8(
      unzipSync(bytes)[
        format === "docx" ? "word/document.xml" : "Contents/section0.xml"
      ],
    );
  if (!hwpInitialized) {
    await initHwp({
      module_or_path: await readFile(
        path.join(root, "node_modules/@rhwp/core/rhwp_bg.wasm"),
      ),
    });
    hwpInitialized = true;
  }
  const document = new HwpDocument(bytes);
  try {
    return strFromU8(unzipSync(document.exportHwpx())["Contents/section0.xml"]);
  } finally {
    document.free();
  }
}

const root = fileURLToPath(new URL("../", import.meta.url));
const consumer = path.resolve(
  process.argv[2] ?? path.join(root, ".cache/package-consumer"),
);
const example = path.join(consumer, "browser-example");
await mkdir(example, { recursive: true });
for (const file of ["index.html", "main.ts"])
  await cp(path.join(root, "examples/browser", file), path.join(example, file));
await build({
  configFile: false,
  root: example,
  publicDir: path.join(consumer, "public"),
  build: { outDir: path.join(example, "dist") },
});
const server = await preview({
  configFile: false,
  root: example,
  preview: { host: "127.0.0.1", port: 4177, strictPort: true },
});
const results = [];
try {
  for (const channel of process.env.CI ? [undefined] : ["chrome", "msedge"]) {
    const browser = await chromium.launch({ channel, headless: true });
    try {
      for (const host of ["plain", "vue"])
        for (const format of ["docx", "hwpx", "hwp"]) {
          const page = await browser.newPage();
          page.setDefaultTimeout(30000);
          const errors = [];
          page.on("pageerror", (error) => errors.push(error.message));
          try {
            await page.goto(`http://127.0.0.1:4177/?host=${host}&verify=true`);
            await page
              .getByLabel("문서 파일")
              .setInputFiles(path.join(root, `fixtures/blank.${format}`));
            const save = page.getByRole("button", {
              name: "저장하고 다운로드",
              exact: true,
            });
            await expect(save).toBeEnabled();
            const target =
              format === "docx"
                ? page.getByRole("textbox", {
                    name: "Document content",
                    exact: true,
                  })
                : page
                    .frameLocator("iframe")
                    .getByLabel("문서 편집 입력", { exact: true });
            await target.focus();
            await page.keyboard.insertText("범용 SDK 검증");
            const download = page.waitForEvent("download");
            await save.click();
            const bytes = await readFile(await (await download).path());
            expect(await outputText(bytes, format)).toContain("범용 SDK 검증");
            const inspection = await page.evaluate(() =>
              window.documentStudioExample.inspect(),
            );
            expect(inspection.format).toBe(format);
            expect(inspection.inspectedFormat).toBe(
              format === "hwp" ? "hwpx" : format,
            );
            await expect(save).toBeEnabled();
            await page.getByLabel("문서 파일").setInputFiles({
              name: `reopened.${format}`,
              mimeType: "application/octet-stream",
              buffer: bytes,
            });
            await expect(save).toBeEnabled();
            const reopenedDownload = page.waitForEvent("download");
            await save.click();
            const reopened = await readFile(
              await (await reopenedDownload).path(),
            );
            expect(await outputText(reopened, format)).toContain(
              "범용 SDK 검증",
            );
            await expect(save).toBeEnabled();
            await page
              .getByRole("button", { name: "초안 보관 후 닫기", exact: true })
              .click();
            await expect(page.locator(".ds-browser-mount")).toHaveCount(0);
            expect(errors).toEqual([]);
            results.push({
              browser: channel ?? "chromium",
              host,
              format,
              passed: true,
            });
          } catch (error) {
            const evidence = path.join(
              root,
              ".build",
              `dom-consumer-failed-${channel ?? "chromium"}-${host}-${format}`,
            );
            await page
              .screenshot({ path: `${evidence}.png` })
              .catch(() => undefined);
            const body = await page
              .locator("body")
              .innerText()
              .catch(() => "unavailable");
            results.push({
              browser: channel ?? "chromium",
              host,
              format,
              passed: false,
              errors,
              error: String(error),
              body,
              url: page.url(),
            });
            throw error;
          }
          await page.close();
        }
    } finally {
      await browser.close();
    }
  }
} finally {
  await new Promise((resolve) => server.httpServer.close(resolve));
  await writeFile(
    path.join(root, ".build/dom-consumer-browser.json"),
    JSON.stringify(results, null, 2),
  );
}
console.log(
  `DOM consumer verification passed: ${results.length} browser/host/format combinations.`,
);
