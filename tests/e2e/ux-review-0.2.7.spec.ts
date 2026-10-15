import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import {
  Document,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  Packer,
} from "docx";
import { PNG } from "pngjs";
import { unzipSync, strFromU8 } from "fflate";

for (const format of ["docx", "hwpx"] as const) {
  for (const scenario of [
    "retry",
    "read-only",
    "read-only-restored",
    "document-change",
  ] as const)
    test(`${format} guards new-document ${scenario}`, async ({ page }) => {
      await page.goto("/harness.html");
      await page.waitForFunction(() => window.documentStudioTest);
      await page.evaluate(async (format) => {
        window.documentStudioTest.persistAutomation = true;
        await window.documentStudioTest.load(format);
      }, format);
      await expect
        .poll(() =>
          page.evaluate(() => window.documentStudioTest.state()?.ready),
        )
        .toBe(true);
      const original = await page.evaluate(
        () => window.documentStudioTest.state()?.documentId,
      );
      await page
        .getByRole("button", { name: "문단·표·그림", exact: true })
        .click();
      await page.getByRole("tab", { name: "업무 자동화", exact: true }).click();
      await page
        .getByLabel("자동화 기능", { exact: true })
        .selectOption("참석자 명단");
      await page
        .getByRole("button", { name: "결과 미리보기", exact: true })
        .click();
      await page.evaluate((scenario) => {
        if (scenario === "retry")
          window.documentStudioTest.failCreatedCallback = true;
        else window.documentStudioTest.pauseNextCreation = true;
      }, scenario);
      await page
        .getByRole("button", {
          name: "구조를 유지해 새 문서 만들기",
          exact: true,
        })
        .click();
      if (scenario === "retry") {
        await expect(page.getByRole("alert")).toContainText(
          "새 문서 업로드 실패",
        );
        expect(
          await page.evaluate(
            () => window.documentStudioTest.state()?.documentId,
          ),
        ).toBe(original);
        await page.evaluate(() => {
          window.documentStudioTest.failCreatedCallback = false;
        });
        await page
          .getByRole("button", {
            name: "구조를 유지해 새 문서 만들기",
            exact: true,
          })
          .click();
        await expect
          .poll(() =>
            page.evaluate(() => window.documentStudioTest.createdIds.length),
          )
          .toBe(2);
        const ids = await page.evaluate(
          () => window.documentStudioTest.createdIds,
        );
        expect(ids[0]).toBe(ids[1]);
      } else {
        await page.waitForFunction(
          () => window.documentStudioTest.releasePausedCreation,
        );
        if (scenario === "read-only" || scenario === "read-only-restored") {
          await page.evaluate(() => {
            window.documentStudioTest.readOnly = true;
            window.documentStudioTest.rerender();
          });
          await expect(
            page.getByRole("button", { name: "굵게", exact: true }),
          ).toBeDisabled();
          if (scenario === "read-only-restored") {
            await page.evaluate(() => {
              window.documentStudioTest.readOnly = false;
              window.documentStudioTest.rerender();
            });
            await expect(
              page.getByRole("button", { name: "굵게", exact: true }),
            ).toBeEnabled();
          }
        } else {
          await page.evaluate(() => window.documentStudioTest.flushDraft());
          await page.evaluate(() => {
            window.documentStudioTest.draftGetDelay = 500;
          });
          await page.evaluate(
            (format) =>
              window.documentStudioTest.load(format, `blank.${format}`),
            format,
          );
          await expect(page.locator("[data-test-host]")).toHaveAttribute(
            "data-source-id",
            `test:blank.${format}`,
          );
        }
        await expect
          .poll(() =>
            page.evaluate(() => window.documentStudioTest.state()?.ready),
          )
          .toBe(true);
        await page.evaluate(() =>
          window.documentStudioTest.releasePausedCreation!(),
        );
        await expect
          .poll(() =>
            page.evaluate(() => window.documentStudioTest.creationsCompleted),
          )
          .toBe(1);
        // Let the actual DOCX/HWPX factory complete; no host callback may escape its old scope.
        if (scenario === "document-change") {
          await expect
            .poll(() =>
              page.evaluate((format) => {
                const state = window.documentStudioTest.state();
                return (
                  state?.ready && state.documentId === `test:blank.${format}`
                );
              }, format),
            )
            .toBe(true);
          // A fresh document starts with the numeric utility, which has no
          // structural creation action. The old preview must not survive.
          await expect(
            page.getByLabel("자동화 기능", { exact: true }),
          ).toHaveValue("금액 한글화");
          await expect(
            page.getByRole("button", {
              name: "구조를 유지해 새 문서 만들기",
              exact: true,
            }),
          ).toHaveCount(0);
        } else if (scenario !== "read-only-restored")
          await expect(
            page.getByRole("button", {
              name: "구조를 유지해 새 문서 만들기",
              exact: true,
            }),
          ).toBeDisabled();
        await expect
          .poll(() => page.evaluate(() => window.documentStudioTest.createdIds))
          .toEqual([]);
      }
    });
  for (const utility of [
    "마크다운 보고서",
    "참석자 명단",
    "회의명패",
    "명찰",
    "조직도",
  ]) {
    test(`${format} creates, saves and reopens ${utility} from user data`, async ({
      page,
    }) => {
      await page.goto("/harness.html");
      await page.waitForFunction(() => window.documentStudioTest);
      await page.evaluate(async (format) => {
        window.documentStudioTest.persistAutomation = true;
        await window.documentStudioTest.load(format);
      }, format);
      await expect
        .poll(() =>
          page.evaluate(() => window.documentStudioTest.state()?.ready),
        )
        .toBe(true);
      const previousId = await page.evaluate(
        () => window.documentStudioTest.state()?.documentId,
      );
      await page
        .getByRole("button", { name: "문단·표·그림", exact: true })
        .click();
      await page.getByRole("tab", { name: "업무 자동화", exact: true }).click();
      await page
        .getByLabel("자동화 기능", { exact: true })
        .selectOption(utility);
      const form = await page.evaluate(
        (name) =>
          window.documentStudioTest.agent
            .listAutomationForms()
            .find((form) => form.name === name)!,
        utility,
      );
      const input =
        utility === "마크다운 보고서"
          ? "# 검증전용가 보고서\n직접 작성한 내용입니다."
          : form.example
              .replaceAll("홍길동", "검증전용가")
              .replaceAll("김철수", "검증전용나")
              .replaceAll("본부", "검증전용가본부");
      await page.getByLabel(form.inputLabel, { exact: true }).fill(input);
      await page
        .getByRole("button", { name: "결과 미리보기", exact: true })
        .click();
      await page
        .getByRole("button", {
          name: "구조를 유지해 새 문서 만들기",
          exact: true,
        })
        .click();
      await expect
        .poll(() =>
          page.evaluate(() => window.documentStudioTest.state()?.documentId),
        )
        .not.toBe(previousId);
      await expect
        .poll(() =>
          page.evaluate(() => window.documentStudioTest.state()?.ready),
        )
        .toBe(true);
      await page.evaluate(() => window.documentStudioTest.save());
      const exported = await page.evaluate(() =>
        window.documentStudioTest.export(),
      );
      const zip = unzipSync(new Uint8Array(exported));
      expect(
        strFromU8(
          zip[
            format === "docx" ? "word/document.xml" : "Contents/section0.xml"
          ]!,
        ),
      ).toContain("검증전용가");
      await page.reload();
      await page.waitForFunction(() => window.documentStudioTest);
      await page.evaluate(
        ({ exported, format }) =>
          window.documentStudioTest.loadBytes(exported, format),
        { exported, format },
      );
      await expect
        .poll(() =>
          page.evaluate(() => window.documentStudioTest.state()?.ready),
        )
        .toBe(true);
      const reopened = unzipSync(
        new Uint8Array(
          await page.evaluate(() => window.documentStudioTest.export()),
        ),
      );
      expect(
        strFromU8(
          reopened[
            format === "docx" ? "word/document.xml" : "Contents/section0.xml"
          ]!,
        ),
      ).toContain("검증전용가");
    });
  }
  test(`${format} retains automation input and options across utilities and closed tools`, async ({
    page,
  }) => {
    await page.goto("/harness.html");
    await page.waitForFunction(() => window.documentStudioTest);
    await page.evaluate(async (format) => {
      window.documentStudioTest.persistAutomation = true;
      await window.documentStudioTest.load(format);
    }, format);
    await expect
      .poll(() => page.evaluate(() => window.documentStudioTest.state()?.ready))
      .toBe(true);
    const tools = page.getByRole("button", {
      name: "문단·표·그림",
      exact: true,
    });
    await tools.click();
    await page.getByRole("tab", { name: "업무 자동화", exact: true }).click();
    const utility = page.getByLabel("자동화 기능", { exact: true });
    await utility.selectOption("표 데이터 정리");
    await page
      .getByLabel("정리할 표 데이터", { exact: true })
      .fill("10,20\n30,40");
    await page.getByLabel("열 구분", { exact: true }).selectOption(",");
    await page.getByLabel("셀 변환", { exact: true }).selectOption("multiply");
    await page.getByLabel("곱할 수", { exact: true }).fill("3");
    await utility.selectOption("날짜 변환");
    await utility.selectOption("표 데이터 정리");
    await expect(
      page.getByLabel("정리할 표 데이터", { exact: true }),
    ).toHaveValue("10,20\n30,40");
    await expect(page.getByLabel("곱할 수", { exact: true })).toHaveValue("3");
    await expect(page.getByLabel("열 구분", { exact: true })).toHaveValue(",");
    await page.getByRole("tab", { name: "문단", exact: true }).click();
    await page.getByRole("tab", { name: "업무 자동화", exact: true }).click();
    await expect(utility).toHaveValue("표 데이터 정리");
    await tools.click();
    await tools.click();
    await page.getByRole("tab", { name: "업무 자동화", exact: true }).click();
    await expect(page.getByLabel("곱할 수", { exact: true })).toHaveValue("3");
    await page
      .getByRole("button", { name: "결과 미리보기", exact: true })
      .click();
    await expect(
      page.getByLabel("업무 자동화 결과", { exact: true }),
    ).toHaveValue("30\t60\n90\t120");
    await page
      .getByRole("button", { name: "예제로 초기화", exact: true })
      .click();
    await expect(page.getByLabel("셀 변환", { exact: true })).toHaveValue(
      "trim",
    );
    await expect(
      page.getByLabel("업무 자동화 결과", { exact: true }),
    ).toHaveValue("");
    await page.evaluate(() => window.documentStudioTest.flushDraft());
    await page.evaluate(
      (format) => window.documentStudioTest.load(format, `blank.${format}`),
      format,
    );
    await expect
      .poll(() => page.evaluate(() => window.documentStudioTest.state()?.ready))
      .toBe(true);
    await page.getByRole("tab", { name: "업무 자동화", exact: true }).click();
    await expect(utility).toHaveValue("금액 한글화");
  });
}

for (const context of ["title", "body", "table", "page-boundary"] as const)
  test(`DOCX inline image has no text intersection in ${context}, including export and reopen`, async ({
    page,
  }, info) => {
    const paragraph = new Paragraph({
      children: [
        new TextRun({
          text: "공개 편집 검증 문서",
          size: context === "title" ? 32 : 20,
          bold: context === "title",
        }),
      ],
      spacing: { after: 0 },
    });
    const before =
      context === "page-boundary"
        ? Array.from(
            { length: 41 },
            (_, i) =>
              new Paragraph({
                text: `페이지 경계 앞 본문 ${i + 1}`,
                spacing: { line: 320, after: 0 },
              }),
          )
        : [];
    const children = [
      ...before,
      context === "table"
        ? new Table({
            rows: [
              new TableRow({
                children: [
                  new TableCell({
                    children: [paragraph, new Paragraph("다음 줄 본문")],
                  }),
                ],
              }),
            ],
          })
        : paragraph,
      new Paragraph("그림 뒤 문장은 다음 문단에서 보입니다."),
    ];
    const bytes = await Packer.toBuffer(
      new Document({
        sections: [
          {
            properties: {
              page: {
                size: { width: 11906, height: 16838 },
                margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
              },
            },
            children,
          },
        ],
      }),
    );
    await page.goto("/harness.html");
    await page.waitForFunction(() => window.documentStudioTest);
    await page.evaluate(
      (bytes) => window.documentStudioTest.loadBytes(bytes, "docx"),
      Array.from(bytes),
    );
    await expect
      .poll(() => page.evaluate(() => window.documentStudioTest.state()?.ready))
      .toBe(true);
    await page.evaluate(async () => {
      const agent = window.documentStudioTest.agent;
      const state = agent.getState();
      const found = await agent.search({
        documentId: state.documentId,
        query: "공",
      });
      await agent.select({
        documentId: state.documentId,
        expectedSessionId: state.sessionId,
        expectedRevision: found.revision,
        matchId: found.matches[0]!.id,
      });
    });
    // The pinned engine supports cell insertion at text-segment boundaries.
    await page.keyboard.press(context === "table" ? "ArrowLeft" : "ArrowRight");
    const png = new PNG({ width: 400, height: 100 });
    png.data.fill(180);
    await page.evaluate(
      async (bytes) =>
        window.documentStudioTest.execute({
          id: "insertImage",
          value: {
            bytes: new Uint8Array(bytes),
            mimeType: "image/png",
            widthMm: 80,
            heightMm: 20,
            alt: "자체 생성 인라인 배치 시험",
          },
        }),
      Array.from(PNG.sync.write(png)),
    );
    const exported = await page.evaluate(() =>
      window.documentStudioTest.export(),
    );
    const xml = strFromU8(
      unzipSync(new Uint8Array(exported))["word/document.xml"]!,
    );
    expect(xml).toContain("wp:inline");
    expect(xml).toMatch(/cx="2880000" cy="720000"/);
    await mkdir(".build/fixes-0.2.7", { recursive: true });
    await writeFile(
      `.build/fixes-0.2.7/inline-${context}-${info.project.name}.docx`,
      new Uint8Array(exported),
    );
    for (const phase of ["inserted", "reopened"]) {
      if (phase === "reopened") {
        await page.reload();
        await page.waitForFunction(() => window.documentStudioTest);
        await page.evaluate(
          (bytes) => window.documentStudioTest.loadBytes(bytes, "docx"),
          exported,
        );
        await expect
          .poll(() =>
            page.evaluate(() => window.documentStudioTest.state()?.ready),
          )
          .toBe(true);
      }
      const img = page.locator(".ds-editor-body img").first();
      await expect(img).toBeVisible();
      const geometry = await page.evaluate(() => {
        const img = document.querySelector(".ds-editor-body img")!;
        const image = img.getBoundingClientRect().toJSON();
        const root = img.closest(".docx-page")!;
        const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const texts = [];
        while (walk.nextNode()) {
          const node = walk.currentNode;
          if (!node.textContent?.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          for (const box of range.getClientRects())
            if (box.width && box.height)
              texts.push({ text: node.textContent, box: box.toJSON() });
        }
        return {
          image,
          texts,
          page: root.getAttribute("data-page-index"),
          pageBox: root.getBoundingClientRect().toJSON(),
          cellBox: img
            .closest(".docx-table-cell")
            ?.getBoundingClientRect()
            .toJSON(),
        };
      });
      await mkdir(".build/fixes-0.2.7", { recursive: true });
      await writeFile(
        `.build/fixes-0.2.7/inline-${context}-${phase}-${info.project.name}.json`,
        JSON.stringify(geometry, null, 2),
      );
      await page.screenshot({
        path: `.build/fixes-0.2.7/inline-${context}-${phase}-${info.project.name}.png`,
      });
      const overlaps = geometry.texts.filter(
        ({ box }) =>
          Math.min(box.right, geometry.image.right) -
            Math.max(box.left, geometry.image.left) >
            1 &&
          Math.min(box.bottom, geometry.image.bottom) -
            Math.max(box.top, geometry.image.top) >
            1,
      );
      expect(overlaps).toEqual([]);
      const adjacent = geometry.texts
        .filter(
          ({ box }) =>
            box.left >= geometry.image.right - 1 &&
            box.top < geometry.image.bottom &&
            box.bottom > geometry.image.top,
        )
        .sort((a, b) => a.box.left - b.box.left);
      expect(adjacent.length).toBeGreaterThan(0);
      expect(adjacent[0]!.box.left - geometry.image.right).toBeLessThan(2);
      if (geometry.cellBox)
        for (const text of adjacent)
          expect(text.box.right).toBeLessThanOrEqual(
            geometry.cellBox.right + 1,
          );
      expect(geometry.image.height).toBeCloseTo((20 * 96) / 25.4, 1);
      expect(geometry.image.bottom).toBeLessThanOrEqual(
        geometry.pageBox.bottom,
      );
      if (context === "page-boundary")
        expect(Number(geometry.page)).toBeGreaterThan(0);
    }
  });
