import { expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { Document, Packer, Paragraph, SimpleField, TextRun } from "docx";
import init, { HwpDocument } from "../../third_party/rhwp-core/rhwp.js";

type Box = { x: number; y: number; w: number; h: number };
const fixtures: Record<string, { bytes: number[]; boxes: Box[] }> = {};
let projectedField: number[];
const members = (bytes: number[]) =>
  Object.fromEntries(
    Object.entries(unzipSync(new Uint8Array(bytes))).map(([name, value]) => [
      name,
      createHash("sha256").update(value).digest("hex"),
    ]),
  );

test.beforeAll(async () => {
  projectedField = Array.from(
    await Packer.toBuffer(
      new Document({
        sections: [
          {
            children: [
              new Paragraph(""),
              new Paragraph({
                children: [
                  new TextRun("Before "),
                  new SimpleField("PAGE", "42"),
                  new TextRun(" after."),
                ],
              }),
            ],
          },
        ],
      }),
    ),
  );
  await init({
    module_or_path: await readFile("third_party/rhwp-core/rhwp_bg.wasm"),
  });
  const blank = await readFile("fixtures/blank.hwpx");
  const archive = unzipSync(blank);
  const control = (tag: string, name: string) =>
    `<hp:${tag} caption="${name}" value="UNCHECKED" radioGroupName="group" triState="0" backStyle="OPAQUE" name="${name}" foreColor="#000000" backColor="#FFFFFF" groupName="group" tabStop="1" editable="1" tabOrder="1" enabled="1" borderTypeIDRef="0" drawFrame="1" printable="1" command=""><hp:formCharPr charPrIDRef="0" followContext="0" autoSz="0" wordWrap="0"/><hp:sz width="6500" widthRelTo="ABSOLUTE" height="1700" heightRelTo="ABSOLUTE" protect="0"/><hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="1" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/><hp:outMargin left="0" right="0" top="0" bottom="0"/></hp:${tag}>`;
  for (const kind of ["comboBox", "edit"]) {
    const source = unzipSync(blank);
    if (kind === "comboBox") {
      source["Scripts/headerScripts"] = new Uint8Array();
      source["Scripts/sourceScripts"] = new Uint8Array(
        Buffer.from(
          '\ncomboBox.InsertString("Original", 0);\ncomboBox.InsertString("ALTERNATE", 1);',
          "utf16le",
        ),
      );
    }
    const extra =
      kind === "comboBox"
        ? '<hp:listItem displayText="Original" value="Original"/><hp:listItem displayText="ALTERNATE" value="ALTERNATE"/>'
        : "<hp:text></hp:text>";
    source["Contents/section0.xml"] = strToU8(
      strFromU8(source["Contents/section0.xml"]!).replace(
        "</hp:run>",
        `${control(kind, kind).replace(`</hp:${kind}>`, `${extra}</hp:${kind}>`)}</hp:run>`,
      ),
    );
    const doc = new HwpDocument(zipSync(source));
    try {
      const tree = JSON.parse(doc.getPageRenderTree(0));
      const find = (node: {
        type: string;
        bbox: Box;
        children?: (typeof node)[];
      }): Box | undefined =>
        node.type === "Form"
          ? node.bbox
          : node.children?.map(find).find(Boolean);
      fixtures[kind] = {
        bytes: Array.from(doc.exportHwpx()),
        boxes: [find(tree)!],
      };
      if (kind === "comboBox") {
        const box = fixtures[kind]!.boxes[0]!;
        const hit = JSON.parse(
          doc.getFormObjectAt(0, box.x + box.w / 2, box.y + box.h / 2),
        );
        expect(
          JSON.parse(doc.getFormObjectInfo(hit.sec, hit.para, hit.ci)).items,
        ).toEqual(["Original", "ALTERNATE"]);
      }
    } finally {
      doc.free();
    }
  }
  archive["Contents/section0.xml"] = strToU8(
    strFromU8(archive["Contents/section0.xml"]!).replace(
      "</hp:run>",
      `${control("checkBtn", "Checkbox")}${control("radioBtn", "Radio")}</hp:run>`,
    ),
  );
  const forms = new HwpDocument(zipSync(archive));
  try {
    const boxes: Box[] = [];
    const visit = (node: {
      type: string;
      bbox: Box;
      children?: (typeof node)[];
    }) => {
      if (node.type === "Form") boxes.push(node.bbox);
      node.children?.forEach(visit);
    };
    visit(JSON.parse(forms.getPageRenderTree(0)));
    expect(boxes).toHaveLength(2);
    fixtures.forms = { bytes: Array.from(forms.exportHwpx()), boxes };
  } finally {
    forms.free();
  }
  const shape = new HwpDocument(blank);
  try {
    shape.createShapeControl(
      JSON.stringify({
        sectionIdx: 0,
        paraIdx: 0,
        charOffset: 0,
        width: 7200,
        height: 3600,
        horzOffset: 0,
        vertOffset: 0,
        treatAsChar: false,
        textWrap: "InFrontOfText",
      }),
    );
    const box = JSON.parse(shape.getPageControlLayout(0)).controls.find(
      (item: { type: string }) => item.type === "shape",
    );
    fixtures.shape = { bytes: Array.from(shape.exportHwpx()), boxes: [box] };
    const lineArchive = unzipSync(shape.exportHwpx());
    lineArchive["Contents/section0.xml"] = strToU8(
      strFromU8(lineArchive["Contents/section0.xml"]!)
        .replaceAll("hp:rect", "hp:line")
        .replace(/<hc:pt[0-3][^>]*\/>/g, "")
        .replace(
          "</hp:line>",
          '<hc:startPt x="0" y="0"/><hc:endPt x="7200" y="3600"/></hp:line>',
        ),
    );
    const line = new HwpDocument(zipSync(lineArchive));
    try {
      fixtures.line = {
        bytes: Array.from(line.exportHwpx()),
        boxes: [
          JSON.parse(line.getPageControlLayout(0)).controls.find(
            (item: { type: string }) => item.type === "line",
          ),
        ],
      };
    } finally {
      line.free();
    }
    shape.setShapeProperties(
      0,
      0,
      box.controlIdx,
      JSON.stringify({ horzOffset: 7200, vertOffset: 7200 }),
    );
    fixtures.rotation = {
      bytes: Array.from(shape.exportHwpx()),
      boxes: [
        JSON.parse(shape.getPageControlLayout(0)).controls.find(
          (item: { type: string }) => item.type === "shape",
        ),
      ],
    };
  } finally {
    shape.free();
  }
});

for (const kind of ["comboBox", "edit"]) {
  test(`hwpx: read-only acknowledgement prevents an already open ${kind} overlay from writing`, async ({
    page,
  }, info) => {
    await page.goto("/harness.html?noStorage=true");
    await page.waitForFunction(() => !!window.documentStudioTest);
    await page.evaluate((bytes) => {
      window.documentStudioTest.draftsDisabled = true;
      window.documentStudioTest.loadBytes(bytes, "hwpx");
    }, fixtures[kind]!.bytes);
    await expect
      .poll(() =>
        page
          .locator(".ds-editor-body")
          .evaluate((body) => (body as HTMLElement).inert),
      )
      .toBe(false);
    const before = await page.evaluate(async () => ({
      bytes: await window.documentStudioTest.export(),
      revision: window.documentStudioTest.state()!.revision,
    }));
    const frame = page.frameLocator("iframe");
    const canvas = (await frame
      .locator("canvas.document-page-canvas")
      .first()
      .boundingBox())!;
    const box = fixtures[kind]!.boxes[0]!;
    await page.mouse.click(
      canvas.x + box.x + box.w / 2,
      canvas.y + box.y + box.h / 2,
    );
    const overlay =
      kind === "comboBox"
        ? frame.locator(".form-combo-item").filter({ hasText: "ALTERNATE" })
        : frame.locator(".form-edit-input");
    await expect(overlay).toBeVisible();
    if (kind === "edit")
      await overlay.fill("EDIT ENTERED BEFORE PERMISSION CHANGE");
    const oldBounds = (await overlay.boundingBox())!;
    await page.evaluate(() => {
      window.documentStudioTest.readOnly = true;
      window.documentStudioTest.rerender();
    });
    await expect(
      page.getByRole("button", { name: "굵게", exact: true }),
    ).toBeDisabled();
    await expect
      .poll(() =>
        page
          .locator(".ds-editor-body")
          .evaluate((body) => (body as HTMLElement).inert),
      )
      .toBe(false);
    const acknowledged = await page.evaluate(async () => {
      const bytes = await window.documentStudioTest.export();
      const state = window.documentStudioTest.state()!;
      return { bytes, revision: state.revision, dirty: state.dirty };
    });
    await page.mouse.click(
      oldBounds.x + oldBounds.width / 2,
      oldBounds.y + oldBounds.height / 2,
    );
    const after = await page.evaluate(async () => {
      const bytes = await window.documentStudioTest.export();
      return {
        bytes,
        revision: window.documentStudioTest.state()!.revision,
        dirty: window.documentStudioTest.state()!.dirty,
      };
    });
    const nativeText = (bytes: number[]) => {
      const doc = new HwpDocument(new Uint8Array(bytes));
      try {
        return JSON.parse(
          doc.getFormObjectAt(0, box.x + box.w / 2, box.y + box.h / 2),
        ).text;
      } finally {
        doc.free();
      }
    };
    await info.attach("overlay-permission-transition", {
      body: JSON.stringify({
        before: { ...before, bytes: undefined },
        acknowledged: { ...acknowledged, bytes: undefined },
        textBefore: nativeText(before.bytes),
        textAtAcknowledgement: nativeText(acknowledged.bytes),
        textAfterOldClick: nativeText(after.bytes),
        after: { ...after, bytes: undefined },
      }),
      contentType: "application/json",
    });
    expect.soft(after.revision).toBe(acknowledged.revision);
    expect.soft(after.dirty).toBe(acknowledged.dirty);
    if (kind === "edit")
      expect
        .soft(nativeText(acknowledged.bytes))
        .toBe("EDIT ENTERED BEFORE PERMISSION CHANGE");
    expect(members(after.bytes)).toEqual(members(acknowledged.bytes));
    await expect(
      frame.locator(".form-combo-dropdown, .form-edit-input"),
    ).toHaveCount(0);
  });
}

const nativeObject = (bytes: number[]) => {
  const doc = new HwpDocument(new Uint8Array(bytes));
  try {
    const layout = JSON.parse(doc.getPageControlLayout(0)).controls.find(
      (item: { type: string }) => ["shape", "line"].includes(item.type),
    );
    return {
      layout,
      properties: JSON.parse(
        doc.getShapeProperties(
          layout.secIdx,
          layout.paraIdx,
          layout.controlIdx,
        ),
      ),
    };
  } finally {
    doc.free();
  }
};

const observeObject = (page: Page) =>
  page.evaluate(async () => {
    const host = window.documentStudioTest;
    const bytes = await host.export();
    const state = host.state()!;
    return { bytes, revision: state.revision, dirty: state.dirty };
  });

async function permissionAcknowledged(page: Page, readOnly: boolean) {
  await expect(page.getByRole("button", { name: "굵게", exact: true }))[
    readOnly ? "toBeDisabled" : "toBeEnabled"
  ]();
  await expect
    .poll(() =>
      page
        .locator(".ds-editor-body")
        .evaluate((body) => (body as HTMLElement).inert),
    )
    .toBe(false);
  const frame = page.frameLocator("iframe");
  await expect
    .poll(() =>
      frame.locator("html").evaluate((html) => (html as HTMLElement).inert),
    )
    .toBe(false);
  await expect
    .poll(() =>
      frame
        .getByRole("textbox", { name: "문서 편집 입력" })
        .evaluate((input) => (input as HTMLTextAreaElement).readOnly),
    )
    .toBe(readOnly);
}

for (const gesture of ["move", "resize", "rotate", "line endpoint"] as const) {
  for (const mode of [
    "read-only born",
    "permission interrupted",
    "editable",
  ] as const) {
    test(`hwpx: ${mode} object ${gesture} never leaves a stale pointer gesture`, async ({
      page,
    }, info) => {
      const kind =
        gesture === "rotate"
          ? "rotation"
          : gesture === "line endpoint"
            ? "line"
            : "shape";
      await page.goto("/harness.html?noStorage=true");
      await page.waitForFunction(() => !!window.documentStudioTest);
      await page.evaluate(
        ({ bytes, readOnly }) => {
          const host = window.documentStudioTest;
          host.readOnly = readOnly;
          host.draftsDisabled = true;
          host.loadBytes(bytes, "hwpx");
        },
        { bytes: fixtures[kind]!.bytes, readOnly: mode === "read-only born" },
      );
      await permissionAcknowledged(page, mode === "read-only born");
      const frame = page.frameLocator("iframe");
      const canvas = (await frame
        .locator("canvas.document-page-canvas")
        .first()
        .boundingBox())!;
      const box = fixtures[kind]!.boxes[0]!;
      const center = {
        x: canvas.x + box.x + box.w / 2,
        y: canvas.y + box.y + box.h / 2,
      };
      const select =
        gesture === "line endpoint"
          ? center
          : { x: canvas.x + box.x + 1, y: center.y };
      const start =
        gesture === "resize"
          ? { x: canvas.x + box.x + box.w, y: center.y }
          : gesture === "rotate"
            ? { x: center.x, y: canvas.y + box.y - 20 }
            : gesture === "line endpoint"
              ? { x: canvas.x + box.x + box.w, y: canvas.y + box.y + box.h }
              : center;
      // Capture the browser's real mouse buttons; no synthetic event or SDK selection.
      await frame.locator("html").evaluate(() => {
        const pointer = window as typeof window & {
          __objectPointerButtons?: number;
        };
        window.addEventListener(
          "mousemove",
          (event) => {
            pointer.__objectPointerButtons = event.buttons;
          },
          true,
        );
      });
      const before = await observeObject(page);
      let beforePermission = before;
      let readOnlyAcknowledged: typeof before | undefined;
      await page.mouse.click(select.x, select.y);
      await page.evaluate(() => window.documentStudioTest.export());
      expect(
        JSON.parse(
          await page.evaluate(
            () => window.documentStudioTest.state()!.selectionKey!,
          ),
        ).pictures,
      ).toHaveLength(1);
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      if (mode === "read-only born") {
        await page.mouse.up();
      } else {
        // Let a legitimate editable update reach WASM before changing permission.
        await page.mouse.move(start.x + 12, start.y + 8, { steps: 2 });
        await frame
          .locator("html")
          .evaluate(
            () =>
              new Promise<void>((resolve) =>
                requestAnimationFrame(() =>
                  requestAnimationFrame(() => resolve()),
                ),
              ),
          );
        beforePermission = await observeObject(page);
      }
      if (mode !== "editable") {
        if (mode === "permission interrupted") {
          await page.evaluate(() => {
            window.documentStudioTest.readOnly = true;
            window.documentStudioTest.rerender();
          });
          await permissionAcknowledged(page, true);
        }
        const readonly = await observeObject(page);
        readOnlyAcknowledged = readonly;
        if (mode === "read-only born") {
          expect.soft(readonly.revision).toBe(before.revision);
          expect.soft(readonly.dirty).toBe(false);
          expect
            .soft(nativeObject(readonly.bytes))
            .toEqual(nativeObject(before.bytes));
          expect(members(readonly.bytes)).toEqual(members(before.bytes));
        } else {
          expect
            .soft(nativeObject(beforePermission.bytes))
            .not.toEqual(nativeObject(before.bytes));
          expect
            .soft(nativeObject(readonly.bytes))
            .toEqual(nativeObject(beforePermission.bytes));
          expect.soft(readonly.dirty).toBe(true);
          expect(members(readonly.bytes)).toEqual(
            members(beforePermission.bytes),
          );
        }
        // Moving and releasing a real held button after the read-only ACK cannot write.
        await page.mouse.move(start.x + 24, start.y + 16, { steps: 2 });
        await page.mouse.up();
        const afterReadOnlyPointer = await observeObject(page);
        expect.soft(afterReadOnlyPointer.revision).toBe(readonly.revision);
        expect.soft(afterReadOnlyPointer.dirty).toBe(readonly.dirty);
        expect
          .soft(nativeObject(afterReadOnlyPointer.bytes))
          .toEqual(nativeObject(readonly.bytes));
        expect(members(afterReadOnlyPointer.bytes)).toEqual(
          members(readonly.bytes),
        );
        await page.evaluate(() => {
          window.documentStudioTest.readOnly = false;
          window.documentStudioTest.rerender();
        });
        await permissionAcknowledged(page, false);
      } else {
        await page.mouse.up();
      }
      const acknowledged = await observeObject(page);
      if (mode === "editable") {
        expect
          .soft(nativeObject(acknowledged.bytes))
          .not.toEqual(nativeObject(before.bytes));
        expect
          .soft(members(acknowledged.bytes))
          .not.toEqual(members(before.bytes));
        expect.soft(acknowledged.revision).not.toBe(before.revision);
        expect.soft(acknowledged.dirty).toBe(true);
      }
      await page.mouse.move(start.x + 40, start.y + 20, { steps: 2 });
      await frame
        .locator("html")
        .evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve()),
              ),
            ),
        );
      const after = await observeObject(page);
      expect(
        await frame
          .locator("html")
          .evaluate(
            () =>
              (window as typeof window & { __objectPointerButtons?: number })
                .__objectPointerButtons,
          ),
      ).toBe(0);
      await info.attach("object-permission-gesture", {
        body: JSON.stringify({
          before: {
            ...before,
            bytes: undefined,
            native: nativeObject(before.bytes),
            members: members(before.bytes),
          },
          beforePermission: {
            ...beforePermission,
            bytes: undefined,
            native: nativeObject(beforePermission.bytes),
            members: members(beforePermission.bytes),
          },
          readOnlyAcknowledged: readOnlyAcknowledged && {
            ...readOnlyAcknowledged,
            bytes: undefined,
            native: nativeObject(readOnlyAcknowledged.bytes),
            members: members(readOnlyAcknowledged.bytes),
          },
          acknowledged: {
            ...acknowledged,
            bytes: undefined,
            native: nativeObject(acknowledged.bytes),
            members: members(acknowledged.bytes),
          },
          after: {
            ...after,
            bytes: undefined,
            native: nativeObject(after.bytes),
            members: members(after.bytes),
          },
        }),
        contentType: "application/json",
      });
      expect.soft(after.revision).toBe(acknowledged.revision);
      expect.soft(after.dirty).toBe(acknowledged.dirty);
      expect
        .soft(nativeObject(after.bytes))
        .toEqual(nativeObject(acknowledged.bytes));
      expect(members(after.bytes)).toEqual(members(acknowledged.bytes));
      if (mode !== "read-only born") {
        await page.keyboard.press("Control+z");
        const undone = await observeObject(page);
        expect
          .soft(nativeObject(undone.bytes))
          .toEqual(nativeObject(before.bytes));
        expect(members(undone.bytes)).toEqual(members(before.bytes));
      }
    });
  }
}

test("hwpx: read-only object arrows cannot move or resize the pointer-selected shape", async ({
  page,
}) => {
  await page.goto("/harness.html?noStorage=true");
  await page.waitForFunction(() => !!window.documentStudioTest);
  await page.evaluate((bytes) => {
    const host = window.documentStudioTest;
    host.readOnly = true;
    host.draftsDisabled = true;
    host.loadBytes(bytes, "hwpx");
  }, fixtures.shape!.bytes);
  await permissionAcknowledged(page, true);
  const before = await observeObject(page);
  const canvas = (await page
    .frameLocator("iframe")
    .locator("canvas.document-page-canvas")
    .first()
    .boundingBox())!;
  const box = fixtures.shape!.boxes[0]!;
  await page.mouse.click(canvas.x + box.x + 1, canvas.y + box.y + box.h / 2);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+ArrowDown");
  const after = await observeObject(page);
  expect.soft(after.revision).toBe(before.revision);
  expect.soft(after.dirty).toBe(false);
  expect.soft(nativeObject(after.bytes)).toEqual(nativeObject(before.bytes));
  expect(members(after.bytes)).toEqual(members(before.bytes));
});

test("hwpx: read-only acknowledgement cancels active native connector placement without writing", async ({
  page,
}, info) => {
  await page.goto("/harness.html?noStorage=true");
  await page.waitForFunction(() => !!window.documentStudioTest);
  await page.evaluate((bytes) => {
    window.documentStudioTest.draftsDisabled = true;
    window.documentStudioTest.loadBytes(bytes, "hwpx");
  }, fixtures.rotation!.bytes);
  await permissionAcknowledged(page, false);
  const before = await observeObject(page);
  const frame = page
    .frames()
    .find((item) => item.url().includes("/editor-assets/rhwp/"))!;
  await frame.evaluate(() => {
    type Input = {
      enterShapePlacementMode(type: string): void;
      connectorDrawingMode: boolean;
      connectorStartRef: unknown;
    };
    const native = window as unknown as {
      rhwpStudio: {
        automation: {
          registerCommand(command: unknown): void;
          execute(id: string, params?: Record<string, unknown>): unknown;
        };
      };
      connectorInput: Input;
    };
    native.rhwpStudio.automation.registerCommand({
      id: "ext:document-studio:test-connector-placement",
      label: "Native connector placement fixture",
      canExecute: () => true,
      execute(services: { getInputHandler(): Input }) {
        native.connectorInput = services.getInputHandler();
        native.connectorInput.enterShapePlacementMode("connector-straight");
      },
    });
    native.rhwpStudio.automation.execute(
      "ext:document-studio:test-connector-placement",
    );
  });
  const box = fixtures.rotation!.boxes[0]!;
  const canvas = (await page
    .frameLocator("iframe")
    .locator("canvas.document-page-canvas")
    .first()
    .boundingBox())!;
  // A real native connection-point click arms the first endpoint and its preview.
  await page.mouse.click(canvas.x + box.x + box.w / 2, canvas.y + box.y);
  await page.mouse.move(
    canvas.x + box.x + box.w / 2 + 12,
    canvas.y + box.y + 8,
  );
  expect(
    await frame.evaluate(() => {
      const input = (
        window as unknown as {
          connectorInput: {
            connectorDrawingMode: boolean;
            connectorStartRef: unknown;
          };
        }
      ).connectorInput;
      return {
        active: input.connectorDrawingMode,
        hasStart: !!input.connectorStartRef,
      };
    }),
  ).toEqual({ active: true, hasStart: true });
  const permission = await frame.evaluate(() =>
    (
      window as unknown as {
        rhwpStudio: {
          automation: {
            execute(id: string, params: Record<string, unknown>): unknown;
          };
        };
      }
    ).rhwpStudio.automation.execute("ext:document-studio:read-only", {
      readOnly: true,
    }),
  );
  await info.attach("connector-permission-result", {
    body: JSON.stringify(permission),
    contentType: "application/json",
  });
  expect(permission).toMatchObject({ ok: true });
  await page.evaluate(() => {
    window.documentStudioTest.readOnly = true;
    window.documentStudioTest.rerender();
  });
  await permissionAcknowledged(page, true);
  expect(
    await frame.evaluate(() => {
      const input = (
        window as unknown as {
          connectorInput: {
            connectorDrawingMode: boolean;
            connectorStartRef: unknown;
          };
        }
      ).connectorInput;
      return {
        active: input.connectorDrawingMode,
        hasStart: !!input.connectorStartRef,
      };
    }),
  ).toEqual({ active: false, hasStart: false });
  await expect(
    page.frameLocator("iframe").locator(".connector-points-overlay"),
  ).toHaveCount(0);
  await page.mouse.move(canvas.x + box.x + box.w, canvas.y + box.y + box.h);
  await page.mouse.click(canvas.x + box.x + box.w, canvas.y + box.y + box.h);
  const after = await observeObject(page);
  expect.soft(after.revision).toBe(before.revision);
  expect.soft(after.dirty).toBe(false);
  expect.soft(nativeObject(after.bytes)).toEqual(nativeObject(before.bytes));
  expect(members(after.bytes)).toEqual(members(before.bytes));
});

test("docx: a projected field click cannot fabricate a model text selection", async ({
  page,
}) => {
  await page.goto("/harness.html?noStorage=true");
  await page.waitForFunction(() => !!window.documentStudioTest);
  await page.evaluate((bytes) => {
    window.documentStudioTest.readOnly = true;
    window.documentStudioTest.draftsDisabled = true;
    window.documentStudioTest.loadBytes(bytes, "docx");
  }, projectedField);
  await expect
    .poll(() =>
      page
        .locator(".ds-editor-body")
        .evaluate((body) => (body as HTMLElement).inert),
    )
    .toBe(false);
  const before = await page.evaluate(
    () => window.documentStudioTest.state()!.selectionKey,
  );
  const field = page.locator("[data-docx-field]").first();
  await expect(field).toBeVisible();
  const bounds = (await field.boundingBox())!;
  await page.mouse.click(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  await page.evaluate(() => window.documentStudioTest.export());
  expect(
    await page.evaluate(() => window.documentStudioTest.state()!.selectionKey),
  ).toBe(before);
});

for (const kind of ["forms", "shape", "line"]) {
  test(`hwpx: read-only ${kind} pointer clicks preserve native values, revision and archive`, async ({
    page,
  }, info) => {
    await page.goto("/harness.html?noStorage=true");
    await page.waitForFunction(() => !!window.documentStudioTest);
    await page.evaluate((bytes) => {
      const host = window.documentStudioTest;
      host.readOnly = true;
      host.draftsDisabled = true;
      host.loadBytes(bytes, "hwpx");
    }, fixtures[kind]!.bytes);
    await expect
      .poll(() => page.evaluate(() => window.documentStudioTest.state()?.ready))
      .toBe(true);
    await expect
      .poll(() =>
        page
          .locator(".ds-editor-body")
          .evaluate((body) => (body as HTMLElement).inert),
      )
      .toBe(false);
    const observe = () =>
      page.evaluate(async () => {
        const host = window.documentStudioTest;
        const bytes = await host.export();
        const state = host.state()!;
        return {
          bytes,
          revision: state.revision,
          dirty: state.dirty,
          saves: host.saves,
          draftWrites: host.draftWrites,
          selectionKey: state.selectionKey,
        };
      });
    const before = await observe();
    const canvas = (await page
      .frameLocator("iframe")
      .locator("canvas.document-page-canvas")
      .first()
      .boundingBox())!;
    for (const box of fixtures[kind]!.boxes) {
      await page.mouse.click(
        canvas.x + box.x + box.w / 2,
        canvas.y + box.y + box.h / 2,
      );
    }
    const after = await observe();
    await info.attach("native-pointer-surface", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
    const values = (bytes: number[]) => {
      const doc = new HwpDocument(new Uint8Array(bytes));
      try {
        return fixtures[kind]!.boxes.map(
          (box) =>
            JSON.parse(
              doc.getFormObjectAt(0, box.x + box.w / 2, box.y + box.h / 2),
            ).value,
        );
      } finally {
        doc.free();
      }
    };
    await info.attach("native-pointer-permission", {
      body: JSON.stringify({
        before: { ...before, bytes: undefined },
        after: { ...after, bytes: undefined },
        beforeValues: values(before.bytes),
        afterValues: values(after.bytes),
      }),
      contentType: "application/json",
    });
    if (kind === "forms") expect.soft(values(after.bytes)).toEqual([0, 0]);
    expect.soft(after.revision).toBe(before.revision);
    expect.soft(after.dirty).toBe(false);
    expect.soft(after.saves).toBe(0);
    expect.soft(after.draftWrites).toBe(0);
    expect(members(after.bytes)).toEqual(members(before.bytes));
  });
}
