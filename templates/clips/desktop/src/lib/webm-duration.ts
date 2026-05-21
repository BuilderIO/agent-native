/**
 * Inject a correct `Duration` into a MediaRecorder-produced WebM.
 *
 * MediaRecorder writes a streamable WebM whose top-level `Segment` uses the
 * "unknown size" encoding and whose `Info` element omits the `Duration`
 * element entirely. Players then have to *estimate* length from cluster
 * timestamps, and a recorder driven with a `timeslice` consistently lands
 * short by up to one slice (the trailing partial cluster isn't counted) —
 * which is why the separate local-recording camera file comes out ~2s
 * shorter than the natively-muxed desktop MP4 it's paired with.
 *
 * This patches the finished file in place: it locates `Segment → Info`,
 * sets (or inserts) a `Duration` float computed from the wall-clock length
 * we recorded, fixes the `Info` size, and leaves every other byte — the
 * EBML header, Tracks, all Clusters, Cues — untouched.
 *
 * Hard safety contract: this is recording code. On *any* unexpected
 * structure the function returns the input bytes unchanged. The worst case
 * is the pre-existing (slightly-short) duration; we never emit a file that
 * is more broken than what MediaRecorder gave us.
 *
 * Pure `DataView`/`Uint8Array` — no Node `Buffer`, no dependencies — so it
 * runs as-is inside the Tauri webview.
 */

const ID_EBML = 0x1a45dfa3;
const ID_SEGMENT = 0x18538067;
const ID_INFO = 0x1549a966;
const ID_DURATION = 0x4489;
const ID_TIMECODE_SCALE = 0x2ad7b1;

const DEFAULT_TIMECODE_SCALE = 1_000_000; // ns per tick → 1ms ticks

interface Element {
  id: number;
  /** Offset of the element's first ID byte. */
  start: number;
  /** Raw bytes of the size vint. */
  sizeBytes: Uint8Array;
  /** Offset of the first data byte. */
  dataStart: number;
  /** Offset just past the element's data. */
  dataEnd: number;
  /** True when the size vint is the reserved "unknown size" pattern. */
  unknownSize: boolean;
}

/** Number of bytes a vint occupies, from its first byte (0 ⇒ invalid). */
function vintLength(firstByte: number): number {
  if (firstByte === 0) return 0;
  let mask = 0x80;
  for (let len = 1; len <= 8; len++) {
    if (firstByte & mask) return len;
    mask >>= 1;
  }
  return 0;
}

/** Read an element ID (kept *with* its length-marker bits) at `offset`. */
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

/** Read a size vint at `offset`. */
function readSize(
  buf: Uint8Array,
  offset: number,
): { value: number; length: number; unknown: boolean } | null {
  if (offset >= buf.length) return null;
  const length = vintLength(buf[offset]);
  if (length === 0 || offset + length > buf.length) return null;
  // Strip the length-marker bit from the first byte.
  let value = buf[offset] & (0xff >> length);
  let unknown = value === 0xff >> length;
  for (let i = 1; i < length; i++) {
    value = value * 256 + buf[offset + i];
    if (buf[offset + i] !== 0xff) unknown = false;
  }
  return { value, length, unknown };
}

/** Parse the direct child elements contained in `[start, end)`. */
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

/** Encode `value` as the shortest definite-length EBML size vint. */
function encodeVint(value: number): Uint8Array {
  for (let len = 1; len <= 8; len++) {
    const valueBits = 7 * len;
    // 2^valueBits - 1 is reserved (unknown size) — stay strictly below it.
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
  // Unreachable for any real recording length.
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

/**
 * Return a copy of `input` with a correct `Duration` written into
 * `Segment → Info`, or the original bytes unchanged if the file isn't a
 * MediaRecorder-shaped WebM we can safely patch.
 */
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

  // TimecodeScale is ns-per-tick; Duration is expressed in those ticks.
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

  // Rebuild Info's body: keep every child verbatim except Duration, which
  // we replace with a fresh 8-byte float (or append if it was missing).
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

  // Rebuild Segment's body with the patched Info spliced back in. The
  // Segment retains MediaRecorder's "unknown size" header verbatim, so we
  // never have to recompute (or overflow) a giant size field.
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

  // Reassemble the file: every root element verbatim, Segment replaced.
  const fileParts: Uint8Array[] = [];
  for (const el of root) {
    fileParts.push(
      el === segment ? newSegment : input.slice(el.start, el.dataEnd),
    );
  }
  return concat(fileParts);
}
