import { createHash, createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  type AncV1CanonicalValue,
  decodeAncV1Canonical,
  encodeAncV1Canonical,
} from "./canonical.js";
import {
  ANC_V1_GENESIS_ACCOUNT_ADMISSION_AUTHORIZATION_MAX_BYTES,
  ANC_V1_GENESIS_ACCOUNT_ADMISSION_BOOTSTRAP_TRANSCRIPT_MAX_BYTES,
  ANC_V1_GENESIS_ACCOUNT_ADMISSION_CANDIDATE_HASH_DOMAIN,
  ANC_V1_GENESIS_ACCOUNT_ADMISSION_CANDIDATE_MAX_BYTES,
  ANC_V1_GENESIS_ACCOUNT_ADMISSION_CHALLENGE_AUTH_DOMAIN,
  ANC_V1_GENESIS_ACCOUNT_ADMISSION_CHALLENGE_MAX_BYTES,
  ANC_V1_GENESIS_ACCOUNT_ADMISSION_RECEIPT_MAX_BYTES,
  ANC_V1_GENESIS_ACCOUNT_ADMISSION_RECOVERY_CONFIRMATION_MAX_BYTES,
  ANC_V1_GENESIS_ACCOUNT_ADMISSION_REQUEST_MAX_BYTES,
  ancV1GenesisAccountAdmissionCandidateHashInput,
  ancV1GenesisAccountAdmissionChallengeAuthenticationInput,
  decodeAncV1GenesisAccountAdmissionCandidate,
  decodeAncV1GenesisAccountAdmissionChallenge,
  decodeAncV1GenesisAccountAdmissionReceipt,
  decodeAncV1GenesisAccountAdmissionRequest,
  encodeAncV1GenesisAccountAdmissionCandidate,
  encodeAncV1GenesisAccountAdmissionChallenge,
  encodeAncV1GenesisAccountAdmissionReceipt,
  encodeAncV1GenesisAccountAdmissionRequest,
} from "./genesis-account-admission.js";

const artifact = (type: string, marker: number) =>
  encodeAncV1Canonical(
    new Map<number, AncV1CanonicalValue>([
      [1, "anc/v1"],
      [2, type],
      [3, Uint8Array.of(marker)],
    ]),
  );

const candidate = {
  suite: "anc/v1" as const,
  version: 1 as const,
  type: "genesis-account-admission-candidate" as const,
  bootstrapTranscript: artifact("genesis-bootstrap-transcript", 0x11),
  recoveryConfirmation: artifact("genesis-recovery-confirmation", 0x22),
  authorization: artifact("genesis-authorization", 0x33),
};
const candidateBytes = encodeAncV1GenesisAccountAdmissionCandidate(candidate);
const candidateHash = createHash("sha256")
  .update(ancV1GenesisAccountAdmissionCandidateHashInput(candidateBytes))
  .digest("hex");
const unsignedChallenge = {
  suite: "anc/v1" as const,
  version: 1 as const,
  type: "genesis-account-admission-challenge" as const,
  challengeId: "challenge:example-0001",
  accountId: "account:example-0002",
  workspaceId: "workspace:example-0003",
  candidateHash,
  issuedAt: "2026-07-18T12:00:00.000Z",
  expiresAt: "2026-07-18T12:05:00.000Z",
};
const authenticationTag = createHmac("sha256", "obvious-example-test-secret")
  .update(
    ancV1GenesisAccountAdmissionChallengeAuthenticationInput(unsignedChallenge),
  )
  .digest();
const challenge = { ...unsignedChallenge, authenticationTag };
const challengeBytes = encodeAncV1GenesisAccountAdmissionChallenge(challenge);
const request = {
  suite: "anc/v1" as const,
  version: 1 as const,
  type: "genesis-account-admission-request" as const,
  candidate: candidateBytes,
  challenge: challengeBytes,
};
const receipt = {
  suite: "anc/v1" as const,
  version: 1 as const,
  type: "genesis-account-admission-receipt" as const,
  accountId: unsignedChallenge.accountId,
  workspaceId: unsignedChallenge.workspaceId,
  vaultId: "vault:example-0004",
  controlEntryId: "entry:example-0005",
  controlEntryHash: "ab".repeat(32),
  signerEndpointId: "endpoint:example-0006",
  candidateHash,
  bootstrapTranscriptHash: "cd".repeat(32),
};

const hex = (value: Uint8Array) => Buffer.from(value).toString("hex");

function map(encoded: Uint8Array, maximum: number) {
  return decodeAncV1Canonical(encoded, { maxBytes: maximum }) as Map<
    number,
    AncV1CanonicalValue
  >;
}

function oversizedCanonicalMap(maximum: number): Uint8Array {
  return encodeAncV1Canonical(
    new Map<number, AncV1CanonicalValue>([[1, new Uint8Array(maximum)]]),
  );
}

describe("anc/v1 genesis account admission challenge-response codecs", () => {
  it("round-trips and snapshots the exact candidate artifacts", () => {
    const decoded = decodeAncV1GenesisAccountAdmissionCandidate(candidateBytes);

    expect(decoded).toEqual(candidate);
    expect(decoded.bootstrapTranscript).not.toBe(candidate.bootstrapTranscript);
    expect(encodeAncV1GenesisAccountAdmissionCandidate(decoded)).toEqual(
      candidateBytes,
    );
    expect(candidateBytes.byteLength).toBeLessThanOrEqual(
      ANC_V1_GENESIS_ACCOUNT_ADMISSION_CANDIDATE_MAX_BYTES,
    );
  });

  it("freezes domain-separated candidate-hash and challenge-HMAC inputs", () => {
    const hashInput =
      ancV1GenesisAccountAdmissionCandidateHashInput(candidateBytes);
    const authenticationInput =
      ancV1GenesisAccountAdmissionChallengeAuthenticationInput(
        unsignedChallenge,
      );

    expect(
      new TextDecoder().decode(hashInput.slice(0, -candidateBytes.length)),
    ).toBe(`${ANC_V1_GENESIS_ACCOUNT_ADMISSION_CANDIDATE_HASH_DOMAIN}\0`);
    expect(
      new TextDecoder().decode(
        authenticationInput.slice(
          0,
          ANC_V1_GENESIS_ACCOUNT_ADMISSION_CHALLENGE_AUTH_DOMAIN.length + 1,
        ),
      ),
    ).toBe(`${ANC_V1_GENESIS_ACCOUNT_ADMISSION_CHALLENGE_AUTH_DOMAIN}\0`);
    expect(candidateHash).toBe(
      "37dd3ba9f58fa42c5fcd2e72e9fdf2afa5564650b328d18e52db9e64a12290cb",
    );
    expect(hex(authenticationTag)).toBe(
      "9e990a7c8dd24b62582ae7d1dded90a8cee7f5b1eca9ea1e32182f38e9c1a118",
    );
  });

  it("round-trips the authenticated, scope-bound short-lived challenge", () => {
    expect(decodeAncV1GenesisAccountAdmissionChallenge(challengeBytes)).toEqual(
      { ...challenge, authenticationTag: Uint8Array.from(authenticationTag) },
    );
    expect(
      encodeAncV1GenesisAccountAdmissionChallenge(
        decodeAncV1GenesisAccountAdmissionChallenge(challengeBytes),
      ),
    ).toEqual(challengeBytes);
    expect(challengeBytes.byteLength).toBeLessThanOrEqual(
      ANC_V1_GENESIS_ACCOUNT_ADMISSION_CHALLENGE_MAX_BYTES,
    );
  });

  it("embeds the exact candidate and challenge bytes in the final request", () => {
    const encoded = encodeAncV1GenesisAccountAdmissionRequest(request);
    const decoded = decodeAncV1GenesisAccountAdmissionRequest(encoded);

    expect(decoded).toEqual({
      ...request,
      candidate: Uint8Array.from(candidateBytes),
      challenge: Uint8Array.from(challengeBytes),
    });
    expect(decoded.candidate).not.toBe(request.candidate);
    expect(decoded.challenge).not.toBe(request.challenge);
    expect(encodeAncV1GenesisAccountAdmissionRequest(decoded)).toEqual(encoded);
    expect(encoded.byteLength).toBeLessThanOrEqual(
      ANC_V1_GENESIS_ACCOUNT_ADMISSION_REQUEST_MAX_BYTES,
    );
  });

  it("keeps receipts deterministic across fresh challenges for one candidate", () => {
    const first = encodeAncV1GenesisAccountAdmissionReceipt(receipt);
    const freshChallenge = {
      ...challenge,
      challengeId: "challenge:example-fresh",
      issuedAt: "2026-07-18T12:06:00.000Z",
      expiresAt: "2026-07-18T12:11:00.000Z",
    };
    encodeAncV1GenesisAccountAdmissionChallenge(freshChallenge);
    const second = encodeAncV1GenesisAccountAdmissionReceipt(receipt);

    expect(first).toEqual(second);
    expect(decodeAncV1GenesisAccountAdmissionReceipt(first)).toEqual(receipt);
    expect(first.byteLength).toBeLessThanOrEqual(
      ANC_V1_GENESIS_ACCOUNT_ADMISSION_RECEIPT_MAX_BYTES,
    );
  });

  it("makes receipt-scope and challenge substitutions byte-visible", () => {
    const canonicalReceipt = encodeAncV1GenesisAccountAdmissionReceipt(receipt);
    const substitutedReceipt = encodeAncV1GenesisAccountAdmissionReceipt({
      ...receipt,
      accountId: "account:substituted",
    });
    expect(substitutedReceipt).not.toEqual(canonicalReceipt);
    expect(
      decodeAncV1GenesisAccountAdmissionReceipt(substitutedReceipt).accountId,
    ).toBe("account:substituted");
    const changedScope = {
      ...unsignedChallenge,
      workspaceId: "workspace:substituted",
    };
    expect(
      hex(
        ancV1GenesisAccountAdmissionChallengeAuthenticationInput(changedScope),
      ),
    ).not.toBe(
      hex(
        ancV1GenesisAccountAdmissionChallengeAuthenticationInput(
          unsignedChallenge,
        ),
      ),
    );
    expect(
      hex(
        ancV1GenesisAccountAdmissionChallengeAuthenticationInput({
          ...unsignedChallenge,
          candidateHash: "ee".repeat(32),
        }),
      ),
    ).not.toBe(
      hex(
        ancV1GenesisAccountAdmissionChallengeAuthenticationInput(
          unsignedChallenge,
        ),
      ),
    );

    const receiptMap = map(
      encodeAncV1GenesisAccountAdmissionReceipt(receipt),
      ANC_V1_GENESIS_ACCOUNT_ADMISSION_RECEIPT_MAX_BYTES,
    );
    receiptMap.set(4, "bad id");
    expect(() =>
      decodeAncV1GenesisAccountAdmissionReceipt(
        encodeAncV1Canonical(receiptMap),
      ),
    ).toThrow(/frozen anc\/v1 schema/);
  });

  it("rejects expired ordering, long lifetimes, malformed tags, and IDs", () => {
    expect(() =>
      encodeAncV1GenesisAccountAdmissionChallenge({
        ...challenge,
        expiresAt: challenge.issuedAt,
      }),
    ).toThrow(/challenge metadata is invalid/);
    expect(() =>
      encodeAncV1GenesisAccountAdmissionChallenge({
        ...challenge,
        expiresAt: "2026-07-18T12:10:00.001Z",
      }),
    ).toThrow(/challenge metadata is invalid/);
    expect(() =>
      encodeAncV1GenesisAccountAdmissionChallenge({
        ...challenge,
        authenticationTag: new Uint8Array(31),
      }),
    ).toThrow(/authenticationTag must be exactly 32 bytes/);
    expect(() =>
      encodeAncV1GenesisAccountAdmissionChallenge({
        ...challenge,
        accountId: "bad id",
      }),
    ).toThrow(/challenge metadata is invalid/);
  });

  it("rejects unknown, missing, confused, and noncanonical fields", () => {
    expect(() =>
      encodeAncV1GenesisAccountAdmissionCandidate({
        ...candidate,
        protectedContent: Uint8Array.of(1),
      } as never),
    ).toThrow(/exactly the frozen anc\/v1 fields/);
    expect(() =>
      ancV1GenesisAccountAdmissionChallengeAuthenticationInput({
        ...unsignedChallenge,
        authenticationTag: new Uint8Array(32),
      } as never),
    ).toThrow(/exactly the frozen anc\/v1 fields/);

    const unknown = map(
      candidateBytes,
      ANC_V1_GENESIS_ACCOUNT_ADMISSION_CANDIDATE_MAX_BYTES,
    );
    unknown.set(99, "unknown");
    expect(() =>
      decodeAncV1GenesisAccountAdmissionCandidate(
        encodeAncV1Canonical(unknown),
      ),
    ).toThrow(/unknown key 99/);

    const missing = map(
      challengeBytes,
      ANC_V1_GENESIS_ACCOUNT_ADMISSION_CHALLENGE_MAX_BYTES,
    );
    missing.delete(10);
    expect(() =>
      decodeAncV1GenesisAccountAdmissionChallenge(
        encodeAncV1Canonical(missing),
      ),
    ).toThrow(/missing required fields/);

    const confused = map(
      candidateBytes,
      ANC_V1_GENESIS_ACCOUNT_ADMISSION_CANDIDATE_MAX_BYTES,
    );
    confused.set(3, "genesis-account-admission-request");
    expect(() =>
      decodeAncV1GenesisAccountAdmissionCandidate(
        encodeAncV1Canonical(confused),
      ),
    ).toThrow(/type must be genesis-account-admission-candidate/);

    expect(() =>
      decodeAncV1GenesisAccountAdmissionCandidate(
        Uint8Array.of(0xa2, 0x01, 0x01, 0x01, 0x02),
      ),
    ).toThrow(/duplicate|Invalid canonical CBOR/i);
  });

  it("enforces every artifact and aggregate envelope cap", () => {
    expect(() =>
      encodeAncV1GenesisAccountAdmissionCandidate({
        ...candidate,
        bootstrapTranscript: oversizedCanonicalMap(
          ANC_V1_GENESIS_ACCOUNT_ADMISSION_BOOTSTRAP_TRANSCRIPT_MAX_BYTES,
        ),
      }),
    ).toThrow(/bootstrapTranscript must contain/);
    expect(() =>
      encodeAncV1GenesisAccountAdmissionCandidate({
        ...candidate,
        recoveryConfirmation: oversizedCanonicalMap(
          ANC_V1_GENESIS_ACCOUNT_ADMISSION_RECOVERY_CONFIRMATION_MAX_BYTES,
        ),
      }),
    ).toThrow(/recoveryConfirmation must contain/);
    expect(() =>
      encodeAncV1GenesisAccountAdmissionCandidate({
        ...candidate,
        authorization: oversizedCanonicalMap(
          ANC_V1_GENESIS_ACCOUNT_ADMISSION_AUTHORIZATION_MAX_BYTES,
        ),
      }),
    ).toThrow(/authorization must contain/);
    expect(() =>
      decodeAncV1GenesisAccountAdmissionRequest(
        new Uint8Array(ANC_V1_GENESIS_ACCOUNT_ADMISSION_REQUEST_MAX_BYTES + 1),
      ),
    ).toThrow(/exceeds .* bytes/);
  });

  it("documents that challenge possession alone is not endpoint authorization", () => {
    const encoded = encodeAncV1GenesisAccountAdmissionRequest(request);

    expect(decodeAncV1GenesisAccountAdmissionRequest(encoded)).toEqual({
      ...request,
      candidate: Uint8Array.from(candidateBytes),
      challenge: Uint8Array.from(challengeBytes),
    });
    // The hosted route must separately verify x-anc-endpoint-request-proof over
    // this exact body before it may transactionally consume the challenge.
    expect(Object.keys(request)).not.toContain("endpointRequestProof");
  });
});
