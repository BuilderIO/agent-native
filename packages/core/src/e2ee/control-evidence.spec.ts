import { describe, expect, it } from "vitest";

import {
  AncV1ControlEvidenceCodecError,
  decodeAncV1RecoveryControlEvidence,
  encodeAncV1RecoveryControlEvidence,
} from "./control-evidence.js";

describe("anc/v1 control evidence", () => {
  it("round-trips the exact recovery artifacts canonically", () => {
    const encoded = encodeAncV1RecoveryControlEvidence({
      suite: "anc/v1",
      version: 1,
      type: "recovery-control-evidence",
      currentSnapshot: new Uint8Array([1, 2, 3]),
      recoveryAuthorization: new Uint8Array([4, 5, 6]),
    });
    expect(decodeAncV1RecoveryControlEvidence(encoded)).toEqual({
      suite: "anc/v1",
      version: 1,
      type: "recovery-control-evidence",
      currentSnapshot: new Uint8Array([1, 2, 3]),
      recoveryAuthorization: new Uint8Array([4, 5, 6]),
    });
    expect(
      encodeAncV1RecoveryControlEvidence(
        decodeAncV1RecoveryControlEvidence(encoded),
      ),
    ).toEqual(encoded);
  });

  it("rejects empty artifacts", () => {
    expect(() =>
      encodeAncV1RecoveryControlEvidence({
        suite: "anc/v1",
        version: 1,
        type: "recovery-control-evidence",
        currentSnapshot: new Uint8Array(),
        recoveryAuthorization: new Uint8Array([1]),
      }),
    ).toThrow(AncV1ControlEvidenceCodecError);
  });
});
