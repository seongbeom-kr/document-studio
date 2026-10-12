import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { unzipSync, strFromU8 } from "fflate";
async function load(page: Page, format: "docx" | "hwpx") {
  await page.goto("/harness.html");
  await page.waitForFunction(() => Boolean(window.documentStudioTest));
  await page.evaluate(
    (format) => window.documentStudioTest.load(format, `blank.${format}`),
    format,
  );
  await expect
    .poll(() => page.evaluate(() => window.documentStudioTest.state()?.ready))
    .toBe(true);
}
async function evidence(testInfo: TestInfo, value: unknown) {
  await testInfo.attach("review-evidence", {
    body: JSON.stringify(value, null, 2),
    contentType: "application/json",
  });
}
test("DOCX highlight snapshot uses the same RGB value accepted by commands", async ({
  page,
}, testInfo) => {
  await load(page, "docx");
  const state = await page.evaluate(async () => {
    const api = window.documentStudioTest;
    await api.execute({ id: "insertText", value: "강조색 검증" });
    await api.execute({ id: "selectAll" });
    await api.execute({ id: "highlightColor", value: "#ffff00" });
    return api.state();
  });
  await evidence(testInfo, state);
  expect(state?.highlightColor?.toLowerCase()).toBe("#ffff00");
});
for (const format of ["docx", "hwpx"] as const) {
  test(`${format} readDocument preserves line breaks in replaced text`, async ({
    page,
  }, testInfo) => {
    await load(page, format);
    const result = await page.evaluate(async () => {
      const api = window.documentStudioTest;
      await api.execute({ id: "insertText", value: "바꾸기대상" });
      const id = api.state()!.documentId;
      const search = await api.agent.search({
        documentId: id,
        query: "바꾸기대상",
      });
      const receipt = await api.agent.replace({
        documentId: id,
        expectedSessionId: window.documentStudioTest.state()!.sessionId,
        expectedRevision: search.revision,
        matchId: search.matches[0]!.id,
        replacement: "첫 문단\n둘째 문단",
      });
      return {
        receipt,
        content: await api.agent.readDocument({ documentId: id }),
        bytes: await api.export(),
      };
    });
    const zip = unzipSync(new Uint8Array(result.bytes));
    const xml = strFromU8(
      zip[format === "docx" ? "word/document.xml" : "Contents/section0.xml"]!,
    );
    await evidence(testInfo, {
      receipt: result.receipt,
      content: result.content,
      xml,
    });
    expect(result.content.text).toBe("첫 문단\n둘째 문단");
  });
}
test("DOCX generated landscape page preserves requested width and height", async ({
  page,
}, testInfo) => {
  await page.goto("/harness.html");
  await page.waitForFunction(() => Boolean(window.documentStudioTest));
  await page.evaluate(() =>
    window.documentStudioTest.createTemplate("docx", {
      fileName: "landscape.docx",
      blocks: [{ kind: "paragraph", text: "가로 문서" }],
      page: {
        widthMm: 297,
        heightMm: 210,
        topMm: 20,
        bottomMm: 20,
        leftMm: 20,
        rightMm: 20,
        orientation: "landscape",
      },
    }),
  );
  await expect
    .poll(() => page.evaluate(() => window.documentStudioTest.state()?.ready))
    .toBe(true);
  const state = await page.evaluate(() => window.documentStudioTest.state());
  const exported = unzipSync(
    new Uint8Array(
      await page.evaluate(() => window.documentStudioTest.export()),
    ),
  );
  await evidence(testInfo, {
    state,
    xml: strFromU8(exported["word/document.xml"]!),
  });
  expect(state?.page?.widthMm).toBeCloseTo(297, 0);
  expect(state?.page?.heightMm).toBeCloseTo(210, 0);
});

test("DOCX pageSetup preserves requested landscape dimensions", async ({
  page,
}, testInfo) => {
  await load(page, "docx");
  const state = await page.evaluate(async () => {
    await window.documentStudioTest.execute({
      id: "pageSetup",
      value: {
        widthMm: 297,
        heightMm: 210,
        topMm: 20,
        bottomMm: 20,
        leftMm: 20,
        rightMm: 20,
        orientation: "landscape",
      },
    });
    return window.documentStudioTest.state();
  });
  const exported = unzipSync(
    new Uint8Array(
      await page.evaluate(() => window.documentStudioTest.export()),
    ),
  );
  await evidence(testInfo, {
    state,
    xml: strFromU8(exported["word/document.xml"]!),
  });
  expect(state?.page?.widthMm).toBeCloseTo(297, 0);
  expect(state?.page?.heightMm).toBeCloseTo(210, 0);
});
for (const format of ["docx", "hwpx"] as const) {
  test(`${format} invalid host source prevents saving the prior document through the new storage`, async ({
    page,
  }, testInfo) => {
    await page.goto(`/review-host.html?format=${format}`);
    await expect(
      page.getByRole("button", { name: "굵게", exact: true }),
    ).toBeEnabled();
    const input =
      format === "docx"
        ? page.getByRole("textbox", { name: "Document content", exact: true })
        : page
            .frameLocator("iframe")
            .getByRole("textbox", { name: "문서 편집 입력", exact: true });
    await input.focus();
    await page.keyboard.insertText("첫 파일에만 속하는 수정사항");
    await expect(
      page.getByRole("status").filter({ hasText: "저장하지 않은 변경사항" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Supply corrupt second source" })
      .click();
    await expect(page.getByRole("alert")).toContainText("문서 ZIP");
    const saveEnabled = await page
      .getByRole("button", { name: "저장", exact: true })
      .isEnabled();
    if (saveEnabled) {
      await page.getByRole("button", { name: "저장", exact: true }).click();
      await expect(
        page.getByRole("status").filter({ hasText: "문서를 저장했습니다." }),
      ).toBeVisible();
    }
    const result = {
      saveEnabled,
      savedTarget: await page.getByLabel("host saved target").textContent(),
      savedDocument: await page.getByLabel("host saved document").textContent(),
    };
    await evidence(testInfo, result);
    expect(result.savedTarget).toBe("");
  });
}
