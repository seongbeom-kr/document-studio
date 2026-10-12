import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
await mkdir(".build/native-qa", { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const observations = [];
for (const format of ["docx", "hwpx"]) {
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:4173/harness.html");
  await page.waitForFunction(() => window.documentStudioTest);
  await page.evaluate(
    (format) => window.documentStudioTest.load(format, `rich.${format}`),
    format,
  );
  await page.waitForFunction(() => window.documentStudioTest.state()?.ready);
  await page.evaluate(async () => {
    await window.documentStudioTest.execute({ id: "selectAll" });
    await window.documentStudioTest.execute({ id: "lineSpacing", value: 1.5 });
    await window.documentStudioTest.execute({ id: "fontSize", value: 14 });
  });
  const bytes = new Uint8Array(
    await page.evaluate(() => window.documentStudioTest.export()),
  );
  await writeFile(`.build/native-qa/edited.${format}`, bytes);
  observations.push({
    format,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    state: await page.evaluate(() => window.documentStudioTest.state()),
  });
  await page.close();
}
await writeFile(
  ".build/native-qa/browser-observations.json",
  JSON.stringify(observations, null, 2),
);
await browser.close();
console.log(
  "Prepared browser-exported documents for independent native validation.",
);
