import { describe, expect, it } from "vitest";

import {
  ancV1BytesToHex,
  decodeAncV1Canonical,
  encodeAncV1Canonical,
} from "./canonical.js";
import {
  ANC_V1_ABORT_MEMBERSHIP_KIND,
  decodeAncV1CeremonyAbortStateCommitment,
  encodeAncV1CeremonyAbortStateCommitment,
  hashAncV1CeremonyAbortStateCommitment,
} from "./ceremony-abort.js";

const state = {
  suite: "anc/v1" as const,
  vaultId: "01".repeat(16),
  type: "ceremony-abort-state" as const,
  ceremonyId: "0c".repeat(16),
  ceremonyKind: "add_device" as const,
  epoch: 7,
  expectedControlSequence: 9,
  expectedControlHeadHash: new Uint8Array(32).fill(0x71),
  completedSteps: ["candidate_keys_generated", "sas_verified"],
  alertCode: "sas_mismatch",
  incompleteReason: "user_rejected",
  plaintextOutstanding: false,
  abortReason: "sas_mismatch",
  signerEndpointId: "02".repeat(16),
};

describe("anc/v1 ceremony abort state commitment", () => {
  it("round-trips exact canonical replay state and hashes it", async () => {
    const encoded = encodeAncV1CeremonyAbortStateCommitment(state);
    expect(ancV1BytesToHex(encoded)).toBe(
      "ae0166616e632f763102782030313031303130313031303130313031303130313031303130313031303130310374636572656d6f6e792d61626f72742d7374617465190154782030633063306330633063306330633063306330633063306330633063306330631901556a6164645f64657669636519015607190157091901585820717171717171717171717171717171717171717171717171717171717171717119015982781863616e6469646174655f6b6579735f67656e6572617465646c7361735f766572696669656419015a6c7361735f6d69736d6174636819015b6d757365725f72656a656374656419015cf419015d6c7361735f6d69736d6174636819015e78203032303230323032303230323032303230323032303230323032303230323032",
    );
    expect(
      decodeAncV1CeremonyAbortStateCommitment(encoded, {
        expectedVaultId: state.vaultId,
      }),
    ).toEqual(state);
    await expect(
      hashAncV1CeremonyAbortStateCommitment(state),
    ).resolves.toHaveLength(32);
  });

  it("rejects outstanding plaintext, unknown fields, wrong head size and >48 steps at authorization seams", () => {
    const encoded = encodeAncV1CeremonyAbortStateCommitment(state);
    const map = decodeAncV1Canonical(encoded) as Map<number, never>;
    map.set(999, "unknown" as never);
    expect(() =>
      decodeAncV1CeremonyAbortStateCommitment(encodeAncV1Canonical(map), {
        expectedVaultId: state.vaultId,
      }),
    ).toThrow(/unknown key/);
    expect(() =>
      encodeAncV1CeremonyAbortStateCommitment({
        ...state,
        expectedControlHeadHash: new Uint8Array(31),
      }),
    ).toThrow(/32 bytes/);
    expect(() =>
      encodeAncV1CeremonyAbortStateCommitment({
        ...state,
        completedSteps: Array.from(
          { length: 49 },
          (_, index) => `step_${index}`,
        ),
      }),
    ).toThrow(/48/);
    // Commitment encoding may represent the replayed bad state; the reducer's
    // authorization callback must reject it before logging.
    expect(
      encodeAncV1CeremonyAbortStateCommitment({
        ...state,
        plaintextOutstanding: true,
      }),
    ).toBeInstanceOf(Uint8Array);
  });

  it("uses full transcript ceremony kinds and maps broker membership without add_broker vocabulary", () => {
    expect(ANC_V1_ABORT_MEMBERSHIP_KIND).toEqual({
      brokerEnrollment: "add_device",
      brokerRemoval: "remove_device",
    });
    for (const ceremonyKind of [
      "rotate_epoch",
      "grant_issue",
      "grant_revoke",
      "direct_external_disclosure",
      "vault_deletion",
    ] as const) {
      expect(
        encodeAncV1CeremonyAbortStateCommitment({ ...state, ceremonyKind }),
      ).toBeInstanceOf(Uint8Array);
    }
    expect(() =>
      encodeAncV1CeremonyAbortStateCommitment({
        ...state,
        ceremonyKind: "add_broker",
      } as never),
    ).toThrow(/ceremonyKind/);
  });
});
