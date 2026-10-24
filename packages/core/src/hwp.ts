import { Inflate } from "fflate";

const END = 0xfffffffe,
  FREE = 0xffffffff;
const MAX_FILE = 32 * 1024 * 1024,
  MAX_STREAM = 64 * 1024 * 1024;
/** Read only the bounded CFB streams needed for HWP5 preflight. No filesystem or eval. */
export function validateHwpDocument(bytes: Uint8Array): void {
  const fail = (
    message = "HWP 파일의 복합 문서 구조가 올바르지 않습니다.",
  ): never => {
    throw new Error(message);
  };
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.length < 512 ||
    bytes.length > MAX_FILE
  )
    fail();
  if (
    ![0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every(
      (b, i) => bytes[i] === b,
    )
  )
    fail(
      "현재 HWP 편집은 HWP 5.x 문서를 지원합니다. HWP 3.x는 HWPX로 변환해 주세요.",
    );
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (o: number) => v.getUint16(o, true),
    u32 = (o: number) => v.getUint32(o, true);
  const version = u16(26),
    shift = u16(30);
  if (
    u16(28) !== 0xfffe ||
    !((version === 3 && shift === 9) || (version === 4 && shift === 12)) ||
    u16(32) !== 6 ||
    u32(56) !== 4096
  )
    fail();
  const sectorSize = 2 ** shift,
    sectors = bytes.length / sectorSize - 1;
  if (!Number.isInteger(sectors) || sectors < 1) fail();
  const sector = (id: number) => {
    if (!Number.isInteger(id) || id < 0 || id >= sectors) fail();
    return bytes.subarray((id + 1) * sectorSize, (id + 2) * sectorSize);
  };
  const word = (data: Uint8Array, offset: number) =>
    new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(
      offset,
      true,
    );
  const claimed = new Set<number>();
  const claim = (id: number) => {
    if (claimed.has(id)) fail();
    sector(id);
    claimed.add(id);
  };
  const fatIds: number[] = [];
  const addFat = (id: number) => {
    if (id !== FREE) {
      claim(id);
      fatIds.push(id);
    }
  };
  const fatCount = u32(44),
    difatCount = u32(72);
  if (!fatCount || fatCount > sectors || difatCount > sectors) fail();
  for (let i = 0; i < 109; i++) addFat(u32(76 + i * 4));
  let difatId = u32(68);
  for (let i = 0; i < difatCount; i++) {
    claim(difatId);
    const data = sector(difatId);
    for (let o = 0; o < sectorSize - 4; o += 4) addFat(word(data, o));
    difatId = word(data, sectorSize - 4);
  }
  if (fatIds.length !== fatCount || (difatCount && difatId !== END)) fail();
  const fat = new Uint32Array(sectors);
  if ((fatCount * sectorSize) / 4 < sectors) fail();
  fatIds.forEach((id, i) => {
    const data = sector(id);
    for (
      let o = 0;
      o < sectorSize / 4 && (i * sectorSize) / 4 + o < sectors;
      o++
    )
      fat[(i * sectorSize) / 4 + o] = word(data, o * 4);
  });
  const readChain = (start: number, length?: number): Uint8Array => {
    const chunks: Uint8Array[] = [];
    let id = start,
      size = 0;
    while (id !== END) {
      claim(id);
      const chunk = sector(id);
      chunks.push(chunk);
      size += chunk.length;
      if (
        size > MAX_FILE ||
        (length !== undefined &&
          size > Math.ceil(length / sectorSize) * sectorSize)
      )
        fail();
      id = fat[id]!;
    }
    if (length !== undefined && (size < length || size >= length + sectorSize))
      fail();
    const result = new Uint8Array(length ?? size);
    chunks.forEach((chunk, i) =>
      result.set(
        chunk.subarray(
          0,
          Math.max(0, Math.min(chunk.length, result.length - i * sectorSize)),
        ),
        i * sectorSize,
      ),
    );
    return result;
  };
  const directory = readChain(u32(48));
  if (!directory.length || directory.length / 128 > 10000) fail();
  const dv = new DataView(directory.buffer),
    entries = directory.length / 128;
  const sizeAt = (o: number) => {
    const value = dv.getBigUint64(o + 120, true);
    if (value > BigInt(MAX_STREAM)) fail("HWP 스트림 크기 제한을 넘었습니다.");
    return Number(value);
  };
  if (directory[66] !== 5) fail();
  const miniRoot = readChain(dv.getUint32(116, true), sizeAt(0));
  const miniFatCount = u32(64);
  if (miniFatCount > sectors) fail();
  const miniFatBytes = readChain(u32(60), miniFatCount * sectorSize);
  const miniClaims = new Set<number>();
  const miniStream = (start: number, length: number) => {
    let id = start,
      offset = 0;
    const out = new Uint8Array(length);
    while (id !== END) {
      if (
        miniClaims.has(id) ||
        id * 64 >= miniRoot.length ||
        id * 4 + 4 > miniFatBytes.length ||
        offset >= length
      )
        fail();
      miniClaims.add(id);
      const n = Math.min(64, length - offset);
      if (id * 64 + n > miniRoot.length) fail();
      out.set(miniRoot.subarray(id * 64, id * 64 + n), offset);
      offset += n;
      id = word(miniFatBytes, id * 4);
    }
    if (offset !== length) fail();
    return out;
  };
  const streams = new Map<string, Uint8Array>(),
    seen = new Set<number>([0]);
  const pending = [{ id: dv.getUint32(76, true), parent: "", depth: 0 }];
  let total = 0;
  while (pending.length) {
    const item = pending.pop()!;
    if (item.id === FREE) continue;
    if (item.id >= entries || seen.has(item.id) || item.depth > 64) fail();
    seen.add(item.id);
    const o = item.id * 128,
      kind = directory[o + 66],
      nameLength = dv.getUint16(o + 64, true);
    if (
      ![1, 2].includes(kind!) ||
      nameLength < 2 ||
      nameLength > 64 ||
      nameLength % 2 ||
      dv.getUint16(o + nameLength - 2, true)
    )
      fail();
    const name = new TextDecoder("utf-16le", { fatal: true }).decode(
      directory.subarray(o, o + nameLength - 2),
    );
    if (!name || /[/\\\0]/.test(name)) fail();
    const path = item.parent + name;
    for (const sibling of [68, 72])
      pending.push({ ...item, id: dv.getUint32(o + sibling, true) });
    if (kind === 1)
      pending.push({
        id: dv.getUint32(o + 76, true),
        parent: path + "/",
        depth: item.depth + 1,
      });
    else {
      const length = sizeAt(o);
      total += length;
      if (total > 128 * 1024 * 1024 || streams.has(path.toLowerCase())) fail();
      const start = dv.getUint32(o + 116, true);
      streams.set(
        path.toLowerCase(),
        length < 4096 ? miniStream(start, length) : readChain(start, length),
      );
    }
  }
  const header = streams.get("fileheader"),
    info = streams.get("docinfo");
  if (
    !header ||
    header.length !== 256 ||
    !info ||
    !streams.has("bodytext/section0")
  )
    fail("HWP 필수 스트림을 확인하지 못했습니다.");
  if (
    new TextDecoder().decode(header!.subarray(0, 17)) !== "HWP Document File" ||
    header![35] !== 5
  )
    fail("지원하는 HWP 5.x 문서가 아닙니다.");
  const flags = word(header!, 36);
  if (flags & (2 | 4 | 16 | 128 | 256 | 512 | 1024))
    fail("암호·배포 제한·DRM·전자서명 HWP 문서는 편집할 수 없습니다.");
  let expanded = 0;
  for (const [name, data] of streams) {
    // Binary resources may select compression independently of the file's default.
    const required =
      Boolean(flags & 1) &&
      (name === "docinfo" || /^bodytext\/section\d+$/.test(name));
    if (
      [
        "fileheader",
        "prvtext",
        "prvimage",
        "\u0005hwpsummaryinformation",
      ].includes(name)
    )
      continue;
    let produced = 0,
      limitExceeded = false;
    const inflate = new Inflate((chunk) => {
      produced += chunk.length;
      expanded += chunk.length;
      if (produced > MAX_STREAM || expanded > 128 * 1024 * 1024) {
        limitExceeded = true;
        fail("HWP 실제 압축 해제 크기 제한을 넘었습니다.");
      }
    });
    try {
      for (let o = 0; o < data.length; o += 512)
        inflate.push(data.subarray(o, o + 512), o + 512 >= data.length);
    } catch (error) {
      if (required || limitExceeded) throw error;
    }
  }
}
