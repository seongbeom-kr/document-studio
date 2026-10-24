import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { deflateSync } from "fflate";
import {
  validateHwpDocument,
  validateDocumentArchive,
  captureExportSnapshot,
} from "../../packages/core/src/index";
import { exportVerifiedHwp } from "../../packages/engine-rhwp/src/hwp-export";

const fixture = () => new Uint8Array(readFileSync("fixtures/rich.hwp"));
describe("HWP5 admission", () => {
  it.each(["blank", "sample", "rich", "long"])(
    "admits project-owned %s HWP with FAT/miniFAT streams",
    (name) => {
      const bytes = new Uint8Array(readFileSync(`fixtures/${name}.hwp`));
      expect(() => validateDocumentArchive(bytes, "hwp")).not.toThrow();
    },
  );
  it.each([0, 17, 511, 512, 1000])("rejects truncated input (%d)", (size) =>
    expect(() => validateHwpDocument(fixture().slice(0, size))).toThrow(),
  );
  it("rejects a renamed ZIP, HWP3 and oversized input", () => {
    expect(() =>
      validateHwpDocument(new Uint8Array(readFileSync("fixtures/rich.hwpx"))),
    ).toThrow();
    expect(() =>
      validateHwpDocument(
        new TextEncoder().encode("HWP Document File V3.00".padEnd(512)),
      ),
    ).toThrow(/3.x/);
    expect(() =>
      validateHwpDocument(new Uint8Array(32 * 1024 * 1024 + 1)),
    ).toThrow();
  });
  it("rejects a FAT cycle before invoking WASM", () => {
    const bytes = fixture(),
      v = new DataView(bytes.buffer),
      fat = v.getUint32(76, true),
      directory = v.getUint32(48, true);
    v.setUint32((fat + 1) * 512 + directory * 4, directory, true);
    expect(() => validateHwpDocument(bytes)).toThrow();
  });
  it.each([2, 4, 16, 128, 256, 1024])(
    "rejects restricted header flags %d",
    (flag) => {
      const bytes = fixture(),
        signature = new TextEncoder().encode("HWP Document File");
      const at = bytes.findIndex((_, i) =>
        signature.every((value, j) => bytes[i + j] === value),
      );
      expect(at).toBeGreaterThan(0);
      const v = new DataView(bytes.buffer);
      v.setUint32(at + 36, v.getUint32(at + 36, true) | flag, true);
      expect(() => validateHwpDocument(bytes)).toThrow(/편집할 수 없/);
    },
  );
  it("rejects invalid stream identities", () => {
    const bytes = fixture();
    const at = bytes.findIndex(
      (_, i) =>
        bytes[i] === 72 &&
        bytes[i + 1] === 87 &&
        bytes[i + 2] === 80 &&
        bytes[i + 3] === 32,
    );
    bytes[at] = 0;
    expect(() => validateHwpDocument(bytes)).toThrow();
  });
});

describe("HWP verified export", () => {
  const editor = (changes: Record<string, unknown> = {}, bytes = fixture()) =>
    ({
      exportHwp: async () => bytes,
      exportHwpVerify: async () => ({
        recovered: true,
        pageCountBefore: 1,
        pageCountAfter: 1,
        bytesLen: bytes.length,
        ...changes,
      }),
    }) as Parameters<typeof exportVerifiedHwp>[0];
  const serialize = async () => ({
    bytes: fixture(),
    contentLoss: {
      schemaVersion: 1,
      outputFormat: "hwp",
      count: 0,
      losses: [],
    },
  });
  it("keeps HWP binary bytes and revision", async () => {
    const result = await captureExportSnapshot(
      "hwp",
      () => "7",
      () => exportVerifiedHwp(editor(), serialize),
      () => {},
    );
    expect(result.format).toBe("hwp");
    expect(result.revision).toBe("7");
    expect(() => validateHwpDocument(result.bytes)).not.toThrow();
  });
  it.each([
    { recovered: false },
    { pageCountAfter: 2 },
    { bytesLen: 0 },
    { bytesLen: NaN },
    { bytesLen: 3 },
  ])(
    "does not admit an unverified or different serialization %j",
    async (changes) => {
      await expect(
        exportVerifiedHwp(editor(changes), serialize),
      ).rejects.toThrow();
    },
  );
  it("rejects changes between verification and export", async () => {
    let revision = "1";
    await expect(
      captureExportSnapshot(
        "hwp",
        () => revision,
        () => exportVerifiedHwp(editor(), serialize),
        () => {
          revision = "2";
        },
      ),
    ).rejects.toThrow(/revision/);
  });
  it.each([
    { schemaVersion: 2 },
    { count: 1, losses: [{}] },
    { losses: [{}] },
    { outputFormat: "hwpx" },
  ])("blocks a missing, malformed or lossy report %j", async (changes) => {
    await expect(
      exportVerifiedHwp(editor(), async () => ({
        bytes: fixture(),
        contentLoss: { ...(await serialize()).contentLoss, ...changes },
      })),
    ).rejects.toThrow(/손실/);
  });
});

/** A deliberately small independent CFB writer for decompression-limit probes. */
function probeDocument(size = 64 * 1024 * 1024 + 1) {
  const encoded = deflateSync(new Uint8Array(size), { level: 9 });
  const compressed = new Uint8Array(Math.max(4096, encoded.length));
  compressed.set(encoded);
  const infoSectors = Math.ceil(compressed.length / 512),
    fatCount = Math.ceil((infoSectors + 6) / 127);
  const dir = fatCount,
    mini = dir + 1,
    miniFat = mini + 1,
    info = miniFat + 1;
  const sections = info + infoSectors,
    count = sections + 8;
  const bytes = new Uint8Array((count + 1) * 512),
    v = new DataView(bytes.buffer);
  bytes.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  const w = (o: number, n: number) => v.setUint32(o, n, true);
  v.setUint16(24, 0x3e, true);
  v.setUint16(26, 3, true);
  v.setUint16(28, 0xfffe, true);
  v.setUint16(30, 9, true);
  v.setUint16(32, 6, true);
  w(44, fatCount);
  w(48, dir);
  w(56, 4096);
  w(60, miniFat);
  w(64, 1);
  w(68, 0xfffffffe);
  for (let i = 0; i < 109; i++) w(76 + i * 4, i < fatCount ? i : 0xffffffff);
  for (let i = 0; i < fatCount * 128; i++) w(512 + i * 4, 0xffffffff);
  for (let i = 0; i < fatCount; i++) w(512 + i * 4, 0xfffffffd);
  const chain = (start: number, n: number) => {
    for (let i = 0; i < n; i++)
      w(512 + (start + i) * 4, i === n - 1 ? 0xfffffffe : start + i + 1);
  };
  for (const s of [dir, mini, miniFat]) chain(s, 1);
  chain(info, infoSectors);
  chain(sections, 8);
  const entry = (
    i: number,
    name: string,
    kind: number,
    start: number,
    size: number,
    right = 0xffffffff,
    child = 0xffffffff,
  ) => {
    const o = (dir + 1) * 512 + i * 128;
    Array.from(name + "\0").forEach((c, j) =>
      v.setUint16(o + j * 2, c.charCodeAt(0), true),
    );
    v.setUint16(o + 64, (name.length + 1) * 2, true);
    bytes[o + 66] = kind;
    bytes[o + 67] = 1;
    w(o + 68, 0xffffffff);
    w(o + 72, right);
    w(o + 76, child);
    w(o + 116, start);
    v.setBigUint64(o + 120, BigInt(size), true);
  };
  entry(0, "Root Entry", 5, mini, 256, 0xffffffff, 1);
  entry(1, "FileHeader", 2, 0, 256, 2);
  entry(2, "DocInfo", 2, info, compressed.length, 3);
  entry(3, "BodyText", 1, 0, 0, 0xffffffff, 4);
  // Place the child in a second directory sector after the body stream.
  const secondDir = count;
  const extended = new Uint8Array(bytes.length + 512);
  extended.set(bytes);
  const ev = new DataView(extended.buffer);
  ev.setUint32(512 + dir * 4, secondDir, true);
  ev.setUint32(512 + secondDir * 4, 0xfffffffe, true);
  const eo = (secondDir + 1) * 512;
  Array.from("Section0\0").forEach((c, j) =>
    ev.setUint16(eo + j * 2, c.charCodeAt(0), true),
  );
  ev.setUint16(eo + 64, 18, true);
  extended[eo + 66] = 2;
  extended[eo + 67] = 1;
  for (const o of [68, 72, 76]) ev.setUint32(eo + o, 0xffffffff, true);
  ev.setUint32(eo + 116, sections, true);
  ev.setBigUint64(eo + 120, 4096n, true);
  for (let i = 0; i < 128; i++)
    ev.setUint32(
      (miniFat + 1) * 512 + i * 4,
      i < 3 ? i + 1 : i === 3 ? 0xfffffffe : 0xffffffff,
      true,
    );
  extended.set(new TextEncoder().encode("HWP Document File"), (mini + 1) * 512);
  ev.setUint32((mini + 1) * 512 + 32, 0x05000300, true);
  ev.setUint32((mini + 1) * 512 + 36, 1, true);
  extended.set(compressed, (info + 1) * 512);
  extended.set(deflateSync(new Uint8Array(32)), (sections + 1) * 512);
  return extended;
}
it("admits the same independent CFB probe with bounded compressed content", () => {
  expect(() => validateHwpDocument(probeDocument(1024))).not.toThrow();
});
it("stops a small CFB document whose DocInfo expands beyond 64 MiB", () => {
  expect(() => validateHwpDocument(probeDocument())).toThrow(/실제 압축 해제/);
});
