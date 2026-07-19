import { describe, expect, it, vi } from "vitest";

import type { PrivateVaultTrustedEnrollmentOperator } from "./content-enrollment-coordinator.js";
import {
  PrivateVaultContentEnrollmentAuthorizer,
  PrivateVaultContentEnrollmentCandidate,
  PrivateVaultContentEnrollmentRoleRejectedError,
} from "./content-enrollment-roles.js";
import type {
  PrivateVaultContentEnrollmentTransport,
  PrivateVaultEnrollmentPhase,
} from "./content-enrollment-transport.js";

const vaultId = "00".repeat(16);
const offerHash = "11".repeat(32);
const offer = Uint8Array.of(1, 2, 3);
const proof = new Uint8Array(64).fill(4);
const challenge = Uint8Array.of(5, 6);
const sasDecision = Uint8Array.of(7, 8);
const authorization = Uint8Array.of(9, 10);

function hostedTranscript() {
  let phase: PrivateVaultEnrollmentPhase = "offer";
  let currentChallenge: Uint8Array | null = null;
  let currentDecision: Uint8Array | null = null;
  let currentAuthorization: Uint8Array | null = null;
  const status = () => ({
    phase,
    offer: offer.slice(),
    challenge: currentChallenge?.slice() ?? null,
    sasDecision: currentDecision?.slice() ?? null,
    authorization: currentAuthorization?.slice() ?? null,
    controlEntryId: phase === "committed" ? "22".repeat(16) : null,
    controlEntryHash: phase === "committed" ? "33".repeat(32) : null,
    expiresAt: "2026-07-19T00:00:00.000Z",
  });
  return {
    transport: {
      publishOffer: vi.fn(async () => status()),
      readStatus: vi.fn(async () => status()),
      publishChallenge: vi.fn(async (_hash, _offer, value: Uint8Array) => {
        currentChallenge = value.slice();
        phase = "challenge";
        return status();
      }),
      publishSasDecision: vi.fn(async (_hash, _offer, value: Uint8Array) => {
        currentDecision = value.slice();
        phase = "confirmed";
        return status();
      }),
      publishAuthorization: vi.fn(async (_hash, _offer, value: Uint8Array) => {
        currentAuthorization = value.slice();
        phase = "committed";
        return status();
      }),
    } as unknown as PrivateVaultContentEnrollmentTransport,
    reject() {
      currentDecision = sasDecision.slice();
      phase = "rejected";
    },
  };
}

function candidateNative(): PrivateVaultTrustedEnrollmentOperator {
  return {
    prepareBrokerEnrollment: vi.fn(
      async () =>
        ({
          version: 1,
          suite: "anc/v1",
          operation: "prepare_enroll",
          state: "offered",
          vaultId,
          candidateEndpointId: "44".repeat(16),
          offerHash,
          offer,
          candidateKeyProof: proof,
        }) as const,
    ),
    confirmBrokerEnrollment: vi.fn(
      async () =>
        ({
          version: 1,
          suite: "anc/v1",
          operation: "confirm_enroll",
          state: "confirmed",
          sasDecision,
        }) as const,
    ),
    activateBrokerEnrollment: vi.fn(
      async () =>
        ({
          version: 1,
          suite: "anc/v1",
          operation: "activate_enroll",
          state: "active",
          vaultId,
          custodyGeneration: 3,
          activeEpoch: 1,
          sequence: 1,
          headHash: "55".repeat(32),
        }) as const,
    ),
    buildBrokerEnrollmentChallenge: vi.fn(async () => {
      throw new Error("candidate must not authorize");
    }),
    buildBrokerEnrollmentAuthorization: vi.fn(async () => {
      throw new Error("candidate must not authorize");
    }),
  };
}

describe("Private Vault cross-device enrollment roles", () => {
  it("alternates two Macs through public hosted state without merging custody roles", async () => {
    const shared = hostedTranscript();
    const candidateOperator = candidateNative();
    const authorizerOperator = {
      buildBrokerEnrollmentChallenge: vi.fn(async () => ({
        encoded: challenge,
      })),
      buildBrokerEnrollmentAuthorization: vi.fn(async () => ({
        encoded: authorization,
      })),
    };
    const candidate = new PrivateVaultContentEnrollmentCandidate({
      native: candidateOperator,
      hosted: shared.transport,
    });
    const authorizer = new PrivateVaultContentEnrollmentAuthorizer({
      native: authorizerOperator,
      hosted: shared.transport,
    });

    const begun = await candidate.begin(vaultId);
    expect(begun.state).toBe("awaiting-authorizer");
    if (begun.state !== "awaiting-authorizer") throw new Error();
    const invitation = begun.invitation;
    await expect(authorizer.advance(invitation)).resolves.toEqual({
      state: "awaiting-candidate",
    });
    await expect(candidate.advance(invitation)).resolves.toEqual({
      state: "awaiting-authorization",
    });
    await expect(authorizer.advance(invitation)).resolves.toEqual({
      state: "committed",
    });
    await expect(candidate.advance(invitation)).resolves.toMatchObject({
      state: "active",
      result: { custodyGeneration: 3 },
    });

    expect(
      candidateOperator.buildBrokerEnrollmentChallenge,
    ).not.toHaveBeenCalled();
    expect(
      candidateOperator.buildBrokerEnrollmentAuthorization,
    ).not.toHaveBeenCalled();
    expect(
      authorizerOperator.buildBrokerEnrollmentChallenge,
    ).toHaveBeenCalledWith({ vaultId, offer, candidateKeyProof: proof });
    expect(
      authorizerOperator.buildBrokerEnrollmentAuthorization,
    ).toHaveBeenCalledWith({
      vaultId,
      offer,
      challenge,
      sasDecision,
    });
    expect(candidateOperator.confirmBrokerEnrollment).toHaveBeenCalledWith(
      vaultId,
      challenge,
    );
  });

  it("treats a hosted mismatch as terminal on both devices", async () => {
    const shared = hostedTranscript();
    shared.reject();
    const begun = await new PrivateVaultContentEnrollmentCandidate({
      native: candidateNative(),
      hosted: shared.transport,
    }).begin(vaultId);
    if (begun.state !== "awaiting-authorizer") throw new Error();
    const authorizer = new PrivateVaultContentEnrollmentAuthorizer({
      native: {
        buildBrokerEnrollmentChallenge: vi.fn(),
        buildBrokerEnrollmentAuthorization: vi.fn(),
      },
      hosted: shared.transport,
    });
    await expect(authorizer.advance(begun.invitation)).rejects.toBeInstanceOf(
      PrivateVaultContentEnrollmentRoleRejectedError,
    );
  });
});
