// Local metadata inspection for PNGToolbox.
// Reads bytes from the files the user already selected; nothing is uploaded and
// no third-party parsing library is involved.

export type MetaField = { label: string; value: string };

export type ImageMeta = {
  format: "JPEG" | "PNG" | "WebP" | "Unknown";
  hasExif: boolean;
  hasGps: boolean;
  fields: MetaField[];
};

const META_PREFIX_BYTES = 512 * 1024;

function tagAt(bytes: Uint8Array, pos: number): string {
  return String.fromCharCode(bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]);
}

async function readPrefix(file: File, length: number): Promise<Uint8Array> {
  const buffer = await file.slice(0, Math.min(length, file.size)).arrayBuffer();
  return new Uint8Array(buffer);
}

function sniffFormat(bytes: Uint8Array): ImageMeta["format"] {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "JPEG";
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "PNG";
  if (bytes.length >= 12 && tagAt(bytes, 0) === "RIFF" && tagAt(bytes, 8) === "WEBP") return "WebP";
  return "Unknown";
}

// Locate the EXIF payload inside a JPEG APP1 segment; returns the offset of the
// TIFF header, or null when the file carries no EXIF.
function findJpegExif(bytes: Uint8Array): number | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
    if (marker === 0xda || marker === 0xd9) return null;
    const size = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (size < 2) return null;
    if (marker === 0xe1 && offset + 4 + 6 <= bytes.length && tagAt(bytes, offset + 4) === "Exif") {
      return offset + 10; // marker (2) + size (2) + "Exif\0\0" (6)
    }
    offset += 2 + size;
  }
  return null;
}

function parseExifTiff(bytes: Uint8Array, base: number): { fields: MetaField[]; hasGps: boolean } {
  const empty = { fields: [] as MetaField[], hasGps: false };
  if (base + 8 > bytes.length) return empty;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const little = view.getUint16(base) === 0x4949;
  if (!little && view.getUint16(base) !== 0x4d4d) return empty;
  const u16 = (pos: number): number => view.getUint16(pos, little);
  const u32 = (pos: number): number => view.getUint32(pos, little);
  if (u16(base + 2) !== 42) return empty;

  const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };
  const fields: MetaField[] = [];
  let hasGps = false;

  const ascii = (dataPos: number, count: number): string => {
    let out = "";
    for (let i = 0; i < count - 1 && dataPos + i < bytes.length; i += 1) {
      const code = bytes[dataPos + i];
      if (code === 0) break;
      out += String.fromCharCode(code);
    }
    return out.trim();
  };

  const walkIfd = (ifdPos: number, depth: number): void => {
    if (depth > 2 || ifdPos < 0 || ifdPos + 2 > bytes.length) return;
    const count = u16(ifdPos);
    if (count > 512) return; // sanity cap; real IFDs are far smaller
    for (let i = 0; i < count; i += 1) {
      const entryPos = ifdPos + 2 + i * 12;
      if (entryPos + 12 > bytes.length) return;
      const tag = u16(entryPos);
      const type = u16(entryPos + 2);
      const valueCount = u32(entryPos + 4);
      const byteCount = (TYPE_SIZE[type] ?? 1) * valueCount;
      const dataPos = byteCount <= 4 ? entryPos + 8 : base + u32(entryPos + 8);
      if (dataPos < 0 || dataPos >= bytes.length) continue;
      switch (tag) {
        case 0x010f: { const v = ascii(dataPos, valueCount); if (v) fields.push({ label: "Camera make", value: v }); break; }
        case 0x0110: { const v = ascii(dataPos, valueCount); if (v) fields.push({ label: "Camera model", value: v }); break; }
        case 0x0131: { const v = ascii(dataPos, valueCount); if (v) fields.push({ label: "Software", value: v }); break; }
        case 0x0132: { const v = ascii(dataPos, valueCount); if (v) fields.push({ label: "File modified", value: v }); break; }
        case 0x9003: { const v = ascii(dataPos, valueCount); if (v) fields.push({ label: "Date taken", value: v }); break; }
        case 0x8825: hasGps = true; break;
        case 0x8769: walkIfd(base + u32(entryPos + 8), depth + 1); break;
      }
    }
  };

  walkIfd(base + u32(base + 4), 0);
  return { fields, hasGps };
}

function pngHasExif(bytes: Uint8Array): boolean {
  let pos = 8; // skip PNG signature
  while (pos + 8 <= bytes.length) {
    const length = ((bytes[pos] << 24) | (bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3]) >>> 0;
    if (length === 0 || pos + 12 + length > bytes.length) return false;
    if (tagAt(bytes, pos + 4) === "eXIf") return true;
    if (tagAt(bytes, pos + 4) === "IDAT") return false; // eXIf precedes IDAT in practice
    pos += 12 + length;
  }
  return false;
}

function webpHasExif(bytes: Uint8Array): boolean {
  let pos = 12; // skip "RIFF" + size + "WEBP"
  while (pos + 8 <= bytes.length) {
    if (tagAt(bytes, pos) === "EXIF") return true;
    const size = (bytes[pos + 4] | (bytes[pos + 5] << 8) | (bytes[pos + 6] << 16) | (bytes[pos + 7] << 24)) >>> 0;
    pos += 8 + size + (size % 2); // chunks are word-aligned
  }
  return false;
}

export async function readImageMeta(file: File): Promise<ImageMeta> {
  const bytes = await readPrefix(file, META_PREFIX_BYTES);
  const format = sniffFormat(bytes);
  if (format === "JPEG") {
    const exifStart = findJpegExif(bytes);
    if (exifStart === null) return { format, hasExif: false, hasGps: false, fields: [] };
    const parsed = parseExifTiff(bytes, exifStart);
    return { format, hasExif: true, hasGps: parsed.hasGps, fields: parsed.fields };
  }
  if (format === "PNG") return { format, hasExif: pngHasExif(bytes), hasGps: false, fields: [] };
  if (format === "WebP") return { format, hasExif: webpHasExif(bytes), hasGps: false, fields: [] };
  return { format, hasExif: false, hasGps: false, fields: [] };
}
