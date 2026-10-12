import { expect, test, type Page } from "@playwright/test";
import { unzipSync, strFromU8 } from "fflate";

async function begin(page: Page, format: "docx" | "hwpx", blank = false) {
  await page.goto("/harness.html");
  await page.waitForFunction(() => !!window.documentStudioTest);
  await page.evaluate(
    async ({ format, blank }) => {
      await window.documentStudioTest.load(
        format,
        blank ? `blank.${format}` : `sample.${format}`,
      );
    },
    { format, blank },
  );
  await expect
    .poll(() => page.evaluate(() => window.documentStudioTest.state()?.ready))
    .toBe(true);
}
for (const format of ["docx", "hwpx"] as const) {
  test(`${format} invalidates selected matches when search conditions change`, async ({
    page,
  }) => {
    await begin(page, format);
    await page.getByRole("button", { name: "찾기", exact: true }).click();
    const panel = page.getByRole("region", { name: "추가 편집 도구" });
    const find = panel.getByRole("button", { name: "찾기", exact: true });
    const selected = panel.getByRole("button", {
      name: "선택 결과 바꾸기",
      exact: true,
    });
    for (const condition of ["query", "case", "word"]) {
      await panel.getByLabel("찾을 내용", { exact: true }).fill("검증");
      await find.click();
      await page.locator(".ds-search-match").first().click();
      await expect(selected).toBeEnabled();
      if (condition === "query")
        await panel.getByLabel("찾을 내용", { exact: true }).fill("한국어");
      else
        await panel
          .getByLabel(condition === "case" ? "대소문자 구분" : "단어 단위", {
            exact: true,
          })
          .check();
      await expect(selected).toBeDisabled();
      await expect(page.locator(".ds-search-match")).toHaveCount(0);
    }
    expect(
      await page.evaluate(() => window.documentStudioTest.state()?.dirty),
    ).toBe(false);
  });
  test(`${format} presents supported highlight choices and keeps text color independent`, async ({
    page,
  }, info) => {
    await begin(page, format, true);
    await page.evaluate(() =>
      window.documentStudioTest.execute({ id: "selectAll" }),
    );
    await page.keyboard.insertText("강조색 팔레트 확인");
    await expect
      .poll(() => page.evaluate(() => window.documentStudioTest.state()?.dirty))
      .toBe(true);
    await page.evaluate(() =>
      window.documentStudioTest.execute({ id: "selectAll" }),
    );
    await page
      .getByRole("button", { name: "문단·표·그림", exact: true })
      .click();
    await page.getByRole("tab", { name: "글자", exact: true }).click();
    const color = page.getByLabel("강조색", { exact: true });
    if (format === "docx") {
      await expect(color).toHaveJSProperty("tagName", "SELECT");
      const values = await color
        .locator("option")
        .evaluateAll((options) =>
          options.map((option) => (option as HTMLOptionElement).value),
        );
      expect(values).toHaveLength(16);
      expect(values).not.toContain("#245f56");
      const schema = await page.evaluate(
        () =>
          window.documentStudioTest.agent
            .listCommands()
            .find((command) => command.id === "highlightColor")!.valueSchema,
      );
      expect(schema?.enum).toEqual(values);
      for (const value of values) {
        await color.selectOption(value);
        await page
          .getByRole("button", { name: "강조색 적용", exact: true })
          .click();
        await expect
          .poll(() =>
            page.evaluate(
              () => window.documentStudioTest.state()?.highlightColor,
            ),
          )
          .toBe(value);
      }
    } else {
      await expect(color).toHaveAttribute("type", "color");
      await color.evaluate((input) => {
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )!.set!;
        setter.call(input, "#245f56");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await page
        .getByRole("button", { name: "강조색 적용", exact: true })
        .click();
      await expect
        .poll(async () => {
          const bytes = await page.evaluate(() =>
            window.documentStudioTest.export(),
          );
          return strFromU8(
            unzipSync(new Uint8Array(bytes))["Contents/header.xml"]!,
          ).toLowerCase();
        })
        .toContain("245f56");
    }
    await expect(page.getByRole("alert")).toHaveCount(0);
    await page.screenshot({
      path: info.outputPath(`${format}-highlight-choices.png`),
    });
  });
  test(`${format} stops an atomic preset before commit when readOnly changes`, async ({
    page,
  }) => {
    await begin(page, format);
    const beforeFont = await page.evaluate(async () => {
      const api = window.documentStudioTest;
      await api.execute({ id: "selectAll" });
      api.commandsStarted = [];
      api.pauseNextCommand = true;
      const state = api.agent.getState();
      void api.agent
        .applyPreset({
          documentId: state.documentId,
          expectedSessionId: state.sessionId,
          expectedRevision: state.revision,
          expectedSelectionKey: state.selectionKey!,
          preset: {
            id: "title",
            name: "title",
            description: "",
            commands: [
              { id: "fontSize", value: 16 },
              { id: "alignCenter" },
              { id: "paragraphFormat", value: { afterPt: 12 } },
            ],
          },
        })
        .catch((cause: unknown) => {
          const failure = cause as {
            completedCommands?: number;
            totalCommands?: number;
          };
          api.presetFailure = {
            message: String(cause),
            completedCommands: failure.completedCommands,
            totalCommands: failure.totalCommands,
          };
        });
      return state.fontSize;
    });
    await expect
      .poll(() =>
        page.evaluate(() => window.documentStudioTest.commandsStarted),
      )
      .toEqual(["preset"]);
    await page.evaluate(() => {
      window.documentStudioTest.readOnly = true;
      window.documentStudioTest.rerender();
    });
    await expect
      .poll(() =>
        page.evaluate(
          () => window.documentStudioTest.state()?.commands.fontSize?.enabled,
        ),
      )
      .toBe(false);
    await page.evaluate(() =>
      window.documentStudioTest.releasePausedCommand!(),
    );
    await expect
      .poll(() =>
        page.evaluate(
          () => window.documentStudioTest.presetFailure?.completedCommands,
        ),
      )
      .toBe(0);
    expect(
      await page.evaluate(() => window.documentStudioTest.commandsStarted),
    ).toEqual(["preset"]);
    expect(
      await page.evaluate(
        () => window.documentStudioTest.presetFailure?.totalCommands,
      ),
    ).toBe(3);
    expect(
      await page.evaluate(() => window.documentStudioTest.state()?.fontSize),
    ).toBe(beforeFont);
    expect(await page.evaluate(() => window.documentStudioTest.saves)).toBe(0);
  });
}
