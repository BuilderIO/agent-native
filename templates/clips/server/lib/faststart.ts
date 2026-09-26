
function readU32(buf: Uint8Array, off: number): number {
  return (
    ((buf[off] << 24) |
      (buf[off + 1] << 16) |
      (buf[off + 2] << 8) |
      buf[off + 3]) >>>
    0
  );
}

function readU64(view: DataView, off: number): number {
  const hi = view.getUint32(off);
  const lo = view.getUint32(off + 4);
  return hi * 0x100000000 + lo;
}

function writeU64(view: DataView, off: number, val: number): void {
  view.setUint32(off, Math.floor(val / 0x100000000));
  view.setUint32(off + 4, val >>> 0);
}

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

function parseTopLevelAtoms(buf: Uint8Array): AtomInfo[] {
  const atoms: AtomInfo[] = [];
  let pos = 0;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  while (pos <= buf.byteLength - 8) {
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
  while (pos <= end - 8) {
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
      const payloadStart = pos + headerSize;
      const count = view.getUint32(payloadStart + 4);
      for (let i = 0; i < count; i++) {
        const off = payloadStart + 8 + i * 4;
        const old = view.getUint32(off);
        view.setUint32(off, old + delta);
      }
    } else if (type === "co64") {
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

export function applyFaststart(data: Uint8Array): Uint8Array {
  if (data.byteLength < 8) return data;

  const firstType = readType(data, 4);
  if (firstType !== "ftyp") return data;

  const atoms = parseTopLevelAtoms(data);
  const moovAtom = atoms.find((a) => a.type === "moov");
  const mdatAtom = atoms.find((a) => a.type === "mdat");

  if (!moovAtom || !mdatAtom) return data;
  if (moovAtom.offset < mdatAtom.offset) return data;

  const moovBytes = new Uint8Array(moovAtom.size);
  moovBytes.set(
    data.subarray(moovAtom.offset, moovAtom.offset + moovAtom.size),
  );

  adjustOffsets(moovBytes.subarray(moovAtom.headerSize), moovAtom.size);

  const beforeMdat = data.subarray(0, mdatAtom.offset);
  const mdatToMoov = data.subarray(mdatAtom.offset, moovAtom.offset);
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

export function hasPlayableMp4Metadata(data: Uint8Array): boolean {
  if (data.byteLength < 8) return false;
  if (readType(data, 4) !== "ftyp") return false;
  return parseTopLevelAtoms(data).some((atom) => atom.type === "moov");
}
