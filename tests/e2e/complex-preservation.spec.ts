import { test, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";
for (const [format, file] of [
  ["docx", "complex.docx"],
  ["hwpx", "rich.hwpx"],
] as const)
  test(`${format} retains complex non-target structures across edit, save and reopen`, async ({
    page,
  }) => {
    const original = unzipSync(
      new Uint8Array(await readFile(`fixtures/${file}`)),
    );
    await page.goto("/harness.html");
    await page.waitForFunction(() => window.documentStudioTest);
    await page.evaluate(
      ({ format, file }) => window.documentStudioTest.load(format, file),
      { format, file },
    );
    await expect
      .poll(() => page.evaluate(() => window.documentStudioTest.state()?.ready))
      .toBe(true);
    const before = await page.evaluate(() => {
      const a = window.documentStudioTest.agent;
      return a.readDocument({ documentId: a.getState().documentId });
    });
    const baseline = unzipSync(
      new Uint8Array(
        await page.evaluate(() => window.documentStudioTest.export()),
      ),
    );
    await page.evaluate(async () => {
      const a = window.documentStudioTest.agent,
        s = a.getState(),
        found = await a.search({
          documentId: s.documentId,
          query: "복합 구조 검증",
        });
      await a.select({
        documentId: s.documentId,
        expectedSessionId: s.sessionId,
        expectedRevision: found.revision,
        matchId: found.matches[0]!.id,
      });
      await a.applyPreset({
        documentId: s.documentId,
        expectedSessionId: s.sessionId,
        expectedRevision: found.revision,
        expectedSelectionKey: a.getState().selectionKey!,
        preset: {
          id: "preserve",
          name: "preserve",
          description: "",
          commands: [
            { id: "fontSize", value: 14 },
            { id: "lineSpacing", value: 1.5 },
          ],
        },
      });
    });
    const bytes = await page.evaluate(() => window.documentStudioTest.export()),
      zip = unzipSync(new Uint8Array(bytes));
    const xml = strFromU8(
      zip[format === "docx" ? "word/document.xml" : "Contents/section0.xml"]!,
    );
    expect(xml).toContain(format === "docx" ? "w:tbl" : "hp:tbl");
    expect(xml).toContain(format === "docx" ? "w:drawing" : "hp:pic");
    for (const [name, data] of Object.entries(original))
      if (/^(word\/media|BinData)\//.test(name) && !name.endsWith("/"))
        expect(
          Object.entries(zip).some(
            ([output, bytes]) =>
              /^(word\/media|BinData)\//.test(output) &&
              Buffer.from(bytes).equals(Buffer.from(data)),
          ),
          name,
        ).toBe(true);
    for (const name of [
      "word/header1.xml",
      "word/footer1.xml",
      "word/footnotes.xml",
    ])
      if (baseline[name])
        expect(strFromU8(zip[name]!), name).toBe(strFromU8(baseline[name]!));
    if (format === "docx") {
      expect(xml).toContain("w:gridSpan");
      expect(xml).toContain("w:fldSimple");
      expect(xml).toContain("2026.10.06");
      expect(xml).toContain("w:footnoteReference");
    }
    await writeFile(
      test.info().outputPath(`complex-edited.${format}`),
      new Uint8Array(bytes),
    );
    await page.evaluate(() => window.documentStudioTest.save());
    await expect
      .poll(() => page.evaluate(() => window.documentStudioTest.state()?.dirty))
      .toBe(false);
    await page.reload();
    await page.waitForFunction(() => window.documentStudioTest);
    await page.evaluate(
      ({ format, bytes }) => window.documentStudioTest.loadBytes(bytes, format),
      { format, bytes },
    );
    await expect
      .poll(() => page.evaluate(() => window.documentStudioTest.state()?.ready))
      .toBe(true);
    const after = await page.evaluate(() => {
      const a = window.documentStudioTest.agent;
      return a.readDocument({ documentId: a.getState().documentId });
    });
    expect(after.text).toBe(before.text);
    expect(after.paragraphs.length).toBe(before.paragraphs.length);
  });
