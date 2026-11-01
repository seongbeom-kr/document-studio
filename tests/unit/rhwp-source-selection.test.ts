import { beforeAll, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import init, { HwpDocument } from "../../third_party/rhwp-core/rhwp.js";
const source = await readFile(
  new URL(
    "../../packages/engine-rhwp/assets/document-studio-extension.js",
    import.meta.url,
  ),
  "utf8",
);
beforeAll(async () => {
  await init({
    module_or_path: await readFile(
      new URL("../../third_party/rhwp-core/rhwp_bg.wasm", import.meta.url),
    ),
  });
});
function fixture(readOnly = true, text = "가😀나") {
  const doc = HwpDocument.createEmpty();
  doc.createBlankDocument();
  doc.insertText(0, 0, 0, text);
  const commands = new Map<string, { execute(s: unknown, p: unknown): void }>(),
    messages: any[] = [];
  let start = () => {};
  const input = {
    getCursorPosition: () => ({
      sectionIndex: 0,
      paragraphIndex: 0,
      charOffset: 2,
    }),
    getSelection: () => ({
      start: { sectionIndex: 0, paragraphIndex: 0, charOffset: 1 },
      end: { sectionIndex: 0, paragraphIndex: 0, charOffset: 2 },
    }),
    getSelectedCellRange: (): unknown => null,
    getSelectedTableRef: (): unknown => null,
    getSelectedPictureRefs: (): unknown[] => [],
    hasExcludedCellSelection: () => false,
  };
  const services = {
    getInputHandler: () => input,
    getContext: () => ({ isDirty: false }),
    wasm: doc,
  };
  runInNewContext(source, {
    URL,
    location: {
      href: `https://editor.example/?documentStudioOrigin=https://host.example&documentStudioReadOnly=${readOnly}`,
    },
    document: {
      documentElement: {},
      querySelectorAll: () => [],
      addEventListener() {},
    },
    window: {
      addEventListener() {},
      parent: { postMessage: (m: unknown) => messages.push(m) },
      rhwpStudio: {
        automation: { registerCommand: (c: any) => commands.set(c.id, c) },
      },
    },
    MutationObserver: class {
      observe() {}
    },
    setInterval: (cb: () => void) => {
      start = cb;
      return 1;
    },
    clearInterval() {},
    queueMicrotask,
  });
  start();
  return {
    doc,
    input,
    capture() {
      commands.get("ext:document-studio:rpc")!.execute(services, {
        requestId: "r",
        method: "captureSourceSelection",
      });
      return messages.at(-1);
    },
  };
}
it("converts native Unicode scalar offsets to exact UTF-16 without dirtying bytes", () => {
  const f = fixture();
  try {
    const before = f.doc.exportHwpx();
    const value = f.capture();
    expect(value.error).toBeUndefined();
    expect(value.result).toMatchObject({
      address: { format: "hwpx", section: 0, paragraph: 0 },
      text: "가😀나",
      start: 1,
      end: 3,
    });
    expect(f.doc.exportHwpx()).toEqual(before);
  } finally {
    f.doc.free();
  }
});
it("refuses capture while editing is permitted", () => {
  const f = fixture(false);
  try {
    expect(f.capture().error).toContain(
      "TEMPLATE_SELECTION_READ_ONLY_REQUIRED",
    );
  } finally {
    f.doc.free();
  }
});
it.each(["table", "picture", "cells"] as const)(
  "rejects a %s object selection instead of reusing the previous text cursor",
  (kind) => {
    const f = fixture();
    try {
      if (kind === "table")
        f.input.getSelectedTableRef = () => ({
          sectionIndex: 0,
          paragraphIndex: 1,
          controlIndex: 0,
        });
      if (kind === "picture")
        f.input.getSelectedPictureRefs = () => [
          { sectionIndex: 0, paragraphIndex: 1, controlIndex: 0 },
        ];
      if (kind === "cells")
        f.input.getSelectedCellRange = () => ({
          startCellIndex: 0,
          endCellIndex: 1,
        });
      expect(f.capture().error).toContain("TEMPLATE_SELECTION_UNSUPPORTED");
    } finally {
      f.doc.free();
    }
  },
);
it("converts a range after emoji and combining characters without normalizing the source", () => {
  const f = fixture(true, "가😀e\u0301나");
  try {
    f.input.getSelection = () => ({
      start: { sectionIndex: 0, paragraphIndex: 0, charOffset: 4 },
      end: { sectionIndex: 0, paragraphIndex: 0, charOffset: 5 },
    });
    expect(f.capture().result).toMatchObject({
      text: "가😀e\u0301나",
      start: 5,
      end: 6,
    });
  } finally {
    f.doc.free();
  }
});
it("rejects selection crossing a paragraph even when both paragraphs could contain identical text", () => {
  const f = fixture();
  try {
    f.input.getSelection = () => ({
      start: { sectionIndex: 0, paragraphIndex: 0, charOffset: 1 },
      end: { sectionIndex: 0, paragraphIndex: 1, charOffset: 2 },
    });
    expect(f.capture().error).toContain("TEMPLATE_SELECTION_SINGLE_PARAGRAPH");
  } finally {
    f.doc.free();
  }
});
