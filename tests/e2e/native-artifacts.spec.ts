import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
for (const format of ["docx", "hwpx"] as const)
  test(`${format} exports a fresh atomic-preset artifact for native application checks`, async ({
    page,
  }) => {
    await page.goto("/harness.html");
    await page.waitForFunction(() => window.documentStudioTest);
    await page.evaluate(
      (format) => window.documentStudioTest.load(format, `rich.${format}`),
      format,
    );
    await expect
      .poll(() => page.evaluate(() => window.documentStudioTest.state()?.ready))
      .toBe(true);
    await page.evaluate(async () => {
      const a = window.documentStudioTest.agent;
      await window.documentStudioTest.execute({ id: "selectAll" });
      const s = a.getState();
      await a.applyPreset({
        documentId: s.documentId,
        expectedSessionId: s.sessionId,
        expectedRevision: s.revision,
        expectedSelectionKey: a.getState().selectionKey!,
        preset: {
          id: "native",
          name: "native",
          description: "",
          commands: [
            { id: "lineSpacing", value: 1.5 },
            { id: "fontSize", value: 14 },
          ],
        },
      });
    });
    const bytes = new Uint8Array(
      await page.evaluate(() => window.documentStudioTest.export()),
    );
    await mkdir(".build/native-qa", { recursive: true });
    await writeFile(
      `.build/native-qa/edited-${test.info().project.name}.${format}`,
      bytes,
    );
    if (test.info().project.name === "chrome")
      await writeFile(`.build/native-qa/edited.${format}`, bytes);
    await writeFile(
      `.build/native-qa/${format}-${test.info().project.name}-provenance.json`,
      JSON.stringify(
        {
          sdkVersion: "0.2.7",
          createdAt: new Date().toISOString(),
          sha256: createHash("sha256").update(bytes).digest("hex"),
          state: await page.evaluate(() => window.documentStudioTest.state()),
        },
        null,
        2,
      ),
    );
  });
