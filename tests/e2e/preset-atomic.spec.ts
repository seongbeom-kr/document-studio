import { test, expect } from "@playwright/test";
import { unzipSync, strFromU8 } from "fflate";
for (const format of ["docx", "hwpx"] as const) {
  test(`${format} restores every report preset in one Undo and one Redo`, async ({
    page,
  }) => {
    await page.goto("/harness.html");
    await page.waitForFunction(() => !!window.documentStudioTest);
    await page.evaluate(
      (format) => window.documentStudioTest.load(format),
      format,
    );
    await expect
      .poll(() => page.evaluate(() => window.documentStudioTest.state()?.ready))
      .toBe(true);
    const parts = async () => {
      const zip = unzipSync(
        new Uint8Array(
          await page.evaluate(() => window.documentStudioTest.export()),
        ),
      );
      return Object.fromEntries(
        (format === "docx"
          ? ["word/document.xml", "word/header1.xml", "word/footer1.xml"]
          : ["Contents/section0.xml", "Contents/header.xml"]
        )
          .filter((name) => zip[name])
          .map((name) => [name, strFromU8(zip[name]!)]),
      );
    };
    for (const name of [
      "보고서 제목",
      "보고서 본문",
      "주석과 설명",
      "표 본문",
    ]) {
      await page.evaluate(() =>
        window.documentStudioTest.execute({ id: "selectAll" }),
      );
      const before = await parts();
      await page
        .getByRole("button", { name: "문단·표·그림", exact: true })
        .click();
      await page.getByRole("tab", { name: "보고서 서식", exact: true }).click();
      await page.getByRole("button", { name: new RegExp(`^${name} `) }).click();
      await expect(
        page.getByRole("status").filter({ hasText: `${name} 적용` }),
      ).toBeVisible();
      const applied = await parts();
      expect(applied).not.toEqual(before);
      await page.evaluate(() =>
        window.documentStudioTest.execute({ id: "undo" }),
      );
      expect(await parts()).toEqual(before);
      await page.evaluate(() =>
        window.documentStudioTest.execute({ id: "redo" }),
      );
      expect(await parts()).toEqual(applied);
      await page.evaluate(() =>
        window.documentStudioTest.execute({ id: "undo" }),
      );
      await page.getByRole("button", { name: "편집 도구 닫기" }).click();
    }
  });
}
test("DOCX native transaction refuses a late invalid operation without changing bytes or Undo history", async ({
  page,
}) => {
  await page.goto("/native-probe.html");
  await page.waitForFunction(() => window.nativePresetProbe?.ready());
  await page.evaluate(() =>
    window.nativePresetProbe.execute({ id: "selectAll" }),
  );
  const initial = unzipSync(
    new Uint8Array(await page.evaluate(() => window.nativePresetProbe.save())),
  );
  await page.evaluate(() => window.nativePresetProbe.apply([{ id: "bold" }]));
  const before = await page.evaluate(() => window.nativePresetProbe.save());
  const failure = await page.evaluate(() => {
    try {
      window.nativePresetProbe.apply(
        [{ id: "fontSize", value: 16 }, { id: "alignCenter" }],
        true,
      );
      return "accepted";
    } catch (error) {
      return String(error);
    }
  });
  expect(failure).not.toBe("accepted");
  const after = await page.evaluate(() => window.nativePresetProbe.save());
  const original = unzipSync(new Uint8Array(before)),
    restored = unzipSync(new Uint8Array(after));
  expect(strFromU8(restored["word/document.xml"]!)).toBe(
    strFromU8(original["word/document.xml"]!),
  );
  await page.evaluate(() => window.nativePresetProbe.execute({ id: "undo" }));
  const undone = unzipSync(
    new Uint8Array(await page.evaluate(() => window.nativePresetProbe.save())),
  );
  expect(strFromU8(undone["word/document.xml"]!)).toBe(
    strFromU8(initial["word/document.xml"]!),
  );
  await page.evaluate(() => window.nativePresetProbe.execute({ id: "redo" }));
  const redone = unzipSync(
    new Uint8Array(await page.evaluate(() => window.nativePresetProbe.save())),
  );
  expect(strFromU8(redone["word/document.xml"]!)).toBe(
    strFromU8(original["word/document.xml"]!),
  );
});
test("HWPX native formatting failure rolls back earlier writes and leaves no failed Redo", async ({
  page,
}) => {
  await page.goto("/harness.html");
  await page.waitForFunction(() => !!window.documentStudioTest);
  await page.evaluate(() => window.documentStudioTest.load("hwpx"));
  await expect
    .poll(() => page.evaluate(() => window.documentStudioTest.state()?.ready))
    .toBe(true);
  await page.evaluate(() =>
    window.documentStudioTest.execute({ id: "selectAll" }),
  );
  const before = unzipSync(
    new Uint8Array(
      await page.evaluate(() => window.documentStudioTest.export()),
    ),
  );
  const frame = page
    .frames()
    .find((frame) => frame.url().includes("/editor-assets/rhwp/"))!;
  await frame.evaluate(() => {
    const studio = (
      window as unknown as {
        rhwpStudio: { automation: { registerCommand(command: unknown): void } };
      }
    ).rhwpStudio;
    studio.automation.registerCommand({
      id: "ext:document-studio:font-size",
      label: "failure injection",
      canExecute: () => true,
      execute: (services: {
        eventBus: { emit(name: string, value: unknown): void };
      }) => {
        services.eventBus.emit("format-char", { fontSize: 1600 });
        throw new Error("injected failure after native formatting write");
      },
    });
  });
  const result = await page.evaluate(async () => {
    const api = window.documentStudioTest,
      state = api.agent.getState();
    try {
      await api.agent.applyPreset({
        documentId: state.documentId,
        expectedSessionId: state.sessionId,
        expectedRevision: state.revision,
        expectedSelectionKey: state.selectionKey!,
        preset: {
          id: "failed",
          name: "failed",
          description: "",
          commands: [{ id: "alignCenter" }, { id: "fontSize", value: 16 }],
        },
      });
      return "accepted";
    } catch (error) {
      return String(error);
    }
  });
  expect(result).toContain("injected failure");
  const after = unzipSync(
    new Uint8Array(
      await page.evaluate(() => window.documentStudioTest.export()),
    ),
  );
  for (const key of ["Contents/section0.xml", "Contents/header.xml"])
    expect(strFromU8(after[key]!)).toBe(strFromU8(before[key]!));
  expect(
    await page.evaluate(
      () => window.documentStudioTest.state()?.commands.redo?.enabled,
    ),
  ).toBe(false);
});
for (const format of ["docx", "hwpx"] as const)
  test(`${format} preset restores collapsed-caret typing format as well as document bytes`, async ({
    page,
  }) => {
    await page.goto("/harness.html");
    await page.waitForFunction(() => window.documentStudioTest);
    await page.evaluate(
      (format) => window.documentStudioTest.load(format, `blank.${format}`),
      format,
    );
    await expect
      .poll(() => page.evaluate(() => window.documentStudioTest.state()?.ready))
      .toBe(true);
    const before = await page.evaluate(
      () => window.documentStudioTest.state()?.fontSize,
    );
    await page.evaluate(async () => {
      const a = window.documentStudioTest.agent,
        s = a.getState();
      await a.applyPreset({
        documentId: s.documentId,
        expectedSessionId: s.sessionId,
        expectedRevision: s.revision,
        expectedSelectionKey: a.getState().selectionKey!,
        preset: {
          id: "caret",
          name: "caret",
          description: "",
          commands: [{ id: "fontSize", value: 16 }, { id: "alignCenter" }],
        },
      });
    });
    await expect
      .poll(() =>
        page.evaluate(() => window.documentStudioTest.state()?.fontSize),
      )
      .toBe(16);
    await page.evaluate(() =>
      window.documentStudioTest.execute({ id: "undo" }),
    );
    await expect
      .poll(() =>
        page.evaluate(() => window.documentStudioTest.state()?.fontSize),
      )
      .toBe(before);
    await page.evaluate(() =>
      window.documentStudioTest.execute({ id: "redo" }),
    );
    await expect
      .poll(() =>
        page.evaluate(() => window.documentStudioTest.state()?.fontSize),
      )
      .toBe(16);
  });
test("DOCX custom preset restores list formatting in one Undo and retains valid resources for Redo", async ({
  page,
}) => {
  await page.goto("/harness.html");
  await page.waitForFunction(() => window.documentStudioTest);
  await page.evaluate(() => window.documentStudioTest.load("docx"));
  await expect
    .poll(() => page.evaluate(() => window.documentStudioTest.state()?.ready))
    .toBe(true);
  await page.evaluate(() =>
    window.documentStudioTest.execute({ id: "selectAll" }),
  );
  const parts = async () => {
    const zip = unzipSync(
      new Uint8Array(
        await page.evaluate(() => window.documentStudioTest.export()),
      ),
    );
    return Object.fromEntries(
      ["word/document.xml", "word/numbering.xml"].map((key) => [
        key,
        zip[key] ? strFromU8(zip[key]!) : null,
      ]),
    );
  };
  const before = await parts();
  await page.evaluate(async () => {
    const a = window.documentStudioTest.agent,
      s = a.getState();
    await a.applyPreset({
      documentId: s.documentId,
      expectedSessionId: s.sessionId,
      expectedRevision: s.revision,
      expectedSelectionKey: a.getState().selectionKey!,
      preset: {
        id: "list",
        name: "list",
        description: "",
        commands: [
          { id: "clearFormatting" },
          { id: "bulletList" },
          { id: "increaseIndent" },
          { id: "fontSize", value: 13 },
          { id: "bold" },
          { id: "bold" },
          { id: "paragraphFormat", value: { afterPt: 9, firstLineMm: -3 } },
          { id: "alignRight" },
        ],
      },
    });
  });
  const applied = await parts();
  expect(applied).not.toEqual(before);
  expect(applied["word/document.xml"]).toContain('w:ilvl w:val="1"');
  expect(applied["word/document.xml"]).toContain('w:val="26"');
  expect(applied["word/document.xml"]).toContain('w:b w:val="0"');
  await page.evaluate(() => window.documentStudioTest.execute({ id: "undo" }));
  const undone = await parts();
  expect(undone["word/document.xml"]).toEqual(before["word/document.xml"]);
  // The native engine retains unused list definitions. They must not change authored content.
  expect(undone["word/numbering.xml"]).toContain("<w:abstractNum");
  await page.evaluate(() => window.documentStudioTest.execute({ id: "redo" }));
  expect(await parts()).toEqual(applied);
});
