
const ID_EBML = 0x1a45dfa3;
const ID_SEGMENT = 0x18538067;
const ID_INFO = 0x1549a966;
const ID_DURATION = 0x4489;
const ID_TIMECODE_SCALE = 0x2ad7b1;

const DEFAULT_TIMECODE_SCALE = 1_000_000;

interface Element {
  id: number;
  start: number;
  sizeBytes: Uint8Array;
  dataStart: number;
  dataEnd: number;
  unknownSize: boolean;
}

function vintLength(firstByte: number): number {
  if (firstByte === 0) return 0;
  let mask = 0x80;
  for (let len = 1; len <= 8; len++) {
    if (firstByte & mask) return len;
    mask >>= 1;
  }
  return 0;
}

function readId(
  buf: Uint8Array,
  offset: number,
): { id: number; length: number } | null {
  if (offset >= buf.length) return null;
  const length = vintLength(buf[offset]);
  if (length === 0 || offset + length > buf.length) return null;
  let id = 0;
  for (let i = 0; i < length; i++) id = id * 256 + buf[offset + i];
  return { id, length };
}

function readSize(
  buf: Uint8Array,
  offset: number,
): { value: number; length: number; unknown: boolean } | null {
  if (offset >= buf.length) return null;
  const length = vintLength(buf[offset]);
  if (length === 0 || offset + length > buf.length) return null;
  let value = buf[offset] & (0xff >> length);
  let unknown = value === 0xff >> length;
  for (let i = 1; i < length; i++) {
    value = value * 256 + buf[offset + i];
    if (buf[offset + i] !== 0xff) unknown = false;
  }
  return { value, length, unknown };
}

function parseChildren(
  buf: Uint8Array,
  start: number,
  end: number,
): Element[] | null {
  const out: Element[] = [];
  let offset = start;
  while (offset < end) {
    const idRes = readId(buf, offset);
    if (!idRes) return null;
    const sizeRes = readSize(buf, offset + idRes.length);
    if (!sizeRes) return null;
    const dataStart = offset + idRes.length + sizeRes.length;
    const dataEnd = sizeRes.unknown ? end : dataStart + sizeRes.value;
    if (dataEnd > end || dataEnd < dataStart) return null;
    out.push({
      id: idRes.id,
      start: offset,
      sizeBytes: buf.slice(offset + idRes.length, dataStart),
      dataStart,
      dataEnd,
      unknownSize: sizeRes.unknown,
    });
    offset = dataEnd;
  }
  return out;
}

function encodeVint(value: number): Uint8Array {
  for (let len = 1; len <= 8; len++) {
    const valueBits = 7 * len;
    const max = Math.pow(2, valueBits) - 1;
    if (value < max) {
      const out = new Uint8Array(len);
      let v = value;
      for (let i = len - 1; i >= 0; i--) {
        out[i] = v & 0xff;
        v = Math.floor(v / 256);
      }
      out[0] |= 1 << (8 - len);
      return out;
    }
  }
  return new Uint8Array([0x01, 0, 0, 0, 0, 0, 0, 0]);
}

function float64BE(value: number): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setFloat64(0, value, false);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

export function injectWebmDuration(
  input: Uint8Array,
  durationMs: number,
): Uint8Array {
  if (!(durationMs > 0)) return input;

  const root = parseChildren(input, 0, input.length);
  if (!root || root.length < 2) return input;
  if (root[0].id !== ID_EBML) return input;

  const segment = root.find((el) => el.id === ID_SEGMENT);
  if (!segment) return input;

  const segChildren = parseChildren(input, segment.dataStart, segment.dataEnd);
  if (!segChildren) return input;

  const infoIdx = segChildren.findIndex((el) => el.id === ID_INFO);
  if (infoIdx === -1) return input;
  const info = segChildren[infoIdx];

  const infoChildren = parseChildren(input, info.dataStart, info.dataEnd);
  if (!infoChildren) return input;

  let timecodeScale = DEFAULT_TIMECODE_SCALE;
  const scaleEl = infoChildren.find((el) => el.id === ID_TIMECODE_SCALE);
  if (scaleEl) {
    let scale = 0;
    for (let i = scaleEl.dataStart; i < scaleEl.dataEnd; i++) {
      scale = scale * 256 + input[i];
    }
    if (scale > 0) timecodeScale = scale;
  }
  const durationTicks = (durationMs * 1_000_000) / timecodeScale;

  const durationEl = concat([
    new Uint8Array([0x44, 0x89]), // Duration ID
    encodeVint(8),
    float64BE(durationTicks),
  ]);
  const newInfoParts: Uint8Array[] = [];
  for (const child of infoChildren) {
    if (child.id === ID_DURATION) continue;
    newInfoParts.push(input.slice(child.start, child.dataEnd));
  }
  newInfoParts.push(durationEl);
  const newInfoBody = concat(newInfoParts);
  const newInfo = concat([
    new Uint8Array([0x15, 0x49, 0xa9, 0x66]), // Info ID
    encodeVint(newInfoBody.byteLength),
    newInfoBody,
  ]);

  const segParts: Uint8Array[] = [];
  for (let i = 0; i < segChildren.length; i++) {
    const child = segChildren[i];
    segParts.push(
      i === infoIdx ? newInfo : input.slice(child.start, child.dataEnd),
    );
  }
  const newSegmentBody = concat(segParts);
  const segIdLen = vintLength(input[segment.start]);
  const newSegment = concat([
    input.slice(segment.start, segment.start + segIdLen),
    segment.sizeBytes,
    newSegmentBody,
  ]);

  const fileParts: Uint8Array[] = [];
  for (const el of root) {
    fileParts.push(
      el === segment ? newSegment : input.slice(el.start, el.dataEnd),
    );
  }
  return concat(fileParts);
}
