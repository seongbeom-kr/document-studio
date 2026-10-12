import { expect, test, type Page } from "@playwright/test";

type Format = "docx" | "hwpx";
async function load(page: Page, format: Format) {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/harness.html");
  await page.waitForFunction(() => !!window.documentStudioTest);
  await page.evaluate(async (format) => {
    window.documentStudioTest.embedded = true;
    await window.documentStudioTest.load(format);
  }, format);
  await expect
    .poll(() => page.evaluate(() => window.documentStudioTest.state()?.ready))
    .toBe(true);
}
const content = (page: Page, format: Format) =>
  format === "docx"
    ? page.getByRole("textbox", { name: "Document content", exact: true })
    : page.frameLocator("iframe").getByLabel("문서 편집 입력", { exact: true });

for (const format of ["docx", "hwpx"] as const)
  test.describe(`${format} embedded UI`, () => {
    test("uses host typography and keeps document height when properties open", async ({
      page,
    }, info) => {
      await load(page, format);
      await expect(page.locator(".ds-document-header")).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "저장", exact: true }),
      ).toHaveCount(0);
      const theme = await page.locator(".ds-editor").evaluate((element) => {
        const css = getComputedStyle(element);
        return {
          font: css.fontFamily,
          border: css.borderWidth,
          radius: css.borderRadius,
          accent: css.getPropertyValue("--ds-accent").trim(),
        };
      });
      expect(theme).toMatchObject({
        font: "Arial",
        border: "0px",
        radius: "0px",
        accent: "#3b50a8",
      });
      const before = (await page.locator(".ds-editor-body").boundingBox())!;
      await page
        .getByRole("button", { name: "문단·표·그림", exact: true })
        .click();
      const after = (await page.locator(".ds-editor-body").boundingBox())!;
      const panel = (await page
        .locator("[data-document-properties]")
        .boundingBox())!;
      expect(after.height).toBeGreaterThan(500);
      expect(Math.abs(after.height - before.height)).toBeLessThan(2);
      expect(panel.x).toBeGreaterThanOrEqual(after.x + after.width - 1);
      expect(
        await page
          .locator(".ds-tools-content")
          .evaluate((e) => getComputedStyle(e).overflowY),
      ).toBe("auto");
      await page.screenshot({
        path: info.outputPath(`${format}-embedded-properties.png`),
      });
      await page
        .getByRole("button", { name: "편집 도구 닫기", exact: true })
        .click();
      await expect(page.locator("[data-document-properties]")).toHaveCount(0);
    });
    test("syncs live paragraph values and applies only edited properties", async ({
      page,
    }) => {
      await load(page, format);
      await page.evaluate(() =>
        window.documentStudioTest.execute({ id: "selectAll" }),
      );
      await page
        .getByRole("button", { name: "문단·표·그림", exact: true })
        .click();
      await page
        .getByRole("combobox", { name: "행간", exact: true })
        .selectOption("1.5");
      await expect(
        page.getByRole("spinbutton", { name: "행간 값", exact: true }),
      ).toHaveValue("1.5");
      await page
        .getByRole("spinbutton", { name: "문단 앞 (pt)", exact: true })
        .fill("6");
      await page
        .getByRole("button", { name: "문단 설정 적용", exact: true })
        .click();
      await expect
        .poll(() =>
          page.evaluate(
            () => window.documentStudioTest.state()?.paragraph?.beforePt,
          ),
        )
        .toBe(6);
      expect(
        await page.evaluate(
          () => window.documentStudioTest.state()?.lineSpacing,
        ),
      ).toBe(1.5);
      await expect(
        page.getByRole("button", { name: "문단 설정 적용", exact: true }),
      ).toBeDisabled();
    });
    test("keeps sheet width with docked properties and fits pages after resize", async ({
      page,
    }, info) => {
      await load(page, format);
      await page.locator(".ds-editor").evaluate((element) => {
        (element as HTMLElement).style.width = "768px";
        (element as HTMLElement).style.maxWidth = "100%";
      });
      const before = (await page.locator(".ds-editor-body").boundingBox())!;
      await page
        .getByRole("button", { name: "문단·표·그림", exact: true })
        .click();
      const after = (await page.locator(".ds-editor-body").boundingBox())!;
      const tools = (await page
        .locator("[data-document-properties]")
        .boundingBox())!;
      expect(Math.abs(after.width - before.width)).toBeLessThan(2);
      expect(after.height).toBeGreaterThan(200);
      expect(tools.y).toBeGreaterThanOrEqual(after.y + after.height - 1);
      await page
        .getByRole("combobox", { name: "확대", exact: true })
        .selectOption("width");
      await expect
        .poll(() =>
          page.evaluate(() => {
            const state = window.documentStudioTest.state()!;
            return ((state.page!.widthMm * 96) / 25.4) * state.zoom;
          }),
        )
        .toBeLessThanOrEqual(after.width - 63);
      await page.screenshot({
        path: info.outputPath(`${format}-sheet-fit-width.png`),
      });
      const zoom = await page.evaluate(
        () => window.documentStudioTest.state()!.zoom,
      );
      await page.setViewportSize({ width: 640, height: 768 });
      await expect
        .poll(() =>
          page.evaluate(() => window.documentStudioTest.state()!.zoom),
        )
        .toBeLessThan(zoom);
      await expect(
        page.getByRole("combobox", { name: "확대", exact: true }),
      ).toHaveValue("width");
      await page
        .getByRole("combobox", { name: "확대", exact: true })
        .selectOption("100");
      await expect
        .poll(() =>
          page.evaluate(() => window.documentStudioTest.state()!.zoom),
        )
        .toBe(1);
      await page.setViewportSize({ width: 1000, height: 768 });
      await expect(
        page.getByRole("combobox", { name: "확대", exact: true }),
      ).toHaveValue("100");
    });
    test("opens common search from the document keyboard and docks narrow panels below the document", async ({
      page,
    }) => {
      await load(page, format);
      await content(page, format).focus();
      await page.keyboard.press("Control+f");
      await expect(
        page.getByRole("textbox", { name: "찾을 내용", exact: true }),
      ).toBeFocused();
      await page
        .getByRole("textbox", { name: "찾을 내용", exact: true })
        .fill("한국어");
      await page
        .getByRole("textbox", { name: "찾을 내용", exact: true })
        .press("Enter");
      await expect(page.locator(".ds-search-match")).not.toHaveCount(0);
      await page.setViewportSize({ width: 640, height: 768 });
      const bounds = (await page
        .locator("[data-document-properties]")
        .boundingBox())!;
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(620);
      expect(
        await page
          .locator("[data-document-properties]")
          .evaluate((e) => getComputedStyle(e).position),
      ).toBe("static");
      const documentBounds = (await page
        .locator(".ds-editor-body")
        .boundingBox())!;
      expect(bounds.y).toBeGreaterThanOrEqual(
        documentBounds.y + documentBounds.height - 1,
      );
      await page
        .getByRole("textbox", { name: "찾을 내용", exact: true })
        .press("Escape");
      await expect(page.locator("[data-document-properties]")).toHaveCount(0);
      await page.getByRole("button", { name: "찾기", exact: true }).click();
      await expect(
        page.getByRole("textbox", { name: "찾을 내용", exact: true }),
      ).toBeVisible();
    });
    test("reports saving state to the host and returns to the committed version", async ({
      page,
    }) => {
      await load(page, format);
      await content(page, format).focus();
      await page.keyboard.press("Control+a");
      await page.keyboard.insertText("호스트 저장 상태 확인");
      await page.evaluate(() => {
        window.documentStudioTest.mode = "delayed";
        void window.documentStudioTest.save();
      });
      await expect
        .poll(() =>
          page.evaluate(() => window.documentStudioTest.state()?.saving),
        )
        .toBe(true);
      await expect
        .poll(() =>
          page.evaluate(() => window.documentStudioTest.state()?.dirty),
        )
        .toBe(false);
      expect(
        await page.evaluate(() =>
          window.documentStudioTest.stateEvents.some((s) => s.saving && s.busy),
        ),
      ).toBe(true);
      await expect
        .poll(() =>
          page.evaluate(
            () => window.documentStudioTest.stateEvents.at(-1)?.saving,
          ),
        )
        .toBe(false);
      expect(
        await page.evaluate(() => window.documentStudioTest.state()?.version),
      ).toBe("v2");
    });
  });
