import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyFaststart, hasPlayableMp4Metadata } from "./faststart";

function atom(type: string, payload: Uint8Array = new Uint8Array()) {
  const bytes = new Uint8Array(8 + payload.byteLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, bytes.byteLength);
  for (let i = 0; i < 4; i++) bytes[4 + i] = type.charCodeAt(i);
  bytes.set(payload, 8);
  return bytes;
}

function concat(...chunks: Uint8Array[]) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function atomOffset(data: Uint8Array, type: string) {
  const needle = new TextEncoder().encode(type);
  for (let i = 4; i <= data.byteLength - needle.byteLength; i++) {
    if (needle.every((byte, n) => data[i + n] === byte)) return i - 4;
  }
  return -1;
}

describe("MP4 faststart helpers", () => {
  it("detects missing top-level moov metadata", () => {
    const missingMoov = concat(
      atom("ftyp", new TextEncoder().encode("isommp42")),
      atom("wide"),
      atom("mdat", new Uint8Array([1, 2, 3, 4])),
    );

    assert.equal(hasPlayableMp4Metadata(missingMoov), false);
  });

  it("moves a trailing moov atom before mdat", () => {
    const slowStart = concat(
      atom("ftyp", new TextEncoder().encode("isommp42")),
      atom("mdat", new Uint8Array([1, 2, 3, 4])),
      atom("moov"),
    );

    const fastStart = applyFaststart(slowStart);

    assert.equal(hasPlayableMp4Metadata(fastStart), true);
    assert.ok(atomOffset(fastStart, "moov") < atomOffset(fastStart, "mdat"));
  });
});
