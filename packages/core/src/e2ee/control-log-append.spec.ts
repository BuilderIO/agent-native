import { describe, expect, it } from "vitest";

import {
  type AncV1CanonicalValue,
  decodeAncV1Canonical,
  encodeAncV1Canonical,
} from "./canonical.js";
import {
  ANC_V1_CONTROL_LOG_APPEND_RECEIPT_MAX_BYTES,
  ANC_V1_CONTROL_LOG_APPEND_RECOVERY_WRAP_MAX_BYTES,
  ANC_V1_CONTROL_LOG_APPEND_SIGNED_ENTRY_MAX_BYTES,
  decodeAncV1ControlLogRotationAppendReceipt,
  decodeAncV1ControlLogRotationAppendRequest,
  encodeAncV1ControlLogRotationAppendReceipt,
  encodeAncV1ControlLogRotationAppendRequest,
} from "./control-log-append.js";

const request = {
  version: 1 as const,
  suite: "anc/v1" as const,
  type: "control-log-rotation-append-request" as const,
  signedEntry: Uint8Array.of(0xa1, 0x01, 0x02),
  recoveryWrap: Uint8Array.of(0x03, 0x04, 0x05, 0x06),
};

const receipt = {
  version: 1 as const,
  suite: "anc/v1" as const,
  type: "control-log-rotation-append-receipt" as const,
  vaultId: "vault:example-0001",
  entryId: "entry:example-0002",
  sequence: 42,
  headHash: "ab".repeat(32),
  recoveryWrapHash: "cd".repeat(32),
  recoveryWrapByteLength: 4,
};

function map(encoded: Uint8Array): Map<number, AncV1CanonicalValue> {
  return decodeAncV1Canonical(encoded, {
    maxBytes:
      ANC_V1_CONTROL_LOG_APPEND_SIGNED_ENTRY_MAX_BYTES +
      ANC_V1_CONTROL_LOG_APPEND_RECOVERY_WRAP_MAX_BYTES +
      256,
  }) as Map<number, AncV1CanonicalValue>;
}

describe("anc/v1 control-log rotation append codec", () => {
  it("round-trips exact binary artifacts without JSON or base64", () => {
    const encoded = encodeAncV1ControlLogRotationAppendRequest(request);
    const decoded = decodeAncV1ControlLogRotationAppendRequest(encoded);

    expect(decoded).toEqual(request);
    expect(decoded.signedEntry).not.toBe(request.signedEntry);
    expect(decoded.recoveryWrap).not.toBe(request.recoveryWrap);
    expect(encodeAncV1ControlLogRotationAppendRequest(decoded)).toEqual(
      encoded,
    );
    expect(map(encoded).get(4)).toBeInstanceOf(Uint8Array);
    expect(map(encoded).get(5)).toBeInstanceOf(Uint8Array);
  });

  it("round-trips the exact content-free receipt below one KiB", () => {
    const encoded = encodeAncV1ControlLogRotationAppendReceipt(receipt);
    expect(encoded.byteLength).toBeLessThanOrEqual(
      ANC_V1_CONTROL_LOG_APPEND_RECEIPT_MAX_BYTES,
    );
    expect(decodeAncV1ControlLogRotationAppendReceipt(encoded)).toEqual(
      receipt,
    );
    expect(
      encodeAncV1ControlLogRotationAppendReceipt(
        decodeAncV1ControlLogRotationAppendReceipt(encoded),
      ),
    ).toEqual(encoded);
  });

  it("rejects unknown and missing fields in both directions", () => {
    expect(() =>
      encodeAncV1ControlLogRotationAppendRequest({
        ...request,
        protectedPlaintext: "never admitted",
      } as never),
    ).toThrow(/frozen anc\/v1 schema/);

    const unknownRequest = map(
      encodeAncV1ControlLogRotationAppendRequest(request),
    );
    unknownRequest.set(99, "unknown");
    expect(() =>
      decodeAncV1ControlLogRotationAppendRequest(
        encodeAncV1Canonical(unknownRequest),
      ),
    ).toThrow(/unknown key 99/);

    const missingReceipt = map(
      encodeAncV1ControlLogRotationAppendReceipt(receipt),
    );
    missingReceipt.delete(9);
    expect(() =>
      decodeAncV1ControlLogRotationAppendReceipt(
        encodeAncV1Canonical(missingReceipt),
      ),
    ).toThrow(/missing required fields/);
  });

  it("rejects duplicate keys, alternate integer encodings, and truncation", () => {
    expect(() =>
      decodeAncV1ControlLogRotationAppendRequest(
        Uint8Array.of(0xa2, 0x01, 0x01, 0x01, 0x02),
      ),
    ).toThrow(/duplicate|Invalid canonical CBOR/i);

    const canonical = encodeAncV1ControlLogRotationAppendRequest(request);
    const versionKey = canonical.findIndex(
      (value, index) => value === 0x02 && canonical[index + 1] === 0x01,
    );
    expect(versionKey).toBeGreaterThan(0);
    const nonShortest = new Uint8Array(canonical.byteLength + 1);
    nonShortest.set(canonical.slice(0, versionKey + 1));
    nonShortest.set([0x18, 0x01], versionKey + 1);
    nonShortest.set(canonical.slice(versionKey + 2), versionKey + 3);
    expect(() =>
      decodeAncV1ControlLogRotationAppendRequest(nonShortest),
    ).toThrow(
      /more bytes than necessary|unique RFC 8949 deterministic encoding/,
    );

    expect(() =>
      decodeAncV1ControlLogRotationAppendRequest(canonical.slice(0, -1)),
    ).toThrow(/Invalid canonical CBOR/);
  });

  it("rejects wrong canonical field types and bounded artifact overflow", () => {
    const wrongType = map(encodeAncV1ControlLogRotationAppendRequest(request));
    wrongType.set(4, "not bytes");
    expect(() =>
      decodeAncV1ControlLogRotationAppendRequest(
        encodeAncV1Canonical(wrongType),
      ),
    ).toThrow(/signedEntry must contain/);

    const oversizedEntry = map(
      encodeAncV1ControlLogRotationAppendRequest(request),
    );
    oversizedEntry.set(
      4,
      new Uint8Array(ANC_V1_CONTROL_LOG_APPEND_SIGNED_ENTRY_MAX_BYTES + 1),
    );
    expect(() =>
      decodeAncV1ControlLogRotationAppendRequest(
        encodeAncV1Canonical(oversizedEntry),
      ),
    ).toThrow(/signedEntry must contain/);

    const oversizedWrap = map(
      encodeAncV1ControlLogRotationAppendRequest(request),
    );
    oversizedWrap.set(
      5,
      new Uint8Array(ANC_V1_CONTROL_LOG_APPEND_RECOVERY_WRAP_MAX_BYTES + 1),
    );
    expect(() =>
      decodeAncV1ControlLogRotationAppendRequest(
        encodeAncV1Canonical(oversizedWrap),
      ),
    ).toThrow(/recoveryWrap must contain/);
  });

  it("rejects uppercase hashes, unsafe sequences, and receipt field confusion", () => {
    expect(() =>
      encodeAncV1ControlLogRotationAppendReceipt({
        ...receipt,
        headHash: "AB".repeat(32),
      }),
    ).toThrow(/frozen anc\/v1 schema/);
    expect(() =>
      encodeAncV1ControlLogRotationAppendReceipt({
        ...receipt,
        sequence: Number.MAX_SAFE_INTEGER + 1,
      }),
    ).toThrow(/frozen anc\/v1 schema/);

    const confused = map(encodeAncV1ControlLogRotationAppendReceipt(receipt));
    confused.set(10, false);
    expect(() =>
      decodeAncV1ControlLogRotationAppendReceipt(
        encodeAncV1Canonical(confused),
      ),
    ).toThrow();
  });
});
