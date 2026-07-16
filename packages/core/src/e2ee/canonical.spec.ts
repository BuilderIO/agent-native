import { describe, expect, it } from "vitest";

import {
  AncV1CanonicalEncodingError,
  ancV1BytesToHex,
  ancV1HexToBytes,
  decodeAncV1Canonical,
  decodeAncV1Envelope,
  encodeAncV1Canonical,
} from "./canonical.js";

describe("anc/v1 canonical CBOR", () => {
  it("uses RFC 8949 deterministic ordering for integer-key maps", () => {
    const value = new Map([
      [24, "later"],
      [1, "first"],
      [10, Uint8Array.of(1, 2, 3)],
    ]);
    const encoded = encodeAncV1Canonical(value);
    expect(ancV1BytesToHex(encoded)).toBe(
      "a3016566697273740a430102031818656c61746572",
    );
    expect(decodeAncV1Canonical(encoded)).toEqual(
      new Map([
        [1, "first"],
        [10, Uint8Array.of(1, 2, 3)],
        [24, "later"],
      ]),
    );
  });

  it("rejects valid but non-canonical map order and integer widths", () => {
    const nonCanonicalOrder = ancV1HexToBytes(
      "a21818656c6174657201656669727374",
    );
    expect(() => decodeAncV1Canonical(nonCanonicalOrder)).toThrow(
      AncV1CanonicalEncodingError,
    );
    expect(() => decodeAncV1Canonical(Uint8Array.of(0x18, 0x01))).toThrow(
      AncV1CanonicalEncodingError,
    );
  });

  it("rejects duplicate keys, indefinite containers, floats, and objects", () => {
    expect(() =>
      decodeAncV1Canonical(Uint8Array.of(0xa2, 0x01, 0x01, 0x01, 0x02)),
    ).toThrow(AncV1CanonicalEncodingError);
    expect(() => decodeAncV1Canonical(Uint8Array.of(0x9f, 0x01, 0xff))).toThrow(
      AncV1CanonicalEncodingError,
    );
    expect(() => encodeAncV1Canonical(1.5)).toThrow(
      AncV1CanonicalEncodingError,
    );
    expect(() => encodeAncV1Canonical({ title: "protected" } as never)).toThrow(
      AncV1CanonicalEncodingError,
    );
  });

  it("rejects unknown envelope keys after canonical decoding", () => {
    const encoded = encodeAncV1Canonical(
      new Map([
        [1, "anc/v1"],
        [999, "not-admitted"],
      ]),
    );
    expect(() => decodeAncV1Envelope(encoded, [1, 2, 3])).toThrow(
      /unknown key 999/,
    );
  });
});
