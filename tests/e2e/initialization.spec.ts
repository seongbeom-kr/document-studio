import { expect, test, type Page } from "@playwright/test";

type Fault = "html" | "handshake" | "ready" | "loadFile" | "loadFile-error";
async function faultHost(page: Page, fault: Fault) {
  let blocked = true;
  let resume!: () => void;
  const suspended = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/editor-assets/rhwp/index.html?*", async (route) => {
    if (!blocked) return route.continue();
    if (fault === "html") {
      await suspended;
      await route.abort().catch(() => undefined);
      return;
    }
    const html =
      fault === "handshake"
        ? "<!doctype html><title>No transport</title>"
        : `<!doctype html><script>
      addEventListener('message', event => {
        if(event.data.type !== 'rhwp-connect') return;
        const port=event.ports[0], sessionId=event.data.sessionId;
        port.onmessage=({data}) => {
          if(data.method==='loadFile' && ${JSON.stringify(fault)}==='loadFile') return;
          const response={type:'rhwp-response',version:1,id:data.id,sessionId};
          if(data.method==='loadFile') response.error={code:'TEST_LOAD_FAILURE',message:'Injected load failure'};
          else response.result=data.method==='ready' ? ${fault !== "ready"} : {};
          port.postMessage(response);
        };
        port.start();
        port.postMessage({type:'rhwp-connected',version:1,sessionId,capabilities:['transferable-array-buffer']});
      });
    </script>`;
    await route.fulfill({ status: 200, contentType: "text/html", body: html });
  });
  await page.goto("/harness.html?rhwpInitializationTimeoutMs=4000");
  await page.waitForFunction(() => !!window.documentStudioTest);
  return {
    errors,
    recover() {
      blocked = false;
      resume();
    },
    release() {
      resume();
    },
  };
}
async function load(page: Page, expectLoading = true) {
  await page.evaluate(() =>
    window.documentStudioTest.load("hwpx", "blank.hwpx"),
  );
  if (!expectLoading) return;
  await expect(page.locator("iframe")).toHaveCount(1);
  await expect(page.locator(".ds-editor-body")).toHaveAttribute("inert", "");
  expect(
    await page
      .locator("iframe")
      .evaluate((frame) =>
        new URL((frame as HTMLIFrameElement).src).searchParams.get(
          "documentStudioInputBlocked",
        ),
      ),
  ).toBe("true");
  await expect
    .poll(() =>
      page.evaluate(
        () => window.documentStudioTest.state()?.initialization?.status,
      ),
    )
    .toBe("loading");
}
async function failed(page: Page, code = "engine-initialization-timeout") {
  await expect(
    page.getByRole("button", { name: "편집기 다시 시도", exact: true }),
  ).toBeVisible();
  await expect(page.locator("iframe")).toHaveCount(0);
  const state = await page.evaluate(() => window.documentStudioTest.state()!);
  expect(state).toMatchObject({
    ready: false,
    busy: false,
    pendingCommands: 0,
    initialization: {
      status: "failed",
      error: { code, retryable: true },
    },
  });
  const rejected = await page.evaluate(async () => {
    const host = window.documentStudioTest;
    const results = await Promise.allSettled([
      host.execute({ id: "insertText", value: "초기화 실패 중에는 적용 금지" }),
      host.save(),
    ]);
    return {
      statuses: results.map((result) => result.status),
      saves: host.saves,
      commands: host.commandsStarted,
    };
  });
  expect(rejected).toEqual({
    statuses: ["rejected", "rejected"],
    saves: 0,
    commands: [],
  });
  await expect(page.getByText("문서 준비 중", { exact: true })).toHaveCount(0);
  return state;
}
async function verifyRecoveredEditor(page: Page) {
  await expect
    .poll(() => page.evaluate(() => window.documentStudioTest.state()?.ready))
    .toBe(true);
  await expect(page.locator(".ds-editor-body")).not.toHaveAttribute(
    "inert",
    "",
  );
  await expect(page.locator("iframe")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "편집기 다시 시도", exact: true }),
  ).toHaveCount(0);
  const result = await page.evaluate(async () => {
    const host = window.documentStudioTest;
    await host.execute({
      id: "insertText",
      value: "초기화 재시도 후 정상 편집",
    });
    const agent = host.agent;
    const read = await agent.readDocument({
      documentId: agent.getState().documentId,
    });
    await host.save();
    return { read, state: host.state(), saved: host.savedEvent!.bytes };
  });
  expect(result.read.text).toContain("초기화 재시도 후 정상 편집");
  expect(result.state).toMatchObject({
    ready: true,
    dirty: false,
    initialization: { status: "ready" },
  });
  // The recovered session must produce usable bytes, not just a successful ready flag.
  await page.evaluate(
    (bytes) => window.documentStudioTest.loadBytes(bytes, "hwpx"),
    result.saved,
  );
  await expect
    .poll(() => page.evaluate(() => window.documentStudioTest.state()?.ready))
    .toBe(true);
  const reopened = await page.evaluate(() => {
    const agent = window.documentStudioTest.agent;
    return agent.readDocument({ documentId: agent.getState().documentId });
  });
  expect(reopened.text).toContain("초기화 재시도 후 정상 편집");
}

for (const fault of [
  "html",
  "handshake",
  "ready",
  "loadFile",
  "loadFile-error",
] as const) {
  test(`HWPX ${fault}: finite failure, complete disposal and healthy retry`, async ({
    page,
  }, info) => {
    const host = await faultHost(page, fault);
    try {
      await load(page, fault !== "loadFile-error");
      const before = await failed(
        page,
        fault === "loadFile-error" ? "engine-initialization-failed" : undefined,
      );
      await info.attach("failed-state", {
        body: JSON.stringify(before),
        contentType: "application/json",
      });
      host.recover();
      await page
        .getByRole("button", { name: "편집기 다시 시도", exact: true })
        .click();
      await expect
        .poll(() =>
          page.evaluate(() => window.documentStudioTest.state()?.sessionId),
        )
        .not.toBe(before.sessionId);
      await verifyRecoveredEditor(page);
      expect(host.errors).toEqual([]);
    } finally {
      host.release();
    }
  });
}

test("HWPX retry via public agent API rejects stale guards and repeated failure stays recoverable", async ({
  page,
}) => {
  const host = await faultHost(page, "ready");
  await load(page);
  const first = await failed(page);
  const stale = await page.evaluate((state) => {
    const agent = window.documentStudioTest.agent;
    try {
      agent.retryInitialization({
        documentId: state.documentId,
        expectedSessionId: "old",
        expectedVersion: state.version,
      });
    } catch (error) {
      return (error as Error).message;
    }
  }, first);
  expect(stale).toContain("세션");
  await page.evaluate(
    (state) =>
      window.documentStudioTest.agent.retryInitialization({
        documentId: state.documentId,
        expectedSessionId: state.sessionId,
        expectedVersion: state.version,
      }),
    first,
  );
  await expect(page.locator("iframe")).toHaveCount(1);
  const second = await failed(page);
  expect(second.sessionId).not.toBe(first.sessionId);
  host.recover();
  await page.evaluate(
    (state) =>
      window.documentStudioTest.agent.retryInitialization({
        documentId: state.documentId,
        expectedSessionId: state.sessionId,
        expectedVersion: state.version,
      }),
    second,
  );
  await verifyRecoveredEditor(page);
  expect(host.errors).toEqual([]);
});

test("closing a stalled HWPX removes its frame and ignores late completion", async ({
  page,
}) => {
  const host = await faultHost(page, "html");
  await load(page);
  await page.evaluate(() => window.documentStudioTest.closeAfterDraft());
  await expect(page.getByText("편집기 닫힘", { exact: true })).toBeVisible();
  await expect(page.locator("iframe")).toHaveCount(0);
  host.recover();
  await page.waitForTimeout(4500);
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(host.errors).toEqual([]);
});

test("switching a stalled HWPX to DOCX cancels the old deadline without touching the new document", async ({
  page,
}) => {
  const host = await faultHost(page, "html");
  await load(page);
  await page.evaluate(() =>
    window.documentStudioTest.load("docx", "blank.docx"),
  );
  await expect
    .poll(() => page.evaluate(() => window.documentStudioTest.state()?.ready))
    .toBe(true);
  await expect(page.locator("iframe")).toHaveCount(0);
  host.recover();
  await page.waitForTimeout(4500);
  expect(
    await page.evaluate(() => window.documentStudioTest.state()),
  ).toMatchObject({
    format: "docx",
    ready: true,
    dirty: false,
    initialization: { status: "ready" },
  });
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(host.errors).toEqual([]);
});

test("a recovered HWPX draft survives cancellation before the editor becomes ready", async ({
  page,
}) => {
  const host = await faultHost(page, "html");
  const original = await page.evaluate(async () => {
    const api = window.documentStudioTest;
    await api.seedDraft("hwpx", "blank.hwpx", "복구할 초안을 보존합니다");
    const bytes = await api.storedDraft("blank.hwpx");
    await api.load("hwpx", "blank.hwpx");
    return bytes;
  });
  await page.getByRole("button", { name: "초안 복구", exact: true }).click();
  await expect(page.locator("iframe")).toHaveCount(1);
  await page.evaluate(() => window.documentStudioTest.closeAfterDraft());
  host.recover();
  await expect(page.getByText("편집기 닫힘", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() =>
      window.documentStudioTest.storedDraft("blank.hwpx"),
    ),
  ).toEqual(original);
  await page.evaluate(() =>
    window.documentStudioTest.load("hwpx", "blank.hwpx"),
  );
  await page.getByRole("button", { name: "초안 복구", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.documentStudioTest.state()?.ready))
    .toBe(true);
  expect(
    await page.evaluate(() => window.documentStudioTest.state()?.dirty),
  ).toBe(true);
  const text = await page.evaluate(() => {
    const agent = window.documentStudioTest.agent;
    return agent.readDocument({ documentId: agent.getState().documentId });
  });
  expect(text.text).toContain("복구할 초안을 보존합니다");
  expect(host.errors).toEqual([]);
});

test("read-only permission remains enforced after a failed HWPX initialization is retried", async ({
  page,
}) => {
  const host = await faultHost(page, "ready");
  await page.evaluate(() => {
    window.documentStudioTest.readOnly = true;
  });
  await load(page);
  await failed(page);
  host.recover();
  await page
    .getByRole("button", { name: "편집기 다시 시도", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => window.documentStudioTest.state()?.ready))
    .toBe(true);
  const result = await page.evaluate(async () => {
    const api = window.documentStudioTest;
    try {
      await api.execute({ id: "insertText", value: "금지" });
    } catch (error) {
      return { error: (error as Error).message, state: api.state() };
    }
  });
  expect(result?.error).toContain("읽기 전용");
  expect(result?.state).toMatchObject({ dirty: false, ready: true });
  expect(host.errors).toEqual([]);
});
