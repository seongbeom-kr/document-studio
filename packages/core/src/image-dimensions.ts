export interface ImageDimensions {
  width: number;
  height: number;
}
function checked(width: number, height: number): ImageDimensions {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width > 32768 ||
    height > 32768 ||
    width * height > 40_000_000
  )
    throw new Error(
      "그림은 한 변 32,768px, 전체 4,000만 화소 이하여야 합니다.",
    );
  return { width, height };
}
/** Read dimensions before handing compressed input to the browser's image decoder. */
export function imageDimensions(
  bytes: Uint8Array,
  mime: string,
): ImageDimensions {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    mime === "image/png" &&
    bytes.length >= 24 &&
    bytes[0] === 137 &&
    bytes[1] === 80 &&
    bytes[2] === 78 &&
    bytes[3] === 71 &&
    bytes[12] === 73 &&
    bytes[13] === 72 &&
    bytes[14] === 68 &&
    bytes[15] === 82
  )
    return checked(view.getUint32(16), view.getUint32(20));
  if (
    mime === "image/gif" &&
    bytes.length >= 13 &&
    bytes[0] === 71 &&
    bytes[1] === 73 &&
    bytes[2] === 70
  ) {
    const size = checked(view.getUint16(6, true), view.getUint16(8, true));
    let pos = 13 + (bytes[10]! & 128 ? 3 * (1 << ((bytes[10]! & 7) + 1)) : 0),
      pixels = 0;
    const skipBlocks = () => {
      while (pos < bytes.length) {
        const length = bytes[pos++]!;
        if (!length) return;
        pos += length;
        if (pos > bytes.length) break;
      }
      throw new Error("GIF 그림 데이터가 잘렸습니다.");
    };
    while (pos < bytes.length) {
      const marker = bytes[pos++];
      if (marker === 59) return size;
      if (marker === 33) {
        pos++;
        skipBlocks();
        continue;
      }
      if (marker !== 44 || pos + 9 > bytes.length) break;
      const frame = checked(
        view.getUint16(pos + 4, true),
        view.getUint16(pos + 6, true),
      );
      pixels += frame.width * frame.height;
      if (pixels > 40_000_000)
        throw new Error("GIF 전체 프레임은 4,000만 화소 이하여야 합니다.");
      const flags = bytes[pos + 8]!;
      pos += 9;
      if (flags & 128) pos += 3 * (1 << ((flags & 7) + 1));
      pos++;
      skipBlocks();
    }
  }
  if (
    mime === "image/jpeg" &&
    bytes.length >= 4 &&
    bytes[0] === 255 &&
    bytes[1] === 216
  ) {
    let pos = 2;
    while (pos + 4 <= bytes.length) {
      if (bytes[pos++] !== 255) break;
      while (bytes[pos] === 255) pos++;
      const marker = bytes[pos++];
      if (marker === 217 || marker === 218) break;
      if (
        marker === 1 ||
        (marker !== undefined && marker >= 208 && marker <= 215)
      )
        continue;
      if (pos + 2 > bytes.length) break;
      const length = view.getUint16(pos);
      if (length < 2 || pos + length > bytes.length) break;
      if (
        marker !== undefined &&
        [
          192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207,
        ].includes(marker) &&
        length >= 8
      )
        return checked(view.getUint16(pos + 5), view.getUint16(pos + 3));
      pos += length;
    }
  }
  throw new Error(
    "PNG·JPEG·GIF 그림의 크기 정보를 읽을 수 없습니다. 정상 그림 파일을 선택하세요.",
  );
}
export function fitImage(
  dimensions: ImageDimensions,
  availableWidthMm: number,
): { widthMm: number; heightMm: number } {
  checked(dimensions.width, dimensions.height);
  if (!Number.isFinite(availableWidthMm) || availableWidthMm < 1)
    throw new Error("그림을 넣을 본문 폭을 확인하세요.");
  const width = (dimensions.width * 25.4) / 96,
    height = (dimensions.height * 25.4) / 96;
  const maximum = Math.min(
    Math.max(1, availableWidthMm) / width,
    500 / width,
    500 / height,
  );
  const minimum = Math.max(1 / width, 1 / height);
  const scale = Math.min(maximum, Math.max(Math.min(1, maximum), minimum));
  return { widthMm: width * scale, heightMm: height * scale };
}
