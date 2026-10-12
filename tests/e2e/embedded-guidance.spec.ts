import { expect, test } from "@playwright/test";

for (const format of ["docx", "hwpx"] as const)
  test(`${format} explains unavailable table actions and labels the advanced UI`, async ({
    page,
  }) => {
    await page.goto("/harness.html");
    await page.waitForFunction(() => !!window.documentStudioTest);
    await page.evaluate(async (format) => {
      window.documentStudioTest.embedded = true;
      await window.documentStudioTest.load(format);
    }, format);
    await expect
      .poll(() => page.evaluate(() => window.documentStudioTest.state()?.ready))
      .toBe(true);
    await page
      .getByRole("button", { name: "문단·표·그림", exact: true })
      .click();
    await page.getByRole("tab", { name: "표", exact: true }).click();
    await expect(page.locator("[data-document-properties]")).toContainText(
      "표 안의 셀을 먼저 선택하세요",
    );
    const action = page.getByRole("button", {
      name: "아래에 행 삽입",
      exact: true,
    });
    await expect(action).toBeDisabled();
    expect(await action.getAttribute("title")).toBeTruthy();
    expect(await action.getAttribute("aria-describedby")).toBeTruthy();
    await page
      .getByRole("button", { name: "편집 도구 닫기", exact: true })
      .click();
    await page
      .getByRole("button", { name: "삽입·쪽 메뉴", exact: true })
      .click();
    if (format === "docx") {
      const menus = page.getByLabel("DOCX 확장 도구", { exact: true });
      for (const label of ["파일", "서식", "삽입"])
        await expect(
          menus.getByRole("menuitem", { name: label, exact: true }),
        ).toBeVisible();
      await expect(
        menus.getByRole("menuitem", { name: "File", exact: true }),
      ).toHaveCount(0);
    } else {
      await expect(
        page.frameLocator("iframe").getByText("파일", { exact: true }),
      ).toBeVisible();
      await expect(
        page.frameLocator("iframe").getByRole("combobox"),
      ).toHaveCount(0);
    }
  });
