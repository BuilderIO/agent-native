import { describe, expect, it } from "vitest";

import { injectWebmDuration } from "./webm-duration";

function concat(...chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/** Shortest definite-length EBML size vint (mirrors the module's encoder). */
function encodeSize(value: number): Uint8Array {
  for (let len = 1; len <= 8; len++) {
    const max = Math.pow(2, 7 * len) - 1;
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
  throw new Error("size too large for test fixture");
}

function el(
  idBytes: number[],
  data: Uint8Array,
  opts: { unknownSize?: boolean } = {},
): Uint8Array {
  const size = opts.unknownSize
    ? new Uint8Array([0xff]) // 1-byte "unknown size"
    : encodeSize(data.byteLength);
  return concat(new Uint8Array(idBytes), size, data);
}

const EBML_ID = [0x1a, 0x45, 0xdf, 0xa3];
const SEGMENT_ID = [0x18, 0x53, 0x80, 0x67];
const INFO_ID = [0x15, 0x49, 0xa9, 0x66];
const TIMECODE_SCALE_ID = [0x2a, 0xd7, 0xb1];
const DURATION_ID = [0x44, 0x89];
const CLUSTER_ID = [0x1f, 0x43, 0xb6, 0x75];

/** Big-endian minimal-length unsigned int bytes. */
function uintBytes(n: number): Uint8Array {
  const bytes: number[] = [];
  let v = n;
  do {
    bytes.unshift(v & 0xff);
    v = Math.floor(v / 256);
  } while (v > 0);
  return new Uint8Array(bytes);
}

function timecodeScaleEl(scale: number): Uint8Array {
  return el(TIMECODE_SCALE_ID, uintBytes(scale));
}

const CLUSTER = el(CLUSTER_ID, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));

/** Walk the patched file and pull the Duration float out of Info. */
function readDuration(buf: Uint8Array): number {
  // EBML header is element 0; Segment is element 1 (unknown size → rest).
  const ebmlLen = buf[5] & 0x7f; // 1-byte size for our fixture header
  let offset = 4 /*ebml id*/ + 1 /*size*/ + ebmlLen;
  // Segment: 4-byte id + 1-byte unknown size, children follow.
  offset += 4 + 1;
  // First Segment child is Info (4-byte id).
  offset += 4;
  const infoSizeFirst = buf[offset];
  const infoSizeLen = infoSizeFirst & 0x80 ? 1 : infoSizeFirst & 0x40 ? 2 : 3;
  let infoSize = infoSizeFirst & (0xff >> infoSizeLen);
  for (let i = 1; i < infoSizeLen; i++)
    infoSize = infoSize * 256 + buf[offset + i];
  let p = offset + infoSizeLen;
  const infoEnd = p + infoSize;
  while (p < infoEnd) {
    const id = (buf[p] << 8) | buf[p + 1];
    if (id === 0x4489) {
      const dv = new DataView(buf.buffer, buf.byteOffset + p + 3, 8);
      return dv.getFloat64(0, false);
    }
    // Skip: 2-byte id (Duration/TimecodeScale share this nibble in fixture)
    // — fall back to a generic single-byte-size skip.
    const idLen = buf[p] & 0x80 ? 1 : buf[p] & 0x40 ? 2 : buf[p] & 0x20 ? 3 : 4;
    const szFirst = buf[p + idLen];
    const szLen = szFirst & 0x80 ? 1 : szFirst & 0x40 ? 2 : 3;
    let sz = szFirst & (0xff >> szLen);
    for (let i = 1; i < szLen; i++) sz = sz * 256 + buf[p + idLen + i];
    p += idLen + szLen + sz;
  }
  throw new Error("Duration not found in patched Info");
}

describe("injectWebmDuration", () => {
  it("inserts Duration when missing and preserves trailing clusters", () => {
    const info = el(INFO_ID, timecodeScaleEl(1_000_000));
    const segment = el(SEGMENT_ID, concat(info, CLUSTER), {
      unknownSize: true,
    });
    const file = concat(el(EBML_ID, new Uint8Array([0x01])), segment);

    const out = injectWebmDuration(file, 12_345);

    expect(out).not.toBe(file);
    expect(readDuration(out)).toBeCloseTo(12_345, 3);
    // The cluster (and its bytes) must survive verbatim at the tail.
    const tail = out.slice(out.length - CLUSTER.length);
    expect([...tail]).toEqual([...CLUSTER]);
  });

  it("overwrites an existing wrong Duration", () => {
    const wrongDuration = el(
      DURATION_ID,
      new Uint8Array([0x40, 0x59, 0, 0, 0, 0, 0, 0]), // float64 ~100
    );
    const info = el(INFO_ID, concat(timecodeScaleEl(1_000_000), wrongDuration));
    const segment = el(SEGMENT_ID, concat(info, CLUSTER), {
      unknownSize: true,
    });
    const file = concat(el(EBML_ID, new Uint8Array([0x01])), segment);

    const out = injectWebmDuration(file, 60_000);
    expect(readDuration(out)).toBeCloseTo(60_000, 3);
  });

  it("honors a non-default TimecodeScale", () => {
    // 500_000 ns ticks → Duration is expressed in 0.5ms units.
    const info = el(INFO_ID, timecodeScaleEl(500_000));
    const segment = el(SEGMENT_ID, concat(info, CLUSTER), {
      unknownSize: true,
    });
    const file = concat(el(EBML_ID, new Uint8Array([0x01])), segment);

    const out = injectWebmDuration(file, 10_000);
    // 10_000ms * 1e6 / 500_000 = 20_000 ticks
    expect(readDuration(out)).toBeCloseTo(20_000, 3);
  });

  it("returns input unchanged for non-WebM bytes", () => {
    const garbage = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(injectWebmDuration(garbage, 5_000)).toBe(garbage);
  });

  it("returns input unchanged for a non-positive duration", () => {
    const info = el(INFO_ID, timecodeScaleEl(1_000_000));
    const segment = el(SEGMENT_ID, info, { unknownSize: true });
    const file = concat(el(EBML_ID, new Uint8Array([0x01])), segment);
    expect(injectWebmDuration(file, 0)).toBe(file);
  });
});
