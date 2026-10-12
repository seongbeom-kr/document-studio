import { test, expect } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
for (const format of ["docx", "hwpx"] as const)
  test(`creates and reopens a 150-person ${format} attendance document`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/harness.html");
    await page.waitForFunction(() => window.documentStudioTest);
    await page.evaluate(async (format) => {
      const rows = Array.from({ length: 150 }, (_, i) => [
        String(i + 1),
        "검토팀",
        "위원",
        `참석자 ${i + 1}`,
      ]);
      await window.documentStudioTest.createTemplate(format, {
        fileName: "참석자.docx",
        blocks: [
          { kind: "heading", level: 1, text: "참석자 명단" },
          {
            kind: "table",
            rows: [["번호", "소속", "직위", "성명"], ...rows.slice(0, 99)],
          },
          {
            kind: "table",
            rows: [["번호", "소속", "직위", "성명"], ...rows.slice(99)],
          },
        ],
      });
    }, format);
    await expect
      .poll(() => page.evaluate(() => window.documentStudioTest.state()?.ready))
      .toBe(true);
    const bytes = await page.evaluate(() => window.documentStudioTest.export()),
      zip = unzipSync(new Uint8Array(bytes));
    const xml = strFromU8(
      zip[format === "docx" ? "word/document.xml" : "Contents/section0.xml"]!,
    );
    expect(xml).toContain("참석자 150");
    expect(
      xml.match(format === "docx" ? /<w:tbl>/g : /<hp:tbl\s/g),
    ).toHaveLength(2);
    await page.reload();
    await page.waitForFunction(() => window.documentStudioTest);
    await page.evaluate(
      ({ bytes, format }) => window.documentStudioTest.loadBytes(bytes, format),
      { bytes, format },
    );
    await expect
      .poll(() => page.evaluate(() => window.documentStudioTest.state()?.ready))
      .toBe(true);
    const read = await page.evaluate(() =>
      window.documentStudioTest.agent.readDocument({
        documentId: window.documentStudioTest.agent.getState().documentId,
      }),
    );
    expect(read.text).toContain("참석자 150");
    expect(read.text.match(/참석자 \d+/g)).toHaveLength(150);
    expect(errors).toEqual([]);
  });
