import { expect, test, type Page } from "@playwright/test";

type Format = "docx" | "hwp" | "hwpx";

test.use({ timezoneId: "Asia/Seoul" });

function readDocument(page: Page) {
  return page.evaluate(() => {
    const agent = window.documentStudioTest.agent;
    return agent.readDocument({ documentId: agent.getState().documentId });
  });
}

async function openEmbedded(
  page: Page,
  format: Format,
  width: number,
  height: number,
) {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto("/harness.html");
  await page.waitForFunction(() => !!window.documentStudioTest);
  await page.evaluate(async (format) => {
    window.documentStudioTest.embedded = true;
    await window.documentStudioTest.load(format, `blank.${format}`);
  }, format);
  await expect
    .poll(() => page.evaluate(() => window.documentStudioTest.state()?.ready))
    .toBe(true);
  await page.locator(".ds-editor").evaluate(
    (element, size) => {
      Object.assign((element as HTMLElement).style, {
        width: `${size.width}px`,
        height: `${size.height}px`,
      });
    },
    { width, height },
  );
}

async function resizeWorkArea(page: Page, height: number) {
  await page.locator(".ds-editor").evaluate((editor, height) => {
    const work = editor.querySelector(".ds-work-area")!;
    const chromeHeight =
      editor.getBoundingClientRect().height -
      work.getBoundingClientRect().height;
    (editor as HTMLElement).style.height = `${height + chromeHeight}px`;
  }, height);
  await expect
    .poll(
      async () => (await page.locator(".ds-work-area").boundingBox())?.height,
    )
    .toBeCloseTo(height, 0);
}

test("a short dock scrolls to apply and restores focus when extra dates are collapsed", async ({
  page,
}) => {
  await openEmbedded(page, "docx", 320, 430);
  await resizeWorkArea(page, 220);
  await page.getByRole("button", { name: "빠른 작업", exact: true }).click();
  const more = page.getByRole("button", { name: "더보기", exact: true });
  await more.click();
  await page.getByRole("button", { name: "어제", exact: true }).click();
  await more.click();
  const apply = page
    .getByLabel("빠른 작업 미리보기")
    .getByRole("button", { name: "적용", exact: true });
  await apply.press("Enter");
  await expect(page.getByText(/적용했습니다/)).toBeVisible();
  await expect(more).toBeFocused();
});

test("replacing the host's draft store clears the prior date preview", async ({
  page,
}) => {
  await openEmbedded(page, "docx", 560, 514);
  await page.getByRole("button", { name: "빠른 작업", exact: true }).click();
  await page.getByRole("button", { name: "오늘", exact: true }).click();
  const result = page.getByLabel("빠른 작업 미리보기");
  await expect(result).toBeVisible();
  await page.evaluate(() => {
    window.documentStudioTest.persistAutomation = true;
    window.documentStudioTest.rerender();
  });
  await expect
    .poll(() =>
      page.evaluate(
        () => window.documentStudioTest.state()?.automationDraftReady,
      ),
    )
    .toBe(true);
  await expect(result).toHaveCount(0);
  await page.getByRole("button", { name: "오늘", exact: true }).click();
  await expect(result).toBeVisible();
});

for (const format of ["docx", "hwp", "hwpx"] as const) {
  test(`${format}: quick actions leaves expanded automation and returns focus`, async ({
    page,
  }) => {
    await openEmbedded(page, format, 560, 514);
    const quick = page.getByRole("button", { name: "빠른 작업", exact: true });
    const tools = page.getByRole("region", { name: "추가 편집 도구" });
    await page
      .getByRole("button", { name: "문단·표·그림", exact: true })
      .click();
    await page.getByRole("tab", { name: "업무 자동화", exact: true }).click();
    await expect(tools).toHaveAttribute("data-expanded", "true");

    await quick.click();
    await expect(tools).toHaveAttribute("data-expanded", "false");
    const document = (await page.locator(".ds-editor-body").boundingBox())!;
    const work = (await page.locator(".ds-work-area").boundingBox())!;
    const panel = (await tools.boundingBox())!;
    expect(document.height).toBeGreaterThanOrEqual(work.height * 0.55 - 1);
    expect(document.y + document.height).toBeLessThanOrEqual(panel.y + 1);
    await expect(tools.getByRole("tablist")).toHaveCount(0);
    await tools
      .getByRole("button", { name: "문서 도구", exact: true })
      .press("Enter");
    const paragraph = tools.getByRole("tab", { name: "문단", exact: true });
    await expect(paragraph).toHaveAttribute("aria-selected", "true");
    await expect(paragraph).toBeFocused();
    await tools.getByRole("tab", { name: "업무 자동화", exact: true }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(
      tools.getByRole("button", { name: "날짜·기간", exact: true }),
    ).toBeFocused();
    await tools
      .getByRole("button", { name: "오늘", exact: true })
      .press("Escape");
    await expect(tools).toHaveCount(0);
    await expect(quick).toBeFocused();
  });

  for (const [width, height] of [
    [1023, 646],
    [560, 514],
    [320, 520],
  ]) {
    test(`${format}: today shows the result and apply without scrolling in a ${width}px host`, async ({
      page,
    }) => {
      await page.clock.setFixedTime(new Date("2026-11-09T04:00:00Z"));
      await openEmbedded(page, format, width!, height!);
      if (width === 320) await resizeWorkArea(page, 400);
      const before = await readDocument(page);
      const selection = await page.evaluate(
        () => window.documentStudioTest.state()?.selectionKey,
      );
      await page
        .getByRole("button", { name: "빠른 작업", exact: true })
        .click();
      const today = page.getByRole("button", { name: "오늘", exact: true });
      expect(
        await today.evaluate((button) => {
          const { x, y, width, height } = button.getBoundingClientRect();
          return button.contains(
            document.elementFromPoint(x + width / 2, y + height / 2),
          );
        }),
      ).toBe(true);
      await today.click();
      const result = page.getByLabel("빠른 작업 미리보기", { exact: true });
      const apply = result.getByRole("button", { name: "적용", exact: true });
      await expect(result).toContainText("2026. 11. 9.(월)");
      await expect(apply).toBeEnabled();
      await expect
        .poll(() =>
          result.evaluate((element) => {
            const result = element.getBoundingClientRect();
            const button = element.querySelector("button")!;
            const control = button.getBoundingClientRect();
            const work = document
              .querySelector(".ds-work-area")!
              .getBoundingClientRect();
            const doc = document
              .querySelector(".ds-editor-body")!
              .getBoundingClientRect();
            const panel = element
              .closest(".ds-editing-tools")!
              .getBoundingClientRect();
            const hit = document.elementFromPoint(
              control.left + control.width / 2,
              control.top + control.height / 2,
            );
            return {
              documentVisible:
                doc.height >= work.height * 0.55 - 1 &&
                doc.bottom <= panel.top + 1,
              resultVisible:
                result.top >= panel.top &&
                result.bottom <= panel.bottom + 1 &&
                result.bottom <= innerHeight &&
                result.left >= panel.left &&
                result.right <= panel.right + 1,
              applyReachable: button.contains(hit),
              scrolled: Array.from(
                element.closest(".ds-editing-tools")!.querySelectorAll("div"),
              ).some((child) => child.scrollTop > 0),
            };
          }),
        )
        .toEqual({
          documentVisible: true,
          resultVisible: true,
          applyReachable: true,
          scrolled: false,
        });
      expect((await readDocument(page)).text).toBe(before.text);
      expect(
        await page.evaluate(
          () => window.documentStudioTest.state()?.selectionKey,
        ),
      ).toBe(selection);
      if (width === 560) {
        await page.evaluate(() => {
          window.documentStudioTest.readOnly = true;
          window.documentStudioTest.rerender();
        });
        await expect(apply).toBeDisabled();
      }
    });
  }

  test(`${format}: long cleanup keeps apply reachable and inserts once`, async ({
    page,
  }) => {
    await openEmbedded(page, format, 560, 514);
    const before = (await readDocument(page)).text;
    await page.getByRole("button", { name: "빠른 작업", exact: true }).click();
    await page.getByRole("button", { name: "원고 정리", exact: true }).click();
    const text = Array.from(
      { length: 70 },
      (_, index) => `검증원고-${index}-끝\u200b`,
    ).join("\n");
    await page.getByLabel("정리할 붙여넣기 원고").fill(text);
    await page
      .getByRole("button", { name: "원고 정리 미리보기", exact: true })
      .click();
    const apply = page
      .getByLabel("빠른 작업 미리보기", { exact: true })
      .getByRole("button", { name: "적용", exact: true });
    await expect(apply).toBeEnabled();
    expect(
      await apply.evaluate((button) => {
        const { x, y, width, height } = button.getBoundingClientRect();
        return button.contains(
          document.elementFromPoint(x + width / 2, y + height / 2),
        );
      }),
    ).toBe(true);
    await apply.evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
    await expect(page.getByText(/적용했습니다/)).toBeVisible();
    const after = (await readDocument(page)).text;
    expect(after.split("검증원고-0-끝")).toHaveLength(2);
    expect(after).toContain("검증원고-69-끝");
    await page.getByRole("button", { name: "되돌리기", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "다시 실행", exact: true }),
    ).toBeEnabled();
    expect((await readDocument(page)).text).toBe(before);
  });
}
