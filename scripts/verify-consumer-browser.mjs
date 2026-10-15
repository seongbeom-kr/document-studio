import { chromium, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { strFromU8, unzipSync } from "fflate";
import {
  Document,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  ImageRun,
  Packer,
} from "docx";
import { PNG } from "pngjs";
const baseURL = process.argv[2] ?? "http://127.0.0.1:4175";
const results = [];
for (const channel of process.env.CI ? [undefined] : ["chrome", "msedge"]) {
  const browser = await chromium.launch({ channel, headless: true });
  try {
    for (const format of ["docx", "hwpx"]) {
      console.log(`Consumer verification: ${channel ?? "chromium"}/${format}`);
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
      });
      const errors = [],
        // The standalone script has no Playwright runner deadline.
        external = [],
        failedAssets = [];
      page.setDefaultTimeout(30000);
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("request", (request) => {
        if (
          /^https?:/.test(request.url()) &&
          new URL(request.url()).origin !== new URL(baseURL).origin
        )
          external.push(request.url());
      });
      page.on("response", (response) => {
        if (
          response.status() >= 400 &&
          response.url().includes("/editor-assets/")
        )
          failedAssets.push(`${response.status()} ${response.url()}`);
      });
      await page.goto(baseURL);
      let restoreBoot;
      if (format === "hwpx") {
        // Exercise the actual packaged default deadline, not the source alias or
        // a consumer-side node_modules patch. Only the iframe HTML is stalled.
        let blocked = true;
        let release;
        const gate = new Promise((resolve) => {
          release = resolve;
        });
        await page.route(
          "**/editor-assets/rhwp/index.html?*",
          async (route) => {
            if (!blocked) return route.continue();
            await gate;
            await route.abort().catch(() => undefined);
          },
        );
        await page.clock.install();
        restoreBoot = () => {
          blocked = false;
          release();
        };
      }
      await page
        .getByLabel("문서 파일")
        .setInputFiles(`fixtures/sample.${format}`);
      const loadingStarted = Date.now();
      try {
        if (restoreBoot) {
          await expect(page.locator("iframe")).toHaveCount(1, {
            timeout: 30000,
          });
          await page.clock.fastForward(30001);
          await expect(
            page.getByRole("button", { name: "편집기 다시 시도", exact: true }),
          ).toBeVisible();
          await expect(page.locator("iframe")).toHaveCount(0);
          restoreBoot();
          await page.clock.resume();
          await page
            .getByRole("button", { name: "편집기 다시 시도", exact: true })
            .click();
        }
        await expect(
          page.getByRole("button", { name: "굵게", exact: true }),
        ).toBeEnabled({ timeout: 30000 });
      } catch (error) {
        await page.screenshot({ path: ".build/consumer-startup-failure.png" });
        await writeFile(
          ".build/consumer-startup-failure.json",
          JSON.stringify(
            {
              channel,
              format,
              elapsedMs: Date.now() - loadingStarted,
              errors,
              failedAssets,
              external,
              body: await page.locator("body").innerText(),
            },
            null,
            2,
          ),
        );
        throw error;
      }
      console.log(`Consumer editor ready in ${Date.now() - loadingStarted}ms`);
      if (format === "docx")
        await page
          .getByRole("textbox", { name: "Document content", exact: true })
          .focus();
      else
        await page
          .frameLocator("iframe")
          .getByLabel("문서 편집 입력", { exact: true })
          .focus();
      await page.keyboard.press("Control+a");
      await page
        .getByRole("combobox", { name: "행간", exact: true })
        .selectOption("1.5");
      const fontSize = page.getByRole("spinbutton", {
        name: "글자 크기",
        exact: true,
      });
      await fontSize.fill("14");
      await fontSize.press("Enter");
      await expect(fontSize).toHaveValue("14");
      await expect(
        page.getByRole("combobox", { name: "행간", exact: true }),
      ).toHaveValue("1.5");
      const downloaded = page.waitForEvent("download");
      await page
        .getByRole("button", { name: "저장하고 다운로드", exact: true })
        .click();
      const download = await downloaded;
      expect(download.suggestedFilename()).toBe(`sample.${format}`);
      const zip = unzipSync(
        new Uint8Array(await readFile(await download.path())),
      );
      const xml = strFromU8(
        zip[format === "docx" ? "word/document.xml" : "Contents/section0.xml"],
      );
      const original = unzipSync(
        new Uint8Array(await readFile(`fixtures/sample.${format}`)),
      );
      const mainPart =
        format === "docx" ? "word/document.xml" : "Contents/section0.xml";
      const documentText = (value) =>
        Array.from(
          value.matchAll(/<(?:w|hp):t(?:\s[^>]*)?>([^<]*)<\/(?:w|hp):t>/g),
          (match) => match[1],
        ).join("");
      expect(documentText(xml)).toBe(
        documentText(strFromU8(original[mainPart])),
      );
      expect(xml).toContain("한국어 문장");
      if (format === "docx") {
        expect(xml).toContain('w:line="360"');
        expect(xml).toContain('w:val="28"');
      } else {
        const header = strFromU8(zip["Contents/header.xml"]);
        expect(header).toContain('height="1400"');
        expect(header).toContain('value="150"');
      }
      // Exercise the packaged onSaved payload and the host's source acknowledgement.
      await expect(
        page.getByRole("status").filter({ hasText: "문서 변경사항 저장됨" }),
      ).toBeVisible();
      try {
        // Next.js has an empty route-announcer with role=alert outside the SDK.
        await expect(page.locator(".ds-editor").getByRole("alert")).toHaveCount(
          0,
        );
      } catch (cause) {
        await page.screenshot({
          path: `.build/consumer-failure-${channel ?? "chromium"}-${format}.png`,
        });
        throw new Error(
          `${channel ?? "chromium"}/${format} save acknowledgement: ${JSON.stringify(await page.getByRole("alert").allTextContents())}`,
          { cause },
        );
      }
      const verifyAutomation = async () => {
        await page
          .getByRole("button", { name: "문단·표·그림", exact: true })
          .click();
        await page.getByLabel("문단 앞 (pt)", { exact: true }).fill("6");
        await page
          .getByRole("button", { name: "문단 설정 적용", exact: true })
          .click();
        await expect(
          page
            .getByRole("status")
            .filter({ hasText: "저장하지 않은 변경사항" }),
        ).toBeVisible();
        await page
          .getByRole("tab", { name: "업무 자동화", exact: true })
          .click();
        await page
          .getByLabel("자동화 기능", { exact: true })
          .selectOption("마크다운 보고서");
        await page
          .getByLabel("보고서 마크다운", { exact: true })
          .fill(
            "# 패키지 생성 보고서\n실제 배포 패키지로 만들었습니다.\n\n| 기능 | 결과 |\n| --- | --- |\n| 생성 | 통과 |",
          );
        await page
          .getByRole("button", { name: "결과 미리보기", exact: true })
          .click();
        await page
          .getByRole("button", {
            name: "구조를 유지해 새 문서 만들기",
            exact: true,
          })
          .click();
        await expect(
          page.getByRole("heading", {
            name: `패키지 생성 보고서.${format}`,
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          page.getByRole("button", { name: "굵게", exact: true }),
        ).toBeEnabled();
        const generatedDownload = page.waitForEvent("download");
        await page
          .getByRole("button", { name: "저장하고 다운로드", exact: true })
          .click();
        const report = await generatedDownload;
        const reportZip = unzipSync(
          new Uint8Array(await readFile(await report.path())),
        );
        expect(strFromU8(reportZip[mainPart])).toContain("패키지 생성 보고서");
        expect(strFromU8(reportZip[mainPart])).toContain(
          format === "docx" ? "w:tbl" : "hp:tbl",
        );
      };
      const acknowledgedDownload = page.waitForEvent("download");
      await page.getByRole("button", { name: "다운로드", exact: true }).click();
      const acknowledgedZip = unzipSync(
        new Uint8Array(
          await readFile(await (await acknowledgedDownload).path()),
        ),
      );
      expect(documentText(strFromU8(acknowledgedZip[mainPart]))).toBe(
        documentText(xml),
      );
      if (format === "docx") {
        expect(strFromU8(acknowledgedZip[mainPart])).toContain('w:val="28"');
        expect(strFromU8(acknowledgedZip[mainPart])).toContain('w:line="360"');
      } else {
        expect(strFromU8(acknowledgedZip["Contents/header.xml"])).toContain(
          'height="1400"',
        );
        expect(strFromU8(acknowledgedZip["Contents/header.xml"])).toContain(
          'value="150"',
        );
      }
      await verifyAutomation();
      if (format === "docx") {
        await page.getByRole("button", { name: "닫기", exact: true }).click();
        const png = new PNG({ width: 400, height: 100 });
        png.data.fill(180);
        const image = new ImageRun({
          type: "png",
          data: PNG.sync.write(png),
          transformation: { width: (80 * 96) / 25.4, height: (20 * 96) / 25.4 },
        });
        const artifact = await Packer.toBuffer(
          new Document({
            sections: [
              {
                children: [
                  new Table({
                    rows: [
                      new TableRow({
                        children: [
                          new TableCell({
                            children: [
                              new Paragraph({
                                children: [
                                  image,
                                  new TextRun("공개 편집 검증 문서"),
                                ],
                              }),
                              new Paragraph("다음 문단"),
                            ],
                          }),
                        ],
                      }),
                    ],
                  }),
                ],
              },
            ],
          }),
        );
        await page.getByLabel("문서 파일").setInputFiles({
          name: "consumer-inline.docx",
          mimeType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          buffer: artifact,
        });
        const img = page.locator(".ds-editor-body img").first();
        await expect(img).toBeVisible();
        const boxes = await page.evaluate(() => {
          const img = document.querySelector(".ds-editor-body img");
          const walker = document.createTreeWalker(
            img.closest(".docx-table-cell"),
            NodeFilter.SHOW_TEXT,
          );
          let text;
          while (walker.nextNode())
            if (walker.currentNode.textContent.includes("공개")) {
              text = walker.currentNode;
              break;
            }
          if (!text)
            throw new Error("Missing native table text in packaged consumer");
          const range = document.createRange();
          range.selectNodeContents(text);
          return {
            image: img.getBoundingClientRect().toJSON(),
            text: range.getBoundingClientRect().toJSON(),
            cell: img
              .closest(".docx-table-cell")
              .getBoundingClientRect()
              .toJSON(),
          };
        });
        expect(Math.abs(boxes.text.left - boxes.image.right)).toBeLessThan(2);
        expect(boxes.text.right).toBeLessThanOrEqual(boxes.cell.right + 1);
        await writeFile(
          `.build/consumer-inline-${channel ?? "chromium"}.json`,
          JSON.stringify(boxes, null, 2),
        );
      }
      expect(errors).toEqual([]);
      expect(external).toEqual([]);
      expect(failedAssets).toEqual([]);
      await page.screenshot({
        path: `.build/consumer-${channel ?? "chromium"}-${format}.png`,
      });
      results.push({
        browser: channel ?? "chromium",
        version: browser.version(),
        format,
        passed: true,
        checks: [
          "production package load",
          "font size 14pt",
          "line spacing 150%",
          "downloaded XML",
          "source text",
          "saved bytes and version callback",
          "own save acknowledgement retains content and formatting",
          "extended paragraph UI",
          "markdown workflow and lazy document factories",
          "dirty draft flush before generated document switch",
          "generated document download contains a table",
          ...(format === "docx"
            ? [
                "bundled native inline-image patch: table text adjacent and unclipped",
              ]
            : []),
          "no external requests",
          "no missing runtime assets",
          "no page errors",
        ],
      });
      await page.close();
    }
  } finally {
    await browser.close();
  }
}
await writeFile(
  ".build/consumer-browser.json",
  JSON.stringify(results, null, 2),
);
console.log(
  `Packaged production consumer browser checks passed (${results.length}).`,
);
