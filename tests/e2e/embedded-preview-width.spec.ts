import { test, expect } from "@playwright/test";

for (const format of ["docx", "hwpx"] as const) {
  test(`${format}: a copy page preview fits the host column instead of the browser width`, async ({
    page,
  }, testInfo) => {
    await page.goto("/harness.html");
    await page.waitForFunction(() => !!window.documentStudioTest);
    await page.evaluate(async (format) => {
      const api = window.documentStudioTest;
      api.embedded = true;
      const host = document.querySelector<HTMLElement>("[data-test-host]")!;
      host.style.width = "560px";
      host.style.marginLeft = "180px";
      await api.createTemplate(format, {
        fileName: `narrow.${format}`,
        blocks: [{ kind: "paragraph", text: "안내 {{이름}}" }],
      });
    }, format);
    await expect
      .poll(() => page.evaluate(() => window.documentStudioTest.state()?.ready))
      .toBe(true);
    await page.getByRole("button", { name: "빠른 작업", exact: true }).click();
    await page
      .getByRole("tab", { name: "문서 일괄 생성", exact: true })
      .click();
    await page
      .getByRole("button", { name: "현재 편집본을 서식으로 등록", exact: true })
      .click();
    await page
      .getByLabel("메일머지 입력 데이터", { exact: true })
      .fill("이름\n좁은 영역 검증");
    await page
      .getByRole("button", { name: "같은 이름의 열 연결", exact: true })
      .click();
    await page
      .getByRole("button", { name: "생성 미리보기", exact: true })
      .click();
    await page
      .getByRole("button", { name: "대표 사본 페이지 미리보기", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "대표 사본 페이지 미리보기",
      exact: true,
    });
    await expect(
      dialog.locator('.ds-editor-body[aria-busy="false"]'),
    ).toBeVisible({ timeout: 35000 });
    const bounds = await dialog.boundingBox();
    const host = await page.locator("[data-test-host]").boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(host!.x);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(
      host!.x + host!.width,
    );
    expect(
      await dialog.evaluate(
        (element) => element.scrollWidth - element.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: testInfo.outputPath("embedded-copy-preview.png"),
    });
    await page
      .getByRole("button", { name: "페이지 미리보기 닫기", exact: true })
      .click();
    expect(
      await page.evaluate(() => window.documentStudioTest.state()?.zoom),
    ).toBe(1);
    expect(
      await page.evaluate(() => window.documentStudioTest.state()?.dirty),
    ).toBe(false);
  });
}
