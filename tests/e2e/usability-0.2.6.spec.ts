import { test, expect, type Page } from "@playwright/test";
import { PNG } from "pngjs";
import { strFromU8, unzipSync } from "fflate";
async function load(
  page: Page,
  format: "docx" | "hwpx",
  file = `sample.${format}`,
) {
  await page.goto("/harness.html");
  await page.waitForFunction(() => window.documentStudioTest);
  await page.evaluate(
    ({ format, file }) => window.documentStudioTest.load(format, file),
    { format, file },
  );
  await expect
    .poll(() => page.evaluate(() => window.documentStudioTest.state()?.ready))
    .toBe(true);
  await page.getByRole("button", { name: "문단·표·그림", exact: true }).click();
}
for (const format of ["docx", "hwpx"] as const) {
  test(`${format} shows rounded page values and preserves untouched precision`, async ({
    page,
  }) => {
    await load(page, format);
    await page.getByRole("tab", { name: "페이지", exact: true }).click();
    const original = await page.evaluate(
      () => window.documentStudioTest.state()!.page!,
    );
    await expect(
      page.getByLabel("용지 너비 (mm)", { exact: true }),
    ).toHaveValue(String(Number(original.widthMm.toFixed(2))));
    const apply = page.getByRole("button", {
      name: "페이지 설정 적용",
      exact: true,
    });
    await expect(apply).toBeDisabled();
    await page
      .getByLabel("용지 방향", { exact: true })
      .selectOption("landscape");
    await expect(apply).toBeEnabled();
    await page
      .getByLabel("용지 방향", { exact: true })
      .selectOption("portrait");
    await expect(apply).toBeDisabled();
    await page.getByLabel("왼쪽 여백 (mm)", { exact: true }).fill("17.25");
    await apply.click();
    await expect
      .poll(() =>
        page.evaluate(() => window.documentStudioTest.state()?.page?.leftMm),
      )
      .toBeCloseTo(17.25, 1);
    const updated = await page.evaluate(
      () => window.documentStudioTest.state()!.page!,
    );
    expect(updated.widthMm).toBe(original.widthMm);
    expect(updated.heightMm).toBe(original.heightMm);
    await expect(apply).toBeDisabled();
  });
  test(`${format} image UI keeps ratio, unlocks, fits the page and exports dimensions`, async ({
    page,
  }) => {
    await load(page, format, `blank.${format}`);
    await page.getByRole("tab", { name: "그림", exact: true }).click();
    const png = new PNG({ width: 1200, height: 600 });
    png.data.fill(180);
    const bytes = PNG.sync.write(png);
    await page.getByLabel("삽입할 그림", { exact: true }).setInputFiles({
      name: "owned-wide.png",
      mimeType: "image/png",
      buffer: bytes,
    });
    const insert = page.getByRole("button", { name: "그림 삽입", exact: true }),
      width = page.getByLabel("그림 너비 (mm)", { exact: true }),
      height = page.getByLabel("그림 높이 (mm)", { exact: true });
    await expect(insert).toBeEnabled();
    await expect(
      page.getByLabel("원본 비율 유지", { exact: true }),
    ).toBeChecked();
    await width.fill("80");
    await expect(height).toHaveValue("40");
    await height.fill("30");
    await expect(width).toHaveValue("60");
    await page.getByLabel("원본 비율 유지", { exact: true }).uncheck();
    await width.fill("75");
    await expect(height).toHaveValue("30");
    await page
      .getByRole("button", { name: "문서 폭 안에 맞춤", exact: true })
      .click();
    await expect(
      page.getByLabel("원본 비율 유지", { exact: true }),
    ).toBeChecked();
    expect(
      Number(await width.inputValue()) / Number(await height.inputValue()),
    ).toBeCloseTo(2, 2);
    await width.fill("80");
    await page
      .getByLabel("그림 대체 텍스트", { exact: true })
      .fill("자체 제작 가로 그림");
    await insert.click();
    await expect
      .poll(() => page.evaluate(() => window.documentStudioTest.state()?.dirty))
      .toBe(true);
    const zip = unzipSync(
      new Uint8Array(
        await page.evaluate(() => window.documentStudioTest.export()),
      ),
    );
    const xml = strFromU8(
      zip[format === "docx" ? "word/document.xml" : "Contents/section0.xml"]!,
    );
    expect(xml).toContain(format === "docx" ? 'cx="2880000"' : 'width="22677"');
    expect(
      Object.entries(zip).some(
        ([name, data]) =>
          /^(word\/media|BinData)\//.test(name) &&
          Buffer.from(data).equals(bytes),
      ),
    ).toBe(true);
    await page.screenshot({
      path: `.build/fixes-0.2.6/${format}-image-${test.info().project.name}.png`,
    });
  });
  test(`${format} rejects corrupt and oversized images before enabling insertion`, async ({
    page,
  }) => {
    await load(page, format);
    await page.getByRole("tab", { name: "그림", exact: true }).click();
    const upload = page.getByLabel("삽입할 그림", { exact: true }),
      insert = page.getByRole("button", { name: "그림 삽입", exact: true });
    const revision = await page.evaluate(
      () => window.documentStudioTest.state()?.revision,
    );
    await upload.setInputFiles({
      name: "broken.png",
      mimeType: "image/png",
      buffer: Buffer.from([137, 80, 78, 71]),
    });
    await expect(page.getByRole("alert")).toContainText("그림");
    await expect(insert).toBeDisabled();
    const header = Buffer.alloc(24);
    header.set([137, 80, 78, 71]);
    header.set([73, 72, 68, 82], 12);
    header.writeUInt32BE(20000, 16);
    header.writeUInt32BE(20000, 20);
    await upload.setInputFiles({
      name: "huge.png",
      mimeType: "image/png",
      buffer: header,
    });
    await expect(page.getByRole("alert")).toContainText("화소");
    await expect(insert).toBeDisabled();
    expect(
      await page.evaluate(() => window.documentStudioTest.state()?.revision),
    ).toBe(revision);
  });
  test(`${format} accepts JPEG and GIF ratios and clears a pending image on document change`, async ({
    page,
  }) => {
    await load(page, format);
    await page.getByRole("tab", { name: "그림", exact: true }).click();
    const jpeg = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 96;
      canvas.height = 48;
      canvas.getContext("2d")!.fillRect(0, 0, 96, 48);
      return canvas.toDataURL("image/jpeg").split(",")[1]!;
    });
    await page.getByLabel("삽입할 그림", { exact: true }).setInputFiles({
      name: "owned.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.from(jpeg, "base64"),
    });
    const width = page.getByLabel("그림 너비 (mm)", { exact: true }),
      height = page.getByLabel("그림 높이 (mm)", { exact: true }),
      insert = page.getByRole("button", { name: "그림 삽입", exact: true });
    await expect(insert).toBeEnabled();
    await expect(width).toHaveValue("25.4");
    await expect(height).toHaveValue("12.7");
    await page.getByLabel("삽입할 그림", { exact: true }).setInputFiles({
      name: "owned.gif",
      mimeType: "image/gif",
      buffer: Buffer.from(
        "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
        "base64",
      ),
    });
    await expect(insert).toBeEnabled();
    await expect(width).toHaveValue("1");
    await expect(height).toHaveValue("1");
    await page.evaluate(
      (format) => window.documentStudioTest.load(format, `blank.${format}`),
      format,
    );
    await expect
      .poll(() => page.evaluate(() => window.documentStudioTest.state()?.ready))
      .toBe(true);
    await expect(insert).toBeDisabled();
  });
}
test("all 20 automation forms generate useful previews with function-specific fields", async ({
  page,
}) => {
  await load(page, "docx");
  await page.getByRole("tab", { name: "업무 자동화", exact: true }).click();
  const forms = await page.evaluate(() =>
    window.documentStudioTest.agent.listAutomationForms(),
  );
  expect(forms).toHaveLength(20);
  const expected: Record<string, string> = {
    "금액 한글화": "일만이천삼백사십",
    "날짜 변환": "2026.",
    "기간 계산": "~",
    "산출근거 계산": "36500",
    "비율 분석": "30%",
    역합계: "60",
    "자료 취합": "김철수",
    "직제순 정렬": "기획팀",
    "마크다운 보고서": "업무 보고서",
    "참석자 명단": "홍길동",
    회의명패: "홍길동",
    명찰: "홍길동",
    조직도: "기획팀",
    "보고서 작성 프롬프트": "업무 보고서",
    차트: "기획",
    "조직도 그림": "본부",
    "조 편성": "1조",
  };
  for (const form of forms) {
    await page
      .getByLabel("자동화 기능", { exact: true })
      .selectOption(form.name);
    await expect(page.getByLabel(form.inputLabel, { exact: true })).toHaveValue(
      form.example,
    );
    if (form.argument) {
      await expect(
        page.getByLabel(form.argument.label, { exact: true }),
      ).toBeVisible();
    }
    await page
      .getByRole("button", { name: "결과 미리보기", exact: true })
      .click();
    const output = await page
      .getByLabel("업무 자동화 결과", { exact: true })
      .inputValue();
    expect(output, form.name).not.toBe("");
    if (expected[form.name])
      expect(output, form.name).toContain(expected[form.name]!);
    if (form.name === "자료 취합") expect(output).not.toContain("이름");
    await expect(page.getByRole("alert")).toHaveCount(0);
  }
  await page.getByLabel("자동화 기능", { exact: true }).selectOption("추첨");
  await page.getByLabel("추첨 인원", { exact: true }).fill("4");
  await page
    .getByRole("button", { name: "결과 미리보기", exact: true })
    .click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(
    page.getByLabel("업무 자동화 결과", { exact: true }),
  ).toHaveValue("");
  await page
    .getByLabel("자동화 기능", { exact: true })
    .selectOption("표 데이터 정리");
  await page
    .getByLabel("정리할 표 데이터", { exact: true })
    .fill("10,20\n30,40");
  await page.getByLabel("셀 변환", { exact: true }).selectOption("multiply");
  await expect(page.getByLabel("곱할 수", { exact: true })).toHaveValue("1");
  await page.getByLabel("곱할 수", { exact: true }).fill("2");
  await page
    .getByRole("button", { name: "결과 미리보기", exact: true })
    .click();
  await expect(
    page.getByLabel("업무 자동화 결과", { exact: true }),
  ).toHaveValue("20\t40\n60\t80");
  await page.getByLabel("셀 변환", { exact: true }).selectOption("divide");
  await page.getByLabel("나눌 수", { exact: true }).fill("0");
  await page
    .getByRole("button", { name: "결과 미리보기", exact: true })
    .click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.screenshot({
    path: `.build/fixes-0.2.6/automation-${test.info().project.name}.png`,
  });
});
