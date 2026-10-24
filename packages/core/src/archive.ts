import { Inflate } from "fflate";
import { validateHwpDocument } from "./hwp";
import type { DocumentFormat } from "./index";
export const ARCHIVE_LIMITS = Object.freeze({
  compressedBytes: 32 * 1024 * 1024,
  expandedBytes: 128 * 1024 * 1024,
  entryBytes: 64 * 1024 * 1024,
  entries: 10000,
});
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  let crc = n;
  for (let bit = 0; bit < 8; bit++)
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
/** Bounded streaming extraction, CRC and directory validation. Never retains inflated entries. */
export function validateDocumentArchive(
  bytes: Uint8Array,
  format: DocumentFormat,
): void {
  if (format === "hwp") return validateHwpDocument(bytes);
  const fail = () => {
    throw new Error(
      "문서 ZIP 구조 또는 실제 압축 해제 크기가 허용 범위를 벗어났습니다.",
    );
  };
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.length < 22 ||
    bytes.length > ARCHIVE_LIMITS.compressedBytes ||
    !["docx", "hwpx"].includes(format)
  )
    fail();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    u16 = (o: number) => view.getUint16(o, true),
    u32 = (o: number) => view.getUint32(o, true);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--)
    if (u32(i) === 0x06054b50 && i + 22 + u16(i + 20) === bytes.length) {
      end = i;
      break;
    }
  if (end < 0) fail();
  const count = u16(end + 10),
    size = u32(end + 12),
    start = u32(end + 16);
  if (
    u16(end + 4) ||
    u16(end + 6) ||
    u16(end + 8) !== count ||
    !count ||
    count > ARCHIVE_LIMITS.entries ||
    start + size !== end
  )
    fail();
  const names = new Set<string>(),
    decoder = new TextDecoder("utf-8", { fatal: true }),
    ranges: { start: number; end: number }[] = [];
  let offset = start,
    declaredTotal = 0,
    actualTotal = 0;
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || u32(offset) !== 0x02014b50) fail();
    const flags = u16(offset + 8),
      method = u16(offset + 10),
      checksum = u32(offset + 16),
      compressed = u32(offset + 20),
      length = u32(offset + 24),
      nameLength = u16(offset + 28),
      extra = u16(offset + 30),
      comment = u16(offset + 32),
      local = u32(offset + 42),
      next = offset + 46 + nameLength + extra + comment;
    if (
      next > end ||
      !nameLength ||
      flags & 1 ||
      ![0, 8].includes(method) ||
      length > ARCHIVE_LIMITS.entryBytes ||
      local + 30 > start ||
      u32(local) !== 0x04034b50
    )
      fail();
    let name: string;
    try {
      name = decoder.decode(
        bytes.subarray(offset + 46, offset + 46 + nameLength),
      );
    } catch {
      return fail();
    }
    if (
      name.includes("\\") ||
      name.startsWith("/") ||
      name.includes("\0") ||
      name.split("/").some((part) => part === ".." || part === ".") ||
      names.has(name)
    )
      fail();
    const localName = u16(local + 26),
      data = local + 30 + localName + u16(local + 28);
    if (
      data + compressed > start ||
      u16(local + 6) !== flags ||
      u16(local + 8) !== method ||
      localName !== nameLength ||
      !bytes
        .subarray(local + 30, local + 30 + localName)
        .every((v, n) => v === bytes[offset + 46 + n])
    )
      fail();
    let rangeEnd = data + compressed;
    if (flags & 8) {
      // Streaming ZIPs may leave local sizes zero; the descriptor must match the directory.
      for (const [at, expected] of [
        [14, checksum],
        [18, compressed],
        [22, length],
      ])
        if (u32(local + at!) !== 0 && u32(local + at!) !== expected) fail();
      let descriptor = rangeEnd;
      if (descriptor + 4 <= start && u32(descriptor) === 0x08074b50)
        descriptor += 4;
      if (
        descriptor + 12 > start ||
        u32(descriptor) !== checksum ||
        u32(descriptor + 4) !== compressed ||
        u32(descriptor + 8) !== length
      )
        fail();
      rangeEnd = descriptor + 12;
    } else if (
      u32(local + 14) !== checksum ||
      u32(local + 18) !== compressed ||
      u32(local + 22) !== length
    )
      fail();
    if (/vbaProject\.bin$/i.test(name))
      throw new Error("매크로 문서는 지원하지 않습니다.");
    names.add(name);
    ranges.push({ start: local, end: rangeEnd });
    declaredTotal += length;
    if (declaredTotal > ARCHIVE_LIMITS.expandedBytes) fail();
    let actual = 0,
      crc = 0xffffffff;
    const consume = (chunk: Uint8Array) => {
      actual += chunk.length;
      actualTotal += chunk.length;
      if (
        actual > length ||
        actual > ARCHIVE_LIMITS.entryBytes ||
        actualTotal > ARCHIVE_LIMITS.expandedBytes
      )
        fail();
      for (const value of chunk)
        crc = crcTable[(crc ^ value) & 255]! ^ (crc >>> 8);
    };
    if (method === 0) {
      if (compressed !== length) fail();
      consume(bytes.subarray(data, data + compressed));
    } else {
      // A 1 KiB compressed push bounds each temporary output allocation (~1 MiB maximum).
      const inflater = new Inflate((chunk) => consume(chunk));
      for (let at = 0; at < compressed; at += 1024)
        inflater.push(
          bytes.subarray(data + at, data + Math.min(compressed, at + 1024)),
          at + 1024 >= compressed,
        );
      if (!compressed) fail();
    }
    if (actual !== length || (crc ^ 0xffffffff) >>> 0 !== checksum) fail();
    offset = next;
  }
  if (offset !== end) fail();
  ranges.sort((a, b) => a.start - b.start);
  for (let i = 1; i < ranges.length; i++)
    if (ranges[i]!.start < ranges[i - 1]!.end) fail();
  const required =
    format === "docx"
      ? ["[Content_Types].xml", "word/document.xml"]
      : ["Contents/header.xml", "Contents/section0.xml"];
  if (!required.every((name) => names.has(name)))
    throw new Error("문서 형식과 ZIP 내용이 일치하지 않습니다.");
}
