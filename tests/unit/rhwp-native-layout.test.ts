import { beforeAll, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import init, { HwpDocument } from "../../third_party/rhwp-core/rhwp.js";
import upstreamInit, { HwpDocument as UpstreamDocument } from "@rhwp/core";

type Control = {
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  controlIdx: number;
};
let fixture: Uint8Array;
beforeAll(async () => {
  await upstreamInit({
    module_or_path: await readFile("node_modules/@rhwp/core/rhwp_bg.wasm"),
  });
  await init({
    module_or_path: await readFile("third_party/rhwp-core/rhwp_bg.wasm"),
  });
  fixture = await readFile("fixtures/paragraph-overlay.hwpx");
});
const controls = (doc: HwpDocument): Control[] =>
  JSON.parse(doc.getPageControlLayout(0)).controls;
const picture = (doc: HwpDocument) =>
  controls(doc).find((c) => c.type === "image")!;
const properties = (doc: HwpDocument) =>
  JSON.parse(doc.getPictureProperties(0, 0, picture(doc).controlIdx));
function variant(change: (xml: string) => string) {
  const parts = unzipSync(fixture);
  parts["Contents/section0.xml"] = strToU8(
    change(strFromU8(parts["Contents/section0.xml"]!)),
  );
  return zipSync(parts);
}

for (const format of ["hwpx", "hwp"] as const) {
  it(`${format}: floating picture uses the paragraph anchor before an inline table`, () => {
    const source = new HwpDocument(fixture);
    const bytes = format === "hwp" ? source.exportHwp() : fixture;
    source.free();
    const doc = new HwpDocument(bytes);
    try {
      const image = picture(doc),
        table = controls(doc).find((c) => c.type === "table")!;
      // top margin 5668 + header margin 4252 + first line 0 - offset 2000.
      expect(image.y).toBeCloseTo((5668 + 4252 - 2000) / 75, 1);
      expect(image.y + image.h).toBeLessThan(table.y);
      const props = properties(doc);
      expect(props.vertRelTo).toBe("Para");
      expect(props.vertOffset).toBe(-2000);
      const snapshot = doc.saveSnapshot();
      doc.insertTextInCell(0, 0, table.controlIdx, 0, 0, 0, "편집");
      expect(picture(doc).y).toBe(image.y);
      doc.restoreSnapshot(snapshot);
      expect(picture(doc)).toEqual(image);
      doc.discardSnapshot(snapshot);
      const exported = format === "hwp" ? doc.exportHwp() : doc.exportHwpx();
      const reopened = new HwpDocument(exported);
      try {
        expect(picture(reopened)).toEqual(image);
        expect(properties(reopened).vertOffset).toBe(-2000);
        expect(properties(reopened).vertRelTo).toBe("Para");
      } finally {
        reopened.free();
      }
    } finally {
      doc.free();
    }
  });
}

it.each([-3000, 0, 1500])(
  "paragraph-relative signed offset %i is applied exactly once",
  (offset) => {
    const bytes = variant((xml) =>
      xml.replace('vertOffset="-2000"', `vertOffset="${offset}"`),
    );
    const doc = new HwpDocument(bytes);
    try {
      expect(picture(doc).y).toBeCloseTo((5668 + 4252 + offset) / 75, 1);
    } finally {
      doc.free();
    }
  },
);

it("paper-relative coordinates remain absolute", () => {
  const bytes = variant((xml) =>
    xml.replace(
      'vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" vertOffset="-2000"',
      'vertRelTo="PAPER" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" vertOffset="3000"',
    ),
  );
  const doc = new HwpDocument(bytes);
  try {
    expect(properties(doc).vertRelTo).toBe("Paper");
    expect(picture(doc).y).toBeCloseTo(40, 1);
  } finally {
    doc.free();
  }
});

it.each(["BEHIND_TEXT", "SQUARE", "TOP_AND_BOTTOM"])(
  "%s wrapping keeps upstream geometry",
  (wrap) => {
    const bytes = variant((xml) =>
      xml.replace('textWrap="IN_FRONT_OF_TEXT"', `textWrap="${wrap}"`),
    );
    const doc = new HwpDocument(bytes),
      original = new UpstreamDocument(bytes);
    try {
      expect(controls(doc)).toEqual(
        JSON.parse(original.getPageControlLayout(0)).controls,
      );
    } finally {
      doc.free();
      original.free();
    }
  },
);

it("inline pictures keep upstream geometry", () => {
  const bytes = variant((xml) =>
    xml.replace(/<hp:pic\b[\s\S]*?<\/hp:pic>/, (pic) =>
      pic.replace('treatAsChar="0"', 'treatAsChar="1"'),
    ),
  );
  const doc = new HwpDocument(bytes),
    original = new UpstreamDocument(bytes);
  try {
    expect(controls(doc)).toEqual(
      JSON.parse(original.getPageControlLayout(0)).controls,
    );
  } finally {
    doc.free();
    original.free();
  }
});
