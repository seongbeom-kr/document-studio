import { expect, test, type Page } from "@playwright/test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { inspectTemplate } from "../../packages/template/src/index";
const query =
    "가😀 원문 내용을 확인하고 후속 조치를 기록하는 긴 셀 문장입니다. ".repeat(
      2,
    ),
  replacement = "새로운 내용😀\n후속 조치를 확인합니다.";
async function prepare(page: Page, bytes?: Uint8Array) {
  await page.goto("/harness.html");
  await page.waitForFunction(() => Boolean(window.documentStudioTest));
  if (bytes)
    await page.evaluate(
      (data) =>
        window.documentStudioTest.loadBytes(data, "hwpx", "hwpx-long-qa"),
      Array.from(bytes),
    );
  else
    await page.evaluate(
      (query) =>
        window.documentStudioTest.createTemplate("hwpx", {
          fileName: "long-cell.hwpx",
          blocks: [
            { kind: "paragraph", text: "고정 제목" },
            {
              kind: "table",
              rows: [
                ["고정 라벨", query],
                ["유지", "고정 값"],
              ],
            },
          ],
        }),
      query,
    );
  await expect
    .poll(() => page.evaluate(() => window.documentStudioTest.state()?.ready))
    .toBe(true);
}
async function replace(page: Page, query: string, replacement: string) {
  return page.evaluate(
    async ({ query, replacement }) => {
      const api = window.documentStudioTest,
        a = api.agent,
        state = a.getState(),
        found = await a.search({ documentId: state.documentId, query });
      if (found.matches.length !== 1) throw Error("ambiguous fixture");
      await a.select({
        documentId: state.documentId,
        expectedSessionId: state.sessionId,
        expectedRevision: found.revision,
        matchId: found.matches[0]!.id,
      });
      try {
        return {
          receipt: await a.replace({
            documentId: state.documentId,
            expectedSessionId: state.sessionId,
            expectedRevision: found.revision,
            matchId: found.matches[0]!.id,
            replacement,
          }),
        };
      } catch (cause) {
        const e = cause as Error & { effect?: string };
        return { failure: { message: e.message, effect: e.effect } };
      }
    },
    { query, replacement },
  );
}
test("HWPX long cell replacement supports Unicode and line breaks with one undo", async ({
  page,
}) => {
  await prepare(page);
  const before = await page.evaluate(() => window.documentStudioTest.export());
  const outcome = await replace(page, query, replacement);
  expect(outcome.failure).toBeUndefined();
  expect(outcome.receipt!.count).toBe(1);
  const after = await page.evaluate(() => window.documentStudioTest.export());
  const structure = await inspectTemplate({
    bytes: new Uint8Array(after),
    format: "hwpx",
  });
  expect(structure.targets.filter((t) => t.text === replacement)).toHaveLength(
    1,
  );
  expect(structure.targets.some((t) => t.text === "고정 값")).toBe(true);
  await page.evaluate(() => window.documentStudioTest.execute({ id: "undo" }));
  expect(await page.evaluate(() => window.documentStudioTest.export())).toEqual(
    before,
  );
});
for (const rollbackFails of [false, true])
  test(`HWPX long cell partial failure reports ${rollbackFails ? "unknown" : "verified rollback"}`, async ({
    page,
  }, testInfo) => {
    await prepare(page);
    const before = await page.evaluate(() =>
      window.documentStudioTest.export(),
    );
    const frame = page
      .frames()
      .find((f) => f.url().includes("/editor-assets/rhwp/"))!;
    await frame.evaluate((rollbackFails) => {
      const automation = (window as any).rhwpStudio.automation;
      automation.registerCommand({
        id: "ext:test:replace-fault",
        label: "test",
        canExecute: () => true,
        execute(services: any) {
          services.wasm.deleteTextInCell = () => {
            throw new Error("injected delete failure");
          };
          if (rollbackFails)
            services.wasm.restoreSnapshot = () => {
              throw new Error("injected rollback failure");
            };
        },
      });
      automation.execute("ext:test:replace-fault");
    }, rollbackFails);
    const { failure } = await replace(page, query, replacement);
    expect(failure?.message).toContain(
      rollbackFails ? "rollback" : "injected delete failure",
    );
    expect(failure?.effect).toBe(rollbackFails ? "unknown" : "rolled-back");
    const after = await page.evaluate(() => window.documentStudioTest.export());
    if (rollbackFails) expect(after).not.toEqual(before);
    else expect(after).toEqual(before);
    const evidence = new URL(
      "../../.build/hwpx-replacement-proof/",
      import.meta.url,
    );
    await mkdir(evidence, { recursive: true });
    await writeFile(
      new URL(
        `fault-${rollbackFails ? "unknown" : "rollback"}-${testInfo.project.name}.json`,
        evidence,
      ),
      JSON.stringify(
        {
          passed: true,
          failure,
          beforeHash: createHash("sha256")
            .update(new Uint8Array(before))
            .digest("hex"),
          afterHash: createHash("sha256")
            .update(new Uint8Array(after))
            .digest("hex"),
          expectedRestoration: !rollbackFails,
          completedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  });
test("HWPX supplied QA purpose replaces the exact long cell and restores with one undo", async ({
  page,
}, testInfo) => {
  const path = process.env.DOCUMENT_STUDIO_HWPX_REPLACEMENT_QA_FILE;
  test.skip(!path, "An explicitly supplied private QA copy is optional.");
  const bytes = await readFile(path!),
    structure = await inspectTemplate({ bytes, format: "hwpx" }),
    target =
      structure.targets[
        Number(process.env.DOCUMENT_STUDIO_HWPX_REPLACEMENT_QA_INDEX ?? 12)
      ]!;
  expect(target.text.length).toBeGreaterThan(8);
  await prepare(page, bytes);
  const before = await page.evaluate(() => window.documentStudioTest.export());
  const outcome = await replace(
    page,
    target.text,
    "합성 검증: 참여자 의견과 후속 실행 계획을 기록합니다.",
  );
  expect(outcome.failure).toBeUndefined();
  const after = await page.evaluate(() => window.documentStudioTest.export());
  const changed = await inspectTemplate({
    bytes: new Uint8Array(after),
    format: "hwpx",
  });
  expect(changed.targets[12]!.text).toBe(
    "합성 검증: 참여자 의견과 후속 실행 계획을 기록합니다.",
  );
  for (let i = 0; i < structure.targets.length; i++)
    if (i !== 12)
      expect(changed.targets[i]!.text).toBe(structure.targets[i]!.text);
  await page.evaluate(() => window.documentStudioTest.execute({ id: "undo" }));
  expect(await page.evaluate(() => window.documentStudioTest.export())).toEqual(
    before,
  );
  const hash = createHash("sha256").update(bytes).digest("hex");
  expect(
    createHash("sha256")
      .update(await readFile(path!))
      .digest("hex"),
  ).toBe(hash);
  const evidence = new URL(
    "../../.build/hwpx-replacement-proof/",
    import.meta.url,
  );
  await mkdir(evidence, { recursive: true });
  await writeFile(
    new URL(`qa-${testInfo.project.name}-after.hwpx`, evidence),
    new Uint8Array(after),
  );
  await writeFile(
    new URL(`qa-${testInfo.project.name}.json`, evidence),
    JSON.stringify(
      {
        passed: true,
        sourceHash: hash,
        originalLength: target.text.length,
        targetIndex: 12,
        nonTargetTextsPreserved: true,
        oneUndoRestored: true,
        completedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
});
