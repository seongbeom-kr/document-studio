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
    const inputTop = Math.max(input.top, box.top);
    let inputBottom = Math.min(input.bottom, box.bottom, window.innerHeight);
    const actions = bounds(".ds-automation-actions");
    if (
      actions.left < input.right &&
      actions.right > input.left &&
      actions.top < inputBottom &&
      actions.bottom > inputTop
    )
      inputBottom = Math.min(inputBottom, actions.top);
    const inputHits = [4, 40, 79].map(
      (offset) =>
        document
          .elementFromPoint(input.left + input.width / 2, inputTop + offset)
          ?.hasAttribute("data-automation-input") ?? false,
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
      inputUnobscuredHeight: Math.max(0, inputBottom - inputTop),
      inputUnobscured: inputHits.every(Boolean),
      horizontalOverflow: body.scrollWidth > body.clientWidth + 2,
    };
  });
}

async function expectReadableControls(page: Page) {
  const space = await readableControls(page);
  expect(space.scrollTop).toBe(0);
  // Host fonts change the chrome height. Check the usable input and actual hit
  // targets below instead of assuming a fixed amount of remaining panel space.
  expect(space.selectVisible).toBe(true);
  expect(space.previewVisible).toBe(true);
  expect(space.inputVisibleHeight).toBeGreaterThan(80);
  expect(space.inputUnobscuredHeight).toBeGreaterThan(80);
  expect(space.inputUnobscured).toBe(true);
  expect(space.horizontalOverflow).toBe(false);
  return space;
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
      await expectReadableControls(page);
      await expect(page.getByLabel("현재 적용 대상")).toBeVisible();
      await expect(page.locator(".ds-editor-body")).toHaveAttribute(
        "inert",
        "",
      );
      const input = page.getByLabel("보고서 마크다운", { exact: true });
      let source =
        "# 크기를 바꿔도 유지\n| 항목 | 결과 |\n|---|---|\n| 원본 | 유지 |";
      await input.fill(source);
      await page
        .getByRole("button", { name: "결과 미리보기", exact: true })
        .click();
      await expect(
        page.getByRole("region", {
          name: "마크다운 보고서 구조 미리보기",
          exact: true,
        }),
      ).toBeVisible();
      await expectReadableControls(page);
      // A visible rectangle is insufficient: click where the old sticky actions
      // intercepted the textarea, then correct the source and preview again.
      const inputBox = await input.boundingBox();
      await page.mouse.click(
        inputBox!.x + inputBox!.width / 2,
        inputBox!.y + 79,
      );
      await expect(input).toBeFocused();
      await input.press("Control+Home");
      await input.press("ArrowRight");
      await input.press("ArrowRight");
      await page.keyboard.insertText("수정 완료 ");
      source = source.replace("# ", "# 수정 완료 ");
      await expect(input).toHaveValue(source);
      await page
        .getByRole("button", { name: "결과 미리보기", exact: true })
        .click();
      await expectReadableControls(page);
      await expect(
        page.getByRole("region", {
          name: "마크다운 보고서 구조 미리보기",
          exact: true,
        }),
      ).toContainText("수정 완료 크기를 바꿔도 유지");
      await info.attach("preview-input-geometry", {
        body: JSON.stringify(await expectReadableControls(page)),
        contentType: "application/json",
      });
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
      await expect(input).toHaveValue(source);
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
      await expect(input).toHaveValue(source);
      await page
        .getByRole("button", { name: "결과 미리보기", exact: true })
        .click();
      await page
        .getByRole("button", {
          name: "텍스트로 삽입 · 표/서식 제외",
          exact: true,
        })
        .click();
      await expect(
        page
          .getByRole("status")
          .filter({ hasText: "줄을 선택 위치에 삽입했습니다" }),
      ).toBeVisible();
      const read = await page.evaluate(() => {
        const agent = window.documentStudioTest.agent;
        return agent.readDocument({ documentId: agent.getState().documentId });
      });
      expect(read.text).toContain("수정 완료 크기를 바꿔도 유지");
      await page.evaluate(() => window.documentStudioTest.save());
      expect(
        await page.evaluate(() => window.documentStudioTest.state()?.dirty),
      ).toBe(false);
      const saved = await page.evaluate((format) => {
        const host = window.documentStudioTest;
        return host.inspectBytes(host.savedEvent!.bytes, format);
      }, format);
      expect(saved.tables).toHaveLength(0);
      const oldSession = await page.evaluate(
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
          page.evaluate((previous) => {
            const state = window.documentStudioTest.state();
            return state?.ready && state.sessionId !== previous;
          }, oldSession),
        )
        .toBe(true);
      const created = await page.evaluate(() => {
        const agent = window.documentStudioTest.agent;
        return agent.inspect({ documentId: agent.getState().documentId });
      });
      expect(created.tables).toHaveLength(1);
      expect(created.tables[0]).toMatchObject({ rows: 2, columns: 2 });
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
