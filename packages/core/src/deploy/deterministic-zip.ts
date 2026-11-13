// Fixed DOS date 1980-01-01 00:00:00, the epoch zip-it already stamps.
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;
const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;
const ZIP64_SENTINEL = 0xffffffff;
const UTF8_FLAG = 0x0800;

interface ZipEntry {
  name: Buffer;
  method: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  externalAttrs: number;
  versionMadeBy: number;
  flags: number;
  data: Buffer;
}

function findEndOfCentralDirectory(zip: Buffer): number {
  const min = Math.max(0, zip.length - 22 - 0xffff);
  for (let i = zip.length - 22; i >= min; i--) {
    if (zip.readUInt32LE(i) === EOCD_SIG) return i;
  }
  throw new Error("not a zip: end of central directory record not found");
}

function readEntries(zip: Buffer): ZipEntry[] {
  const eocd = findEndOfCentralDirectory(zip);
  const count = zip.readUInt16LE(eocd + 10);
  const centralOffset = zip.readUInt32LE(eocd + 16);
  if (count === 0xffff || centralOffset === ZIP64_SENTINEL) {
    throw new Error("zip64 archives are not supported");
  }
  const entries: ZipEntry[] = [];
  let pos = centralOffset;
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(pos) !== CEN_SIG) {
      throw new Error("corrupt zip: bad central directory signature");
    }
    const versionMadeBy = zip.readUInt16LE(pos + 4);
    const flags = zip.readUInt16LE(pos + 8);
    const method = zip.readUInt16LE(pos + 10);
    const crc = zip.readUInt32LE(pos + 16);
    const compressedSize = zip.readUInt32LE(pos + 20);
    const uncompressedSize = zip.readUInt32LE(pos + 24);
    const nameLen = zip.readUInt16LE(pos + 28);
    const extraLen = zip.readUInt16LE(pos + 30);
    const commentLen = zip.readUInt16LE(pos + 32);
    const externalAttrs = zip.readUInt32LE(pos + 38);
    const localOffset = zip.readUInt32LE(pos + 42);
    if (
      compressedSize === ZIP64_SENTINEL ||
      uncompressedSize === ZIP64_SENTINEL
    ) {
      throw new Error("zip64 entries are not supported");
    }
    const name = Buffer.from(zip.subarray(pos + 46, pos + 46 + nameLen));
    if (zip.readUInt32LE(localOffset) !== LOC_SIG) {
      throw new Error("corrupt zip: bad local header signature");
    }
    const localNameLen = zip.readUInt16LE(localOffset + 26);
    const localExtraLen = zip.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    entries.push({
      name,
      method,
      crc,
      compressedSize,
      uncompressedSize,
      externalAttrs,
      versionMadeBy,
      flags,
      data: zip.subarray(dataStart, dataStart + compressedSize),
    });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/**
 * Rewrites a zip so identical entries always yield identical bytes: entries
 * sorted by name, one fixed timestamp, no extra fields or data descriptors.
 * The compressed payloads are copied verbatim, so file contents and unix
 * permissions are untouched.
 */
export function normalizeZip(zip: Buffer): Buffer {
  const entries = readEntries(zip).sort((a, b) =>
    Buffer.compare(a.name, b.name),
  );
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const flags = entry.flags & UTF8_FLAG;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOC_SIG, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(entry.method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(entry.crc, 14);
    local.writeUInt32LE(entry.compressedSize, 18);
    local.writeUInt32LE(entry.uncompressedSize, 22);
    local.writeUInt16LE(entry.name.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, entry.name, entry.data);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(CEN_SIG, 0);
    cen.writeUInt16LE(entry.versionMadeBy, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(flags, 8);
    cen.writeUInt16LE(entry.method, 10);
    cen.writeUInt16LE(DOS_TIME, 12);
    cen.writeUInt16LE(DOS_DATE, 14);
    cen.writeUInt32LE(entry.crc, 16);
    cen.writeUInt32LE(entry.compressedSize, 20);
    cen.writeUInt32LE(entry.uncompressedSize, 24);
    cen.writeUInt16LE(entry.name.length, 28);
    cen.writeUInt32LE(entry.externalAttrs, 38);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, entry.name);
    offset += local.length + entry.name.length + entry.data.length;
  }
  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIG, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, centralBuf, eocd]);
}
