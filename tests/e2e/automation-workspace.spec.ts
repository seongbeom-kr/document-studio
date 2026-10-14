import { expect, test, type Page } from "@playwright/test";

type Format = "docx" | "hwpx";
async function load(page: Page, format: Format, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.goto("/harness.html");
  await page.waitForFunction(() => !!window.documentStudioTest);
  await page.evaluate(async (format) => {
    sessionStorage.removeItem("document-studio:tool-size");
    window.documentStudioTest.embedded = true;
    window.documentStudioTest.persistAutomation = true;
    await window.documentStudioTest.load(format, `blank.${format}`);
  }, format);
  await expect
    .poll(() => page.evaluate(() => window.documentStudioTest.state()?.ready))
    .toBe(true);
}

async function readableControls(page: Page) {
  return page.locator(".ds-tools-content").evaluate((body) => {
    const box = body.getBoundingClientRect();
    const bounds = (selector: string) =>
      body.querySelector(selector)!.getBoundingClientRect();
    const select = bounds('[aria-label="자동화 기능"]');
    const input = bounds("[data-automation-input]");
    const preview = Array.from(body.querySelectorAll("button"))
      .find((b) => b.textContent?.trim() === "결과 미리보기")!
      .getBoundingClientRect();
    const contains = (r: DOMRect) =>
      r.top >= box.top &&
      r.bottom <= box.bottom &&
      r.left >= box.left &&
      r.right <= box.right;
    const inputHit = document.elementFromPoint(
      input.left + input.width / 2,
      input.top + 40,
    );
    return {
      height: box.height,
      scrollTop: body.scrollTop,
      selectVisible: contains(select),
      previewVisible: contains(preview),
      inputVisibleHeight: Math.max(
        0,
        Math.min(input.bottom, box.bottom) - Math.max(input.top, box.top),
      ),
      inputUnobscured: inputHit?.hasAttribute("data-automation-input") ?? false,
      horizontalOverflow: body.scrollWidth > body.clientWidth + 2,
    };
  });
}

for (const format of ["docx", "hwpx"] as const) {
  for (const [width, height, hostWidth, hostHeight] of [
    [1366, 900, 1023, 646], // Actual reviewed host content region.
    [1366, 768, 1023, 514],
    [480, 900, 456, 700],
  ]) {
    test(`${format}: automation exposes input and preview without scrolling at ${width}x${height}`, async ({
      page,
    }, info) => {
      await load(page, format, width!, height!);
      await page.locator(".ds-editor").evaluate(
        (element, size) => {
          (element as HTMLElement).style.width = `${size.width}px`;
          (element as HTMLElement).style.height = `${size.height}px`;
        },
        { width: hostWidth!, height: hostHeight! },
      );
      await page.evaluate(() =>
        window.documentStudioTest.execute({ id: "selectAll" }),
      );
      const before = await page.evaluate(() =>
        window.documentStudioTest.state(),
      );
      const native =
        format === "hwpx"
          ? page.locator("iframe")
          : page.getByRole("textbox", {
              name: "Document content",
              exact: true,
            });
      await native.evaluate((element) =>
        element.setAttribute("data-workspace-test", "original"),
      );
      await page
        .getByRole("button", { name: "문단·표·그림", exact: true })
        .click();
      await expect(
        page.getByRole("slider", { name: "도구 영역 크기" }),
      ).toHaveValue("34");
      await page.getByRole("tab", { name: "업무 자동화", exact: true }).click();
      await expect(page.locator(".ds-editing-tools")).toHaveAttribute(
        "data-expanded",
        "true",
      );
      await page
        .getByLabel("자동화 기능", { exact: true })
        .selectOption("마크다운 보고서");
      const space = await readableControls(page);
      expect(space.scrollTop).toBe(0);
      expect(space.height).toBeGreaterThan(300);
      expect(space.selectVisible).toBe(true);
      expect(space.previewVisible).toBe(true);
      expect(space.inputVisibleHeight).toBeGreaterThan(80);
      expect(space.inputUnobscured).toBe(true);
      expect(space.horizontalOverflow).toBe(false);
      await expect(page.getByLabel("현재 적용 대상")).toBeVisible();
      await expect(page.locator(".ds-editor-body")).toHaveAttribute(
        "inert",
        "",
      );
      const input = page.getByLabel("보고서 마크다운", { exact: true });
      await input.fill("# 크기를 바꿔도 유지\n원본 입력");
      await page
        .getByRole("button", { name: "결과 미리보기", exact: true })
        .click();
      await expect(
        page.getByRole("region", {
          name: "마크다운 보고서 구조 미리보기",
          exact: true,
        }),
      ).toBeVisible();
      await page.screenshot({
        path: info.outputPath(`${format}-${width}x${height}.png`),
      });
      await page
        .getByRole("button", { name: "문서와 함께 보기", exact: true })
        .click();
      await expect(page.locator(".ds-editing-tools")).toHaveAttribute(
        "data-expanded",
        "false",
      );
      // A rerender must respect the explicit return to the document.
      await page.evaluate(() => window.documentStudioTest.rerender());
      await expect(page.locator(".ds-editing-tools")).toHaveAttribute(
        "data-expanded",
        "false",
      );
      await expect(input).toHaveValue("# 크기를 바꿔도 유지\n원본 입력");
      await expect(
        page.getByRole("slider", { name: "도구 영역 크기" }),
      ).toHaveValue("34");
      await expect(native).toHaveAttribute("data-workspace-test", "original");
      await expect(page.locator(".ds-editor-body")).not.toHaveAttribute(
        "inert",
        "",
      );
      const after = await page.evaluate(() =>
        window.documentStudioTest.state(),
      );
      expect(after?.revision).toBe(before?.revision);
      expect(after?.selectionKey).toBe(before?.selectionKey);
      expect(after?.dirty).toBe(before?.dirty);
      expect(after?.zoom).toBe(1);
      await page
        .getByRole("button", { name: "편집 도구 닫기", exact: true })
        .click();
      await page
        .getByRole("button", { name: "문단·표·그림", exact: true })
        .click();
      await page.getByRole("tab", { name: "업무 자동화", exact: true }).click();
      await expect(page.locator(".ds-editing-tools")).toHaveAttribute(
        "data-expanded",
        "true",
      );
      await expect(input).toHaveValue("# 크기를 바꿔도 유지\n원본 입력");
    });
  }

  test(`${format}: roomy host stays docked and resizing to laptop expands only the tools`, async ({
    page,
  }) => {
    await load(page, format, 1920, 1080);
    await page
      .getByRole("button", { name: "문단·표·그림", exact: true })
      .click();
    await page.getByRole("tab", { name: "업무 자동화", exact: true }).click();
    await expect(page.locator(".ds-editing-tools")).toHaveAttribute(
      "data-expanded",
      "false",
    );
    await page
      .getByLabel("자동화 기능", { exact: true })
      .selectOption("마크다운 보고서");
    await page
      .getByLabel("보고서 마크다운", { exact: true })
      .fill("# 크기 조절 입력\n유지");
    await page.getByRole("slider", { name: "도구 영역 크기" }).fill("48");
    await page.setViewportSize({ width: 1000, height: 768 });
    await expect(page.locator(".ds-editing-tools")).toHaveAttribute(
      "data-expanded",
      "true",
    );
    await expect(
      page.getByLabel("보고서 마크다운", { exact: true }),
    ).toHaveValue("# 크기 조절 입력\n유지");
    await page
      .getByRole("button", { name: "문서와 함께 보기", exact: true })
      .click();
    await expect(
      page.getByRole("slider", { name: "도구 영역 크기" }),
    ).toHaveValue("48");
    await expect(
      page.getByRole("combobox", { name: "확대", exact: true }),
    ).toHaveValue("100");
  });
}
