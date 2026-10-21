import { expect, test } from "@playwright/test";
for (const format of ["docx", "hwpx"] as const) {
  test(`${format}: quick inputs survive tabs and panel close, stale previews do not`, async ({
    page,
  }) => {
    await page.goto("/harness.html");
    await page.waitForFunction(() => window.documentStudioTest);
    await page.evaluate(async (format) => {
      await window.documentStudioTest.load(format);
    }, format);
    await expect
      .poll(() => page.evaluate(() => window.documentStudioTest.state()?.ready))
      .toBe(true);
    await page.getByRole("button", { name: "빠른 작업", exact: true }).click();
    await page.getByLabel("정리할 붙여넣기 원고").fill("보존 원고\u200b [1]");
    await page.getByLabel("빠른 작업 기준일").fill("2026-10-21");
    await page.getByLabel("빠른 작업 주간 범위").selectOption("calendar");
    await page.getByLabel("빠른 작업 날짜 표시").selectOption("iso");
    await page.getByRole("button", { name: "원고 정리 미리보기" }).click();
    for (const tab of ["글자", "문단", "문서 일괄 생성"]) {
      await page.getByRole("tab", { name: tab, exact: true }).click();
      await page.getByRole("tab", { name: "빠른 작업", exact: true }).click();
      await expect(page.getByLabel("정리할 붙여넣기 원고")).toHaveValue(
        "보존 원고\u200b [1]",
      );
      await expect(page.getByLabel("빠른 작업 미리보기")).toHaveCount(0);
    }
    await page
      .getByRole("button", { name: "편집 도구 닫기", exact: true })
      .click();
    await page.getByRole("button", { name: "빠른 작업", exact: true }).click();
    await expect(page.getByLabel("정리할 붙여넣기 원고")).toHaveValue(
      "보존 원고\u200b [1]",
    );
    await expect(page.getByLabel("빠른 작업 기준일")).toHaveValue("2026-10-21");
    await expect(page.getByLabel("빠른 작업 주간 범위")).toHaveValue(
      "calendar",
    );
    await expect(page.getByLabel("빠른 작업 날짜 표시")).toHaveValue("iso");
    const blocked = await page.evaluate(async () => {
      try {
        await window.documentStudioTest.closeAfterDraft();
        return false;
      } catch {
        return true;
      }
    });
    expect(blocked).toBe(true);
    await expect(page.getByLabel("정리할 붙여넣기 원고")).toHaveValue(
      "보존 원고\u200b [1]",
    );
  });
  test(`${format}: quick draft persistence isolates documents and recovers after a write failure`, async ({
    page,
  }) => {
    await page.goto("/harness.html");
    await page.waitForFunction(() => window.documentStudioTest);
    await page.evaluate(async (format) => {
      const h = window.documentStudioTest;
      h.persistAutomation = true;
      h.automationNamespace = "quick-test";
      await h.load(format, "sample." + format);
    }, format);
    await expect
      .poll(() =>
        page.evaluate(
          () => window.documentStudioTest.state()?.automationDraftReady,
        ),
      )
      .toBe(true);
    await expect
      .poll(() => page.evaluate(() => window.documentStudioTest.state()?.ready))
      .toBe(true);
    await page.getByRole("button", { name: "빠른 작업", exact: true }).click();
    await page.evaluate(() => {
      window.documentStudioTest.failAutomationWrites = true;
    });
    await page.getByLabel("정리할 붙여넣기 원고").fill("첫 문서 전용 원고");
    await expect
      .poll(() =>
        page.evaluate(
          () => window.documentStudioTest.state()?.automationDraftError,
        ),
      )
      .toContain("보관하지 못했습니다");
    await page
      .getByRole("button", { name: "편집 도구 닫기", exact: true })
      .click();
    await page.getByRole("button", { name: "빠른 작업", exact: true }).click();
    await expect(page.getByLabel("정리할 붙여넣기 원고")).toHaveValue(
      "첫 문서 전용 원고",
    );
    await page.evaluate(async () => {
      window.documentStudioTest.failAutomationWrites = false;
      await window.documentStudioTest.flushAutomationDraft();
    });
    await page.evaluate(async (format) => {
      await window.documentStudioTest.load(format, "rich." + format);
    }, format);
    await expect
      .poll(() =>
        page.evaluate(() => window.documentStudioTest.state()?.documentId),
      )
      .toBe("test:rich." + format);
    await expect
      .poll(() => page.evaluate(() => window.documentStudioTest.state()?.ready))
      .toBe(true);
    await page.getByRole("button", { name: "빠른 작업", exact: true }).click();
    await expect(page.getByLabel("정리할 붙여넣기 원고")).toHaveValue("");
    await page.evaluate(async (format) => {
      await window.documentStudioTest.load(format, "sample." + format);
    }, format);
    await expect
      .poll(() =>
        page.evaluate(() => window.documentStudioTest.state()?.documentId),
      )
      .toBe("test:sample." + format);
    await expect
      .poll(() => page.evaluate(() => window.documentStudioTest.state()?.ready))
      .toBe(true);
    await page.getByRole("button", { name: "빠른 작업", exact: true }).click();
    await expect(page.getByLabel("정리할 붙여넣기 원고")).toHaveValue(
      "첫 문서 전용 원고",
    );
  });
}
