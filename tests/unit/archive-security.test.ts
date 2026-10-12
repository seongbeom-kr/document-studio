import { describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { readFileSync } from "node:fs";
import {
  validateDocumentArchive,
  ARCHIVE_LIMITS,
  validateTemplate,
  transformCells,
  datePeriod,
} from "@document-studio/core";
import { permittedLicense } from "../../scripts/license-policy.mjs";
const basic = () =>
  zipSync({
    "[Content_Types].xml": strToU8("<Types/>"),
    "word/document.xml": strToU8("<document/>"),
  });
describe("archive preflight", () => {
  for (const format of ["docx", "hwpx"] as const)
    for (const kind of ["blank", "sample", "rich"])
      it(`accepts generated ${kind}.${format}`, () =>
        expect(() =>
          validateDocumentArchive(
            new Uint8Array(readFileSync(`fixtures/${kind}.${format}`)),
            format,
          ),
        ).not.toThrow());
  it("validates typed array slices with an offset", () => {
    const zip = basic(),
      container = new Uint8Array(zip.length + 16);
    container.set(zip, 8);
    expect(() =>
      validateDocumentArchive(container.subarray(8, 8 + zip.length), "docx"),
    ).not.toThrow();
  });
  it.each([0, 1, 21, 35, 70])("rejects truncated input %s", (length) =>
    expect(() =>
      validateDocumentArchive(basic().subarray(0, length), "docx"),
    ).toThrow(),
  );
  it("rejects the wrong format", () =>
    expect(() => validateDocumentArchive(basic(), "hwpx")).toThrow("형식"));
  it("rejects path traversal", () =>
    expect(() =>
      validateDocumentArchive(
        zipSync({ "../document.xml": strToU8("bad") }),
        "docx",
      ),
    ).toThrow());
  it("rejects macros", () =>
    expect(() =>
      validateDocumentArchive(
        zipSync({ "word/vbaProject.bin": new Uint8Array([1]) }),
        "docx",
      ),
    ).toThrow("매크로"));
  it("rejects declared inflated entry size before extraction", () => {
    const zip = basic();
    const view = new DataView(zip.buffer);
    const central = zip.findIndex(
      (_, i) => i + 4 < zip.length && view.getUint32(i, true) === 0x02014b50,
    );
    view.setUint32(central + 24, ARCHIVE_LIMITS.entryBytes + 1, true);
    expect(() => validateDocumentArchive(zip, "docx")).toThrow();
  });
  it("rejects a mismatched local entry", () => {
    const zip = basic();
    zip[30] = 120;
    expect(() => validateDocumentArchive(zip, "docx")).toThrow();
  });
  it("rejects encrypted flags", () => {
    const zip = basic();
    const view = new DataView(zip.buffer);
    const c = zip.findIndex(
      (_, i) => i + 4 < zip.length && view.getUint32(i, true) === 0x02014b50,
    );
    view.setUint16(c + 8, 1, true);
    expect(() => validateDocumentArchive(zip, "docx")).toThrow();
  });
});
describe("public input boundaries", () => {
  it.each([
    null,
    {},
    { fileName: "../bad.docx", blocks: [] },
    { fileName: "x", blocks: [{ kind: "heading", level: 0, text: "x" }] },
    { fileName: "x", blocks: [{ kind: "table", rows: [[1]] }] },
    { fileName: "x", blocks: [null] },
  ])("rejects malformed template %j", (input) =>
    expect(() => validateTemplate(input as never)).toThrow(),
  );
  it("preserves fractional digits when adding separators", () =>
    expect(transformCells([["-1234.123456"]], "commas")).toEqual([
      ["-1,234.123456"],
    ]));
  it("rejects date overflow", () =>
    expect(() => datePeriod("9999-12-31", "nextMonth")).toThrow());
  it.each([
    "MIT",
    "Apache-2.0",
    "MIT OR GPL-3.0",
    "(MIT OR Apache-2.0) AND BSD-3-Clause",
    "MIT/Apache-2.0",
    "Apache-2.0 WITH LLVM-exception",
  ])("permits compatible choice %s", (license) =>
    expect(permittedLicense(license)).toBe(true),
  );
  it.each([
    "GPL-3.0",
    "AGPL-3.0-only",
    "MIT AND GPL-3.0",
    "SEE LICENSE IN file.txt",
    "UNLICENSED",
    "",
    "MIT OR",
    "LicenseRef-Custom",
  ])("rejects unchecked or incompatible license %s", (license) =>
    expect(permittedLicense(license)).toBe(false),
  );
});
