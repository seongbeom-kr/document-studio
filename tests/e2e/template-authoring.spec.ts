import { expect, test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
test.describe.configure({ mode: "serial" });

async function load(page: Page, format: "docx" | "hwpx") {
  await page.goto("/template-authoring.html");
  await page.waitForFunction(() => Boolean(window.templateAuthoring));
  await page.evaluate(
    (format) => window.templateAuthoring.load(format),
    format,
  );
  await expect
    .poll(() => page.evaluate(() => window.templateAuthoring.state?.ready))
    .toBe(true);
  if (format === "docx")
    await expect(page.locator(".ds-docx-surface")).toHaveJSProperty(
      "inert",
      false,
    );
  if (format === "hwpx")
    await expect
      .poll(async () => {
        const frame = page
          .frames()
          .find((f) => f.url().includes("/editor-assets/rhwp/"));
        return frame?.evaluate(
          () =>
            !document.documentElement.inert &&
            Boolean(document.querySelector(".document-page-canvas")),
        );
      })
      .toBe(true);
}
async function point(
  page: Page,
  format: "docx" | "hwpx",
  paragraph: number,
  offset: number,
  empty = false,
) {
  if (format === "docx")
    return page
      .locator(".layout-paragraph")
      .nth(paragraph)
      .evaluate(
        (node, { offset, empty }) => {
          if (empty) {
            const r = node.getBoundingClientRect();
            return { x: r.x + 10, y: r.y + r.height / 2 };
          }
          const runs = Array.from(
            node.querySelectorAll<HTMLElement>("[data-start]"),
          );
          const run = runs.find(
            (r) =>
              Number(r.dataset.start) <= offset &&
              Number(r.dataset.end) >= offset,
          )!;
          const range = document.createRange();
          range.setStart(run.firstChild!, offset - Number(run.dataset.start));
          range.setEnd(run.firstChild!, offset - Number(run.dataset.start));
          const r = range.getBoundingClientRect();
          return { x: r.x, y: r.y + r.height / 2 };
        },
        { offset, empty },
      );
  const frame = page
    .frames()
    .find((f) => f.url().includes("/editor-assets/rhwp/"))!;
  const local = await frame.evaluate(
    ({ paragraph, offset, empty }) => {
      const runtime = (window as any).rhwpStudio.automation;
      let point: { x: number; y: number } | undefined;
      const id = "ext:test:source-point-" + crypto.randomUUID();
      runtime.registerCommand({
        id,
        label: "test",
        canExecute: () => true,
        execute(services: any) {
          const native = empty
            ? services.wasm.getCursorRectInCell(0, 3, 0, 3, 0, 0)
            : services.wasm.getCursorRect(0, paragraph, offset);
          const rect = services
            .getInputHandler()
            .getDocumentStudioPaintRects([native])[0];
          const content = document
            .querySelector("#scroll-content")!
            .getBoundingClientRect();
          point = {
            x: content.x + rect.left + (empty ? 2 : 0),
            y: content.y + rect.top + rect.height / 2,
          };
        },
      });
      runtime.execute(id);
      return point!;
    },
    { paragraph, offset, empty },
  );
  const bounds = await page.locator("iframe").boundingBox();
  return { x: bounds!.x + local.x, y: bounds!.y + local.y };
}
for (const format of ["docx", "hwpx"] as const)
  test(`${format} exact graphical selection stays read-only through duplicate, split-run range, empty cell, zoom and reopen`, async ({
    page,
  }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await load(page, format);
    expect(await page.evaluate(() => window.templateAuthoring.log)).toEqual([]);
    if (format === "docx")
      await page
        .locator(".layout-paragraph")
        .nth(2)
        .click({ position: { x: 10, y: 8 } });
    else {
      const duplicate = await point(page, format, 2, 3);
      await page.mouse.click(duplicate.x, duplicate.y);
    }
    await expect
      .poll(() =>
        page.evaluate(() => window.templateAuthoring.log.at(-1)?.targetId),
      )
      .toBe(
        await page.evaluate(
          () => window.templateAuthoring.structure!.targets[2]!.id,
        ),
      );
    await expect(
      format === "docx"
        ? page.locator(".ds-template-anchor")
        : page.frameLocator("iframe").locator(".document-studio-template-box"),
    ).toHaveCount(1);
    const initialMark = () =>
      format === "docx"
        ? page.locator(".ds-template-anchor")
        : page.frameLocator("iframe").locator(".document-studio-template-box");
    const previousTop = (await initialMark().first().boundingBox())!.y;
    await page.evaluate(() =>
      window.templateAuthoring.select({
        ...window.templateAuthoring.log.at(-1)!,
        targetId: window.templateAuthoring.structure!.targets[0]!.id,
      }),
    );
    await expect
      .poll(async () => (await initialMark().first().boundingBox())?.y)
      .not.toBe(previousTop);
    if (format === "docx")
      await page
        .locator(".layout-paragraph")
        .nth(2)
        .click({ position: { x: 10, y: 8 } });
    else {
      const duplicate = await point(page, format, 2, 3);
      await page.mouse.click(duplicate.x, duplicate.y);
    }
    await expect
      .poll(() => page.evaluate(() => window.templateAuthoring.log.length))
      .toBe(2);
    await expect
      .poll(async () => (await initialMark().first().boundingBox())?.y)
      .toBe(previousTop);
    const start = await point(page, format, 2, format === "docx" ? 3 : 2),
      end = await point(page, format, 2, format === "docx" ? 7 : 6);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 12 });
    await page.mouse.up();
    await expect
      .poll(() =>
        page.evaluate(() => ({
          start: window.templateAuthoring.log.at(-1)?.start,
          end: window.templateAuthoring.log.at(-1)?.end,
        })),
      )
      .toEqual({ start: 3, end: 7 });
    await expect(
      (format === "docx"
        ? page.locator(".ds-template-range")
        : page.frameLocator("iframe").locator(".document-studio-template-box")
      ).first(),
    ).toBeVisible();
    const evidence = new URL(
      "../../.build/template-authoring-proof/",
      import.meta.url,
    );
    await mkdir(evidence, { recursive: true });
    await page.screenshot({
      path: fileURLToPath(
        new URL(`${format}-${testInfo.project.name}-range.png`, evidence),
      ),
    });
    const empty = await point(page, format, 6, 0, true);
    await page.mouse.click(empty.x, empty.y);
    await expect
      .poll(() =>
        page.evaluate(() => window.templateAuthoring.log.at(-1)?.targetId),
      )
      .toBe(
        await page.evaluate(
          () =>
            window.templateAuthoring
              .structure!.targets.filter((t) => t.rowId)
              .at(-1)!.id,
        ),
      );
    const mark = () =>
      format === "docx"
        ? page.locator(".ds-template-anchor")
        : page.frameLocator("iframe").locator(".document-studio-template-box");
    await expect(mark()).toHaveCount(1);
    const count = await page.evaluate(
      () => window.templateAuthoring.log.length,
    );
    await page
      .getByRole("combobox", { name: "확대", exact: true })
      .selectOption("150");
    await expect
      .poll(() => page.evaluate(() => window.templateAuthoring.state?.zoom))
      .toBe(1.5);
    await expect(mark()).toHaveCount(1);
    await page.evaluate(() => window.templateAuthoring.reopen());
    await expect(mark()).toHaveCount(1);
    expect(await page.evaluate(() => window.templateAuthoring.log.length)).toBe(
      count,
    );
    expect(
      await page.evaluate(() => window.templateAuthoring.state?.dirty),
    ).toBe(false);
    expect(await page.evaluate(() => window.templateAuthoring.errors)).toEqual(
      [],
    );
    expect(errors).toEqual([]);
    await page.screenshot({
      path: fileURLToPath(
        new URL(
          `${format}-${testInfo.project.name}-reopened-empty.png`,
          evidence,
        ),
      ),
    });
    await writeFile(
      new URL(`${format}-${testInfo.project.name}.json`, evidence),
      JSON.stringify(
        {
          format,
          browser: testInfo.project.name,
          completedAt: new Date().toISOString(),
          ...(await page.evaluate(() => ({
            selections: window.templateAuthoring.log,
            errors: window.templateAuthoring.errors,
            dirty: window.templateAuthoring.state?.dirty,
          }))),
        },
        null,
        2,
      ),
    );
  });
test("docx rejects a hit outside source paragraphs instead of reusing the previous cursor", async ({
  page,
}) => {
  await load(page, "docx");
  await page
    .locator(".layout-paragraph")
    .nth(2)
    .click({ position: { x: 10, y: 8 } });
  await expect
    .poll(() => page.evaluate(() => window.templateAuthoring.log.length))
    .toBe(1);
  await expect(page.locator(".ds-template-anchor")).toHaveCount(1);
  await page.locator(".ds-docx-surface").click({ position: { x: 2, y: 2 } });
  await expect
    .poll(() => page.evaluate(() => window.templateAuthoring.errors.at(-1)))
    .toBe("TEMPLATE_SELECTION_UNSUPPORTED");
  expect(await page.evaluate(() => window.templateAuthoring.log.length)).toBe(
    1,
  );
  await expect(
    page.getByText("TEMPLATE_SELECTION_UNSUPPORTED", { exact: true }),
  ).toHaveCount(0);
});
test("hwpx ignores ruler gestures after a different target is highlighted", async ({
  page,
}) => {
  await load(page, "hwpx");
  const a = await point(page, "hwpx", 2, 3);
  await page.mouse.click(a.x, a.y);
  await expect
    .poll(() => page.evaluate(() => window.templateAuthoring.log.length))
    .toBe(1);
  const mark = page
    .frameLocator("iframe")
    .locator(".document-studio-template-box");
  await expect(mark).toHaveCount(1);
  const top = (await mark.boundingBox())!.y;
  await page.evaluate(() =>
    window.templateAuthoring.select({
      ...window.templateAuthoring.log.at(-1)!,
      targetId: window.templateAuthoring.structure!.targets[0]!.id,
    }),
  );
  await expect.poll(async () => (await mark.boundingBox())?.y).not.toBe(top);
  await page
    .frameLocator("iframe")
    .locator("#h-ruler")
    .click({ position: { x: 200, y: 10 } });
  // Native gestures cross the iframe channel; give an unwanted notification time to arrive.
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.templateAuthoring.log.length)).toBe(
    1,
  );
});
test("hwpx can enter cell text after selecting a table object in read-only mode", async ({
  page,
}) => {
  await load(page, "hwpx");
  const frame = page
    .frames()
    .find((f) => f.url().includes("/editor-assets/rhwp/"))!;
  const location = async (border: boolean, cell = 1, offset = 2) => {
    const result = await frame.evaluate(
      ({ border, cell, offset }) => {
        const runtime = (window as any).rhwpStudio.automation;
        let point: { x: number; y: number } | undefined;
        const id = "ext:test:table-entry-" + crypto.randomUUID();
        runtime.registerCommand({
          id,
          label: "test",
          canExecute: () => true,
          execute(services: any) {
            const rect = services.wasm.getCursorRectInCell(
              0,
              3,
              0,
              cell,
              0,
              offset,
            );
            if (border) {
              const box = services.wasm.getTableBBox(0, 3, 0);
              rect.x = box.x + box.width / 4;
              rect.y = box.y;
              rect.height = 0;
            }
            const paint = services
                .getInputHandler()
                .getDocumentStudioPaintRects([rect])[0],
              content = document
                .querySelector("#scroll-content")!
                .getBoundingClientRect();
            point = {
              x: content.x + paint.left,
              y: content.y + paint.top + (border ? 0 : paint.height / 2),
            };
          },
        });
        runtime.execute(id);
        return point!;
      },
      { border, cell, offset },
    );
    const box = await page.locator("iframe").boundingBox();
    return { x: box!.x + result.x, y: box!.y + result.y };
  };
  const border = await location(true);
  await page.mouse.click(border.x, border.y);
  await expect
    .poll(() => page.evaluate(() => window.templateAuthoring.errors.at(-1)))
    .toBe("TEMPLATE_SELECTION_UNSUPPORTED");
  expect(await page.evaluate(() => window.templateAuthoring.log)).toEqual([]);
  const text = await location(false);
  await page.mouse.click(text.x, text.y);
  await expect
    .poll(() =>
      page.evaluate(() => window.templateAuthoring.log.at(-1)?.targetId),
    )
    .toBe(
      await page.evaluate(
        () =>
          window.templateAuthoring.structure!.targets.filter((t) => t.rowId)[1]!
            .id,
      ),
    );
  await expect(
    page.frameLocator("iframe").locator(".document-studio-template-box"),
  ).toHaveCount(1);
  const start = await location(false, 1, 0),
    end = await location(false, 1, 2);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(() =>
      page.evaluate(() => ({
        start: window.templateAuthoring.log.at(-1)?.start,
        end: window.templateAuthoring.log.at(-1)?.end,
      })),
    )
    .toEqual({ start: 0, end: 2 });
  expect(await page.evaluate(() => window.templateAuthoring.state?.dirty)).toBe(
    false,
  );
});
