import { expect, test, type Page } from "@playwright/test";
import { unzipSync, strFromU8 } from "fflate";
type Format = "docx" | "hwpx";
async function open(page: Page, format: Format, readFailure = false) {
  await page.goto("/harness.html");
  await page.waitForFunction(() => window.documentStudioTest);
  await page.evaluate(
    async ({ format, readFailure }) => {
      const api = window.documentStudioTest;
      api.persistAutomation = true;
      api.failAutomationReads = readFailure;
      await api.load(format, `blank.${format}`);
    },
    { format, readFailure },
  );
  await expect(
    page.getByRole("button", { name: "굵게", exact: true }),
  ).toBeEnabled();
}
async function automation(page: Page) {
  await page.getByRole("button", { name: "문단·표·그림", exact: true }).click();
  await page.getByRole("tab", { name: "업무 자동화", exact: true }).click();
}
for (const format of ["docx", "hwpx"] as const) {
  test(`${format}: memory-only inputs reject a promised draft transition and remain available for explicit download or discard`, async ({
    page,
  }) => {
    await page.goto("/harness.html");
    await page.waitForFunction(() => window.documentStudioTest);
    await page.evaluate(
      (format) => window.documentStudioTest.load(format, `blank.${format}`),
      format,
    );
    await expect(
      page.getByRole("button", { name: "굵게", exact: true }),
    ).toBeEnabled();
    await automation(page);
    const input = page.getByLabel("금액 목록", { exact: true });
    await input.fill("메모리에만 남은 고유 입력");
    const failure = await page.evaluate(async () => {
      try {
        await window.documentStudioTest.closeAfterDraft();
        return "accepted";
      } catch (e) {
        return String(e);
      }
    });
    expect(failure).toContain("현재 세션에만");
    await expect(input).toHaveValue("메모리에만 남은 고유 입력");
    await page.getByRole("button", { name: "닫기", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText(
      "자동화 입력도 사라집니다",
    );
    await expect(
      page.getByRole("button", { name: "자동화 입력 내려받기", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "계속 편집", exact: true }).click();
    await expect(input).toHaveValue("메모리에만 남은 고유 입력");
  });
  test(`${format}: document commits despite automation write failure, preserves navigation and retries inputs without upload`, async ({
    page,
  }) => {
    await open(page, format);
    await automation(page);
    await page.evaluate(() => {
      window.documentStudioTest.failAutomationWrites = true;
    });
    const input = page.getByLabel("금액 목록", { exact: true });
    await input.fill("98765");
    await page.evaluate(async () => {
      await window.documentStudioTest.execute({
        id: "insertText",
        value: "저장할 본문",
      });
      await window.documentStudioTest.save();
    });
    const result = await page.evaluate(() => ({
      state: window.documentStudioTest.state(),
      saved: window.documentStudioTest.savedEvent,
      saves: window.documentStudioTest.saves,
    }));
    expect(result.saves).toBe(1);
    expect(result.state).toMatchObject({
      dirty: false,
      automationDraftPending: true,
      automationDraftReady: true,
    });
    expect(result.saved?.automationDraft).toMatchObject({
      pending: true,
      error: expect.stringContaining("용량 초과"),
    });
    expect(
      result.saved?.warnings?.some(
        (warning) => warning.code === "automation-draft-pending",
      ),
    ).toBe(true);
    const zip = unzipSync(new Uint8Array(result.saved!.bytes));
    expect(
      strFromU8(
        zip[format === "docx" ? "word/document.xml" : "Contents/section0.xml"]!,
      ),
    ).toContain("저장할 본문");
    await expect(page.locator(".ds-save-status").first()).toContainText(
      "문서 변경사항 저장됨",
    );
    await expect(input).toHaveValue("98765");
    const failure = await page.evaluate(async () => {
      try {
        await window.documentStudioTest.closeAfterDraft();
        return "accepted";
      } catch (e) {
        return String(e);
      }
    });
    expect(failure).toContain("용량 초과");
    await expect(input).toHaveValue("98765");
    await page.evaluate(async () => {
      window.documentStudioTest.failAutomationWrites = false;
      await window.documentStudioTest.flushAutomationDraft();
    });
    expect(await page.evaluate(() => window.documentStudioTest.saves)).toBe(1);
    expect(
      await page.evaluate(() => window.documentStudioTest.state()?.warnings),
    ).toEqual([]);
    await page.evaluate(() => window.documentStudioTest.closeAfterDraft());
    await expect(page.getByText("편집기 닫힘", { exact: true })).toBeVisible();
    await page.evaluate(async (format) => {
      await window.documentStudioTest.load(format, `blank.${format}`);
    }, format);
    await expect(
      page.getByRole("button", { name: "굵게", exact: true }),
    ).toBeEnabled();
    await automation(page);
    await expect(input).toHaveValue("98765");
  });
  test(`${format}: failed automation recovery cannot block document storage or allow a clean transition`, async ({
    page,
  }) => {
    await open(page, format, true);
    await expect
      .poll(() =>
        page.evaluate(
          () => window.documentStudioTest.state()?.automationDraftReady,
        ),
      )
      .toBe(false);
    await page.evaluate(async () => {
      await window.documentStudioTest.execute({
        id: "insertText",
        value: "복구 오류에도 보존",
      });
      await window.documentStudioTest.save();
    });
    expect(
      await page.evaluate(() => ({
        saves: window.documentStudioTest.saves,
        state: window.documentStudioTest.state(),
      })),
    ).toMatchObject({
      saves: 1,
      state: { dirty: false, automationDraftReady: false },
    });
    await page.evaluate(async (format) => {
      await window.documentStudioTest.load(format);
    }, format);
    await expect(page.locator("[data-source-id]")).toHaveAttribute(
      "data-source-id",
      `test:sample.${format}`,
    );
    expect(
      await page.evaluate(() => window.documentStudioTest.state()?.documentId),
    ).toBe(`test:blank.${format}`);
    await page
      .getByRole("button", { name: "새 원본 열기", exact: true })
      .click();
    await expect(page.getByRole("alert").first()).toContainText(
      "자동화 조회 실패",
    );
    expect(
      await page.evaluate(() => window.documentStudioTest.state()?.documentId),
    ).toBe(`test:blank.${format}`);
  });
  test(`${format}: clean document does not upload again when separate local storage fails`, async ({
    page,
  }) => {
    await open(page, format);
    await automation(page);
    await page.evaluate(() => {
      window.documentStudioTest.failAutomationWrites = true;
    });
    await page.getByLabel("금액 목록", { exact: true }).fill("7654");
    await page.evaluate(() =>
      window.documentStudioTest.save({ onlyIfDirty: true }),
    );
    expect(await page.evaluate(() => window.documentStudioTest.saves)).toBe(0);
    expect(
      await page.evaluate(
        () => window.documentStudioTest.state()?.warnings?.[0]?.code,
      ),
    ).toBe("automation-draft-pending");
  });
  test(`${format}: structured table and card previews match source values, escape markup and invalidate after edits`, async ({
    page,
  }) => {
    await open(page, format);
    await automation(page);
    const picker = page.getByLabel("자동화 기능", { exact: true });
    const preview = page.getByRole("button", {
      name: "결과 미리보기",
      exact: true,
    });
    for (const utility of ["참석자 명단", "회의명패", "명찰"]) {
      await picker.selectOption(utility);
      const input = page.locator("[data-automation-input]");
      await input.fill(
        "검증한글,개발팀,담당자\n<img src=x onerror=alert(1)>,문서팀,검토자",
      );
      await preview.click();
      const structure = page.getByRole("region", {
        name: `${utility} 구조 미리보기`,
        exact: true,
      });
      await expect(structure).toBeVisible();
      await expect(structure).toContainText("검증한글");
      await expect(structure).toContainText("<img src=x onerror=alert(1)>");
      await expect(structure.locator("img, script")).toHaveCount(0);
      if (utility === "참석자 명단") {
        await expect(
          structure.getByRole("table", {
            name: "참석자 명단 · 표 1",
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          structure.getByRole("columnheader", { name: "성명", exact: true }),
        ).toBeVisible();
        await expect(structure.locator("tbody tr")).toHaveCount(2);
      } else await expect(structure.getByRole("article")).toHaveCount(2);
      await expect(
        page.getByLabel("업무 자동화 결과", { exact: true }),
      ).toHaveAttribute("readonly", "");
      await input.fill("변경한글,새팀,새직위");
      await expect(structure).toHaveCount(0);
      await preview.click();
      await expect(structure).toContainText("변경한글");
      await expect(structure).not.toContainText("검증한글");
    }
    await picker.selectOption("마크다운 보고서");
    await page
      .getByLabel("보고서 마크다운", { exact: true })
      .fill("# 제목\n본문\n\n| 항목 | 값 |\n|---|---|\n| 검증 | 123 |");
    await preview.click();
    await expect(
      page.getByRole("region", { name: "마크다운 보고서 구조 미리보기" }),
    ).toContainText("123");
    expect(
      await page.evaluate(() => window.documentStudioTest.state()?.dirty),
    ).toBe(false);
  });
  test(`${format}: bounded preview at a narrow width keeps every row in the generated document`, async ({
    page,
  }) => {
    await open(page, format);
    await page.setViewportSize({ width: 900, height: 768 });
    await automation(page);
    await page
      .getByLabel("자동화 기능", { exact: true })
      .selectOption("참석자 명단");
    await page
      .locator("[data-automation-input]")
      .fill(
        Array.from({ length: 60 }, (_, i) => `이름${i + 1},검증팀,담당`).join(
          "\n",
        ),
      );
    await page
      .getByRole("button", { name: "결과 미리보기", exact: true })
      .click();
    const structure = page.getByRole("region", {
      name: "참석자 명단 구조 미리보기",
      exact: true,
    });
    await expect(structure.locator("tbody tr")).toHaveCount(19);
    await expect(structure).toContainText("미리보기 일부만");
    expect(
      await structure.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
    const previousSession = await page.evaluate(
      () => window.documentStudioTest.state()!.sessionId,
    );
    await page
      .getByRole("button", {
        name: "구조를 유지해 새 문서 만들기",
        exact: true,
      })
      .click();
    await expect
      .poll(() =>
        page.evaluate(() => window.documentStudioTest.creationsCompleted),
      )
      .toBe(1);
    await expect
      .poll(() =>
        page.evaluate((previousSession) => {
          const state = window.documentStudioTest.state();
          return state?.ready && state.sessionId !== previousSession;
        }, previousSession),
      )
      .toBe(true);
    await expect
      .poll(async () => {
        const bytes = await page.evaluate(() =>
          window.documentStudioTest.export(),
        );
        return strFromU8(
          unzipSync(new Uint8Array(bytes))[
            format === "docx" ? "word/document.xml" : "Contents/section0.xml"
          ]!,
        );
      })
      .toContain("이름60");
  });
}
