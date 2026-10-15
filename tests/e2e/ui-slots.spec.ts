import { expect, test, type Page } from "@playwright/test";

async function open(page: Page, format: string, host = "browser") {
  await page.goto(`/ui-harness.html?format=${format}&host=${host}`);
  await page.waitForFunction(() => Boolean(window.uiStudioTest));
  await page.evaluate(() => window.uiStudioTest.mount());
  await expect
    .poll(() => page.evaluate(() => window.uiStudioTest.state().ready))
    .toBe(true);
  await expect(page.locator("#top").getByRole("toolbar")).toBeVisible();
}
for (const format of ["docx", "hwpx"]) {
  for (const host of ["browser", "react"]) {
    test(`${host}/${format}: external chrome keeps editing, theme, readonly and saved bytes`, async ({
      page,
    }) => {
      await open(page, format, host);
      const before = await page.evaluate(
        () => window.uiStudioTest.state().sessionId,
      );
      await page.evaluate(() =>
        window.uiStudioTest.execute("영역을 옮겨도 보존"),
      );
      await page.evaluate(() => window.uiStudioTest.rerender());
      await page.evaluate(() => window.uiStudioTest.theme());
      expect(
        await page.evaluate(() => window.uiStudioTest.state().sessionId),
      ).toBe(before);
      await expect(page.locator("#top .ds-toolbar")).toHaveCSS(
        "background-color",
        "rgb(32, 37, 43)",
      );
      await expect(page.locator("#bottom .ds-document-footer")).toHaveCSS(
        "background-color",
        "rgb(32, 37, 43)",
      );
      await page.evaluate(() => window.uiStudioTest.readonly(true));
      expect(
        await page.evaluate(() =>
          window.uiStudioTest.execute("FORBIDDEN").then(
            () => "allowed",
            () => "blocked",
          ),
        ),
      ).toBe("blocked");
      await expect(
        page.locator("#top").getByRole("button", { name: "굵게", exact: true }),
      ).toBeDisabled();
      await page.evaluate(() => window.uiStudioTest.readonly(false));
      await page.evaluate(() => window.uiStudioTest.save());
      await page.evaluate(() => window.uiStudioTest.reopen());
      await expect
        .poll(() => page.evaluate(() => window.uiStudioTest.state().ready))
        .toBe(true);
      expect(
        (await page.evaluate(() => window.uiStudioTest.read())).text,
      ).toContain("영역을 옮겨도 보존");
      await page.evaluate(() => window.uiStudioTest.close());
      await expect(page.locator(".ds-ui-region")).toHaveCount(0);
      await expect(page.locator("#host-marker")).toHaveCount(1);
    });
    test(`${host}/${format}: moving tools preserves unsaved form fields and focus`, async ({
      page,
    }) => {
      await open(page, format, host);
      const before = await page.evaluate(
        () => window.uiStudioTest.state().sessionId,
      );
      await page
        .getByRole("button", { name: "문단·표·그림", exact: true })
        .click();
      await expect(
        page.locator("#side").getByRole("region", { name: "추가 편집 도구" }),
      ).toBeVisible();
      await page.getByRole("tab", { name: "업무 자동화", exact: true }).click();
      await page
        .getByLabel("자동화 기능", { exact: true })
        .selectOption("참석자 명단");
      const field = page.locator("#side textarea").first();
      await field.fill("김하나\t기획팀\t팀장\n박두리\t개발팀\t연구원");
      await field.focus();
      await page.evaluate(() => window.uiStudioTest.relocate("alternative"));
      const moved = page.locator("#alternative textarea").first();
      await expect(moved).toHaveValue(
        "김하나\t기획팀\t팀장\n박두리\t개발팀\t연구원",
      );
      await expect(moved).toBeFocused();
      await page.evaluate(() => window.uiStudioTest.relocate("dock"));
      await expect(page.locator("#editor textarea").first()).toHaveValue(
        "김하나\t기획팀\t팀장\n박두리\t개발팀\t연구원",
      );
      await page.evaluate(() => window.uiStudioTest.relocate("side"));
      await expect(page.locator("#side textarea").first()).toHaveValue(
        "김하나\t기획팀\t팀장\n박두리\t개발팀\t연구원",
      );
      expect(
        await page.evaluate(() => window.uiStudioTest.state().sessionId),
      ).toBe(before);
      // Automation source is intentionally memory-only: closing must preserve the editor on failure.
      expect(
        await page.evaluate(() =>
          window.uiStudioTest.close().then(
            () => "closed",
            () => "blocked",
          ),
        ),
      ).toBe("blocked");
      await expect(page.locator("#side textarea").first()).toBeVisible();
    });
  }
  test(`${format}: custom toolbar uses guarded commands and render errors preserve the editor`, async ({
    page,
  }) => {
    await open(page, format, "react");
    const before = await page.evaluate(
      () => window.uiStudioTest.state().sessionId,
    );
    await page.getByRole("button", { name: "앱 자동화", exact: true }).click();
    await expect(
      page.getByRole("tab", { name: "업무 자동화", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await page.getByRole("button", { name: "편집 도구 닫기" }).click();
    await expect(
      page.getByRole("button", { name: "앱 자동화", exact: true }),
    ).toBeFocused();
    await page.evaluate(() => window.uiStudioTest.toolbar("replace"));
    await expect(page.locator("#top .ds-toolbar")).toHaveCount(0);
    await page.evaluate(() => window.uiStudioTest.readonly(true));
    expect(
      await page.evaluate(() =>
        window.uiStudioTest.customCommand().then(
          () => "allowed",
          () => "blocked",
        ),
      ),
    ).toBe("blocked");
    await page.evaluate(() => window.uiStudioTest.readonly(false));
    await page.evaluate(() => window.uiStudioTest.customCommand());
    await page.evaluate(() => window.uiStudioTest.toolbar("throw"));
    await expect(page.locator("#top .ds-toolbar")).toBeVisible();
    await expect(page.getByRole("alert")).toContainText("기본 도구로 전환");
    expect(
      await page.evaluate(() => window.uiStudioTest.state().sessionId),
    ).toBe(before);
    expect(
      (await page.evaluate(() => window.uiStudioTest.read())).text,
    ).toContain("CUSTOM");
  });
  test(`${format}: invalid targets and storage failures leave chrome and dirty contents intact`, async ({
    page,
  }) => {
    await open(page, format);
    await page.evaluate(() => window.uiStudioTest.execute("저장 실패 보존"));
    expect(
      await page.evaluate(() =>
        window.uiStudioTest.invalidTarget().then(
          () => "accepted",
          () => "rejected",
        ),
      ),
    ).toBe("rejected");
    await expect(page.locator("#top .ds-toolbar")).toBeVisible();
    await page.evaluate(() => {
      window.uiStudioTest.failSave = true;
    });
    expect(
      await page.evaluate(() =>
        window.uiStudioTest.save().then(
          () => "saved",
          () => "failed",
        ),
      ),
    ).toBe("failed");
    await expect(page.getByRole("alert")).toContainText(
      "UI test storage failure",
    );
    expect(await page.evaluate(() => window.uiStudioTest.state().dirty)).toBe(
      true,
    );
  });
  test(`${format}: external controls lock during draft flush and recover after failure`, async ({
    page,
  }) => {
    await open(page, format);
    await page.evaluate(() => window.uiStudioTest.execute("종료 보호"));
    await page.evaluate(() => {
      window.uiStudioTest.holdDraft = true;
      window.uiStudioTest.failDraft = true;
      window.uiStudioTest.beginClose();
    });
    await expect
      .poll(() => page.evaluate(() => window.uiStudioTest.draftStarted))
      .toBe(true);
    expect(
      await page
        .locator("#top .ds-ui-region")
        .evaluate((node) => (node as HTMLElement).inert),
    ).toBe(true);
    expect(
      await page
        .locator("#bottom .ds-ui-region")
        .evaluate((node) => (node as HTMLElement).inert),
    ).toBe(true);
    await page.evaluate(() => {
      window.uiStudioTest.holdDraft = false;
      window.uiStudioTest.releaseDraft?.();
    });
    await expect
      .poll(() => page.evaluate(() => window.uiStudioTest.closeResult))
      .toBe("failed");
    expect(
      await page
        .locator("#top .ds-ui-region")
        .evaluate((node) => (node as HTMLElement).inert),
    ).toBe(false);
    expect(
      (await page.evaluate(() => window.uiStudioTest.read())).text,
    ).toContain("종료 보호");
    await page.evaluate(() => {
      window.uiStudioTest.failDraft = false;
    });
    await page.evaluate(() => window.uiStudioTest.close());
    await expect(page.locator(".ds-ui-region")).toHaveCount(0);
  });
  for (const width of [480, 1366])
    test(`${format}: external layout remains usable at ${width}px`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 768 });
      await open(page, format, "react");
      await page
        .getByRole("button", { name: "앱 자동화", exact: true })
        .click();
      await page
        .getByLabel("자동화 기능", { exact: true })
        .selectOption("참석자 명단");
      const input = page.getByLabel("참석자 정보", { exact: true });
      await input.fill("홍길동,기획팀,팀장");
      await input.scrollIntoViewIfNeeded();
      await expect(input).toBeVisible();
      const geometry = await page.evaluate(() => {
        const input =
          document.querySelector<HTMLTextAreaElement>("#side textarea")!;
        const rect = input.getBoundingClientRect();
        const panel = input
          .closest(".ds-tools-content")!
          .getBoundingClientRect();
        const hit = document.elementFromPoint(
          rect.x + 10,
          Math.min(rect.bottom - 5, rect.y + 20),
        );
        return {
          overflow: document.documentElement.scrollWidth > window.innerWidth,
          height: rect.height,
          visibleHeight: Math.max(
            0,
            Math.min(rect.bottom, panel.bottom, innerHeight) -
              Math.max(rect.top, panel.top, 0),
          ),
          hit: hit === input,
        };
      });
      expect(geometry.overflow).toBe(false);
      expect(geometry.height).toBeGreaterThan(70);
      expect(geometry.visibleHeight).toBeGreaterThan(90);
      expect(geometry.hit).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`ui-${format}-${width}.png`),
      });
    });
}
