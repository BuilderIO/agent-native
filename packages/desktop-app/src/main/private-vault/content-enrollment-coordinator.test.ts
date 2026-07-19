import { describe, expect, it, vi } from "vitest";

import {
  PrivateVaultContentEnrollmentCoordinator,
  PrivateVaultContentEnrollmentCoordinatorError,
  PrivateVaultContentEnrollmentRejectedError,
  type PrivateVaultTrustedEnrollmentOperator,
} from "./content-enrollment-coordinator.js";
import type { PrivateVaultContentEnrollmentTransport } from "./content-enrollment-transport.js";

const vaultId = "00".repeat(16);
const offerHash = "11".repeat(32);
const offer = Uint8Array.of(1, 2);
const challenge = Uint8Array.of(3, 4);
const authorization = Uint8Array.of(5, 6);

function native(
  decision: "confirmed" | "mismatch" = "confirmed",
): PrivateVaultTrustedEnrollmentOperator {
  return {
    prepareBrokerEnrollment: vi.fn(
      async () =>
        ({
          version: 1,
          suite: "anc/v1",
          operation: "prepare_enroll",
          state: "offered",
          vaultId,
          candidateEndpointId: "22".repeat(16),
          offerHash,
          offer,
          candidateKeyProof: new Uint8Array(64),
        }) as const,
    ),
    buildBrokerEnrollmentChallenge: vi.fn(async () => ({
      encoded: challenge,
    })),
    confirmBrokerEnrollment: vi.fn(
      async () =>
        ({
          version: 1,
          suite: "anc/v1",
          operation: "confirm_enroll",
          state: decision,
        }) as const,
    ),
    buildBrokerEnrollmentAuthorization: vi.fn(async () => ({
      encoded: authorization,
    })),
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
          headHash: "33".repeat(32),
        }) as const,
    ),
  };
}

function status(phase: "offer" | "challenge" | "committed") {
  return {
    phase,
    offer,
    challenge: phase === "offer" ? null : challenge,
    authorization: phase === "committed" ? authorization : null,
    controlEntryId: phase === "committed" ? "44".repeat(16) : null,
    controlEntryHash: phase === "committed" ? "55".repeat(32) : null,
    expiresAt: "2026-07-18T18:10:00.000Z",
  } as const;
}

describe("PrivateVaultContentEnrollmentCoordinator", () => {
  it("carries only public artifacts through offer, trusted SAS, commit, and activation", async () => {
    const operator = native();
    const hosted = {
      publishOffer: vi.fn(async () => status("offer")),
      publishChallenge: vi.fn(async () => status("challenge")),
      publishAuthorization: vi.fn(async () => status("committed")),
    } as unknown as PrivateVaultContentEnrollmentTransport;
    const coordinator = new PrivateVaultContentEnrollmentCoordinator({
      native: operator,
      hosted,
    });
    await expect(coordinator.enroll(vaultId)).resolves.toMatchObject({
      state: "active",
      custodyGeneration: 3,
    });
    expect(operator.buildBrokerEnrollmentChallenge).toHaveBeenCalledWith({
      vaultId,
    });
    expect(operator.confirmBrokerEnrollment).toHaveBeenCalledWith(
      vaultId,
      challenge,
    );
    expect(operator.buildBrokerEnrollmentAuthorization).toHaveBeenCalledWith({
      vaultId,
      challenge,
    });
    expect(operator.activateBrokerEnrollment).toHaveBeenCalledWith(
      vaultId,
      challenge,
      authorization,
    );
  });

  it("resumes a hosted committed transcript without minting a second challenge or authorization", async () => {
    const operator = native();
    const hosted = {
      publishOffer: vi.fn(async () => status("committed")),
    } as unknown as PrivateVaultContentEnrollmentTransport;
    const coordinator = new PrivateVaultContentEnrollmentCoordinator({
      native: operator,
      hosted,
    });
    await expect(coordinator.enroll(vaultId)).resolves.toMatchObject({
      state: "active",
    });
    expect(operator.buildBrokerEnrollmentChallenge).not.toHaveBeenCalled();
    expect(operator.confirmBrokerEnrollment).not.toHaveBeenCalled();
    expect(operator.buildBrokerEnrollmentAuthorization).not.toHaveBeenCalled();
  });

  it("stops permanently when trusted UI records a mismatch", async () => {
    const operator = native("mismatch");
    const hosted = {
      publishOffer: vi.fn(async () => status("challenge")),
    } as unknown as PrivateVaultContentEnrollmentTransport;
    const coordinator = new PrivateVaultContentEnrollmentCoordinator({
      native: operator,
      hosted,
    });
    await expect(coordinator.enroll(vaultId)).rejects.toBeInstanceOf(
      PrivateVaultContentEnrollmentRejectedError,
    );
    expect(operator.buildBrokerEnrollmentAuthorization).not.toHaveBeenCalled();
    expect(operator.activateBrokerEnrollment).not.toHaveBeenCalled();
  });

  it("rejects hosted challenge or authorization substitution", async () => {
    const operator = native();
    const hosted = {
      publishOffer: vi.fn(async () => status("offer")),
      publishChallenge: vi.fn(async () => ({
        ...status("challenge"),
        challenge: Uint8Array.of(99),
      })),
    } as unknown as PrivateVaultContentEnrollmentTransport;
    const coordinator = new PrivateVaultContentEnrollmentCoordinator({
      native: operator,
      hosted,
    });
    await expect(coordinator.enroll(vaultId)).rejects.toBeInstanceOf(
      PrivateVaultContentEnrollmentCoordinatorError,
    );
    expect(operator.confirmBrokerEnrollment).not.toHaveBeenCalled();
  });
});
