/**
 * Pure-TypeScript MP4 faststart — relocates the `moov` atom before `mdat`
 * so browsers can start playing immediately with HTTP range requests.
 *
 * If the moov is already before mdat (or the file isn't MP4), the input is
 * returned unchanged.
 *
 * Algorithm (same as qt-faststart / ffmpeg -movflags +faststart):
 *  1. Parse top-level atoms to find ftyp, moov, and mdat positions.
 *  2. If moov is already before mdat, return as-is.
 *  3. Extract the moov atom.
 *  4. Walk moov recursively to find stco (32-bit) and co64 (64-bit) chunk
 *     offset tables. Add moov.byteLength to every offset (data shifts right).
 *  5. Reassemble: [everything before mdat] + [adjusted moov] + [mdat onwards].
 */

/** Read a big-endian uint32 from a buffer at the given offset. */
function readU32(buf: Uint8Array, off: number): number {
  return (
    ((buf[off] << 24) |
      (buf[off + 1] << 16) |
      (buf[off + 2] << 8) |
      buf[off + 3]) >>>
    0
  );
}

/** Read a big-endian uint64 from a DataView. JS numbers lose precision above 2^53. */
function readU64(view: DataView, off: number): number {
  const hi = view.getUint32(off);
  const lo = view.getUint32(off + 4);
  return hi * 0x100000000 + lo;
}

/** Write a big-endian uint64 into a DataView. */
function writeU64(view: DataView, off: number, val: number): void {
  view.setUint32(off, Math.floor(val / 0x100000000));
  view.setUint32(off + 4, val >>> 0);
}

/** Read a 4-byte ASCII type at the given offset. */
function readType(buf: Uint8Array, off: number): string {
  return String.fromCharCode(
    buf[off],
    buf[off + 1],
    buf[off + 2],
    buf[off + 3],
  );
}

interface AtomInfo {
  type: string;
  offset: number;
  size: number;
  headerSize: number;
}

/**
 * Parse top-level atoms from an MP4 buffer.
 * Each atom: [4-byte size][4-byte type][payload].
 * If size == 1, the real size is in the next 8 bytes (extended size).
 * If size == 0, the atom extends to EOF.
 */
function parseTopLevelAtoms(buf: Uint8Array): AtomInfo[] {
  const atoms: AtomInfo[] = [];
  let pos = 0;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  while (pos < buf.byteLength - 8) {
    let size = readU32(buf, pos);
    const type = readType(buf, pos + 4);
    let headerSize = 8;

    if (size === 1) {
      if (pos + 16 > buf.byteLength) break;
      size = readU64(view, pos + 8);
      headerSize = 16;
    } else if (size === 0) {
      size = buf.byteLength - pos;
    }

    if (size < headerSize || pos + size > buf.byteLength) break;
    atoms.push({ type, offset: pos, size, headerSize });
    pos += size;
  }

  return atoms;
}

/**
 * Walk a container atom recursively and adjust chunk offsets in stco/co64
 * boxes by `delta` bytes.
 */
function adjustOffsets(moov: Uint8Array, delta: number): void {
  const view = new DataView(moov.buffer, moov.byteOffset, moov.byteLength);
  walkContainer(moov, view, 0, moov.byteLength, delta);
}

function walkContainer(
  buf: Uint8Array,
  view: DataView,
  start: number,
  end: number,
  delta: number,
): void {
  let pos = start;
  while (pos < end - 8) {
    let size = readU32(buf, pos);
    const type = readType(buf, pos + 4);
    let headerSize = 8;

    if (size === 1) {
      if (pos + 16 > end) break;
      size = readU64(view, pos + 8);
      headerSize = 16;
    } else if (size === 0) {
      size = end - pos;
    }
    if (size < headerSize || pos + size > end) break;

    if (type === "stco") {
      // stco: [version:1][flags:3][entry_count:4][offset:4 * count]
      const payloadStart = pos + headerSize;
      const count = view.getUint32(payloadStart + 4);
      for (let i = 0; i < count; i++) {
        const off = payloadStart + 8 + i * 4;
        const old = view.getUint32(off);
        view.setUint32(off, old + delta);
      }
    } else if (type === "co64") {
      // co64: [version:1][flags:3][entry_count:4][offset:8 * count]
      const payloadStart = pos + headerSize;
      const count = view.getUint32(payloadStart + 4);
      for (let i = 0; i < count; i++) {
        const off = payloadStart + 8 + i * 8;
        const old = readU64(view, off);
        writeU64(view, off, old + delta);
      }
    } else if (isContainer(type)) {
      walkContainer(buf, view, pos + headerSize, pos + size, delta);
    }

    pos += size;
  }
}

const CONTAINER_TYPES = new Set([
  "moov",
  "trak",
  "mdia",
  "minf",
  "stbl",
  "edts",
  "dinf",
  "mvex",
  "tref",
  "udta",
  "meta",
  "sinf",
  "schi",
  "hnti",
  "hinf",
]);

function isContainer(type: string): boolean {
  return CONTAINER_TYPES.has(type);
}

/**
 * Apply faststart to an MP4 buffer: move moov before mdat.
 * Returns the original buffer if already faststarted or not MP4.
 */
export function applyFaststart(data: Uint8Array): Uint8Array {
  if (data.byteLength < 8) return data;

  // Quick sanity check — MP4 files start with ftyp.
  const firstType = readType(data, 4);
  if (firstType !== "ftyp") return data;

  const atoms = parseTopLevelAtoms(data);
  const moovAtom = atoms.find((a) => a.type === "moov");
  const mdatAtom = atoms.find((a) => a.type === "mdat");

  if (!moovAtom || !mdatAtom) return data;
  if (moovAtom.offset < mdatAtom.offset) return data;

  // moov is after mdat — needs relocation.
  const moovBytes = new Uint8Array(moovAtom.size);
  moovBytes.set(
    data.subarray(moovAtom.offset, moovAtom.offset + moovAtom.size),
  );

  // Adjust chunk offsets: moov is moving to just before mdat, so all data
  // chunks shift right by moov.size bytes.
  adjustOffsets(moovBytes.subarray(moovAtom.headerSize), moovAtom.size);

  // Reassemble: [everything before mdat] + [adjusted moov] + [mdat to end, excluding original moov]
  const beforeMdat = data.subarray(0, mdatAtom.offset);
  // Everything from mdat to moov start (moov is after mdat, so this includes mdat).
  const mdatToMoov = data.subarray(mdatAtom.offset, moovAtom.offset);
  // Everything after moov (if any trailing atoms).
  const afterMoov = data.subarray(moovAtom.offset + moovAtom.size);

  const result = new Uint8Array(data.byteLength);
  let pos = 0;
  result.set(beforeMdat, pos);
  pos += beforeMdat.byteLength;
  result.set(moovBytes, pos);
  pos += moovBytes.byteLength;
  result.set(mdatToMoov, pos);
  pos += mdatToMoov.byteLength;
  result.set(afterMoov, pos);

  return result;
}
