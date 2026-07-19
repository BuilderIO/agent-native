import { beforeEach, describe, expect, it, vi } from "vitest";

const verify = vi.hoisted(() => vi.fn());
const loadState = vi.hoisted(() => vi.fn());
const resolveScope = vi.hoisted(() => vi.fn());
const claim = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/e2ee", async (original) => ({
  ...(await original<typeof import("@agent-native/core/e2ee")>()),
  ancV1HexToBytes: () => Uint8Array.from({ length: 32 }, () => 0x55),
  assertFreshControlLogHead: (value: unknown) => value,
  controlLogStateSchema: { parse: (value: unknown) => value },
  verifyEndpointRequestProofWithIdentity: (...args: unknown[]) =>
    verify(...args),
}));
vi.mock("./private-vault-control-log-runtime.js", () => ({
  privateVaultControlLogService: { loadVerifiedState: loadState },
  resolveActivePrivateVaultControlScope: resolveScope,
}));
vi.mock("./private-vault-endpoint-request-nonces.js", () => ({
  sqlPrivateVaultEndpointRequestNonceStore: {
    claimAuthorizedControlRequest: claim,
  },
}));

import {
  authenticatePrivateVaultAttendedEndpoint,
  PrivateVaultEndpointAuthenticationError,
} from "./private-vault-endpoint-auth.js";

const vaultId = "11".repeat(16);
const endpointId = "22".repeat(16);
const scope = {
  ownerEmail: "owner@example.test",
  orgId: "org-test",
  vaultId,
};

describe("attended Private Vault endpoint authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveScope.mockResolvedValue(scope);
    loadState.mockResolvedValue({
      version: 1,
      suite: "anc/v1",
      vaultId,
      sequence: 0,
      headHash: "33".repeat(32),
      membershipHash: "44".repeat(32),
      signedAt: "2026-07-19T10:00:00.000Z",
      freshnessMode: "endpoint_witnessed",
      activeMembers: [
        {
          endpointId,
          role: "endpoint",
          unattended: false,
          signingPublicKey: "55".repeat(32),
          keyAgreementPublicKey: "66".repeat(32),
        },
      ],
      custodyGeneration: 2,
      activeEpoch: 1,
      recoveryGeneration: 1,
      recoveryId: "77".repeat(16),
      recoveryKeyAgreementPublicKey: "88".repeat(32),
      recoveryWrapHash: "99".repeat(32),
    });
    claim.mockResolvedValue(true);
    verify.mockImplementation(async (input) => {
      const identity = await input.resolveAuthorizedEndpoint({
        vaultId,
        endpointId,
      });
      if (!identity) throw new Error();
      const claimed = await input.claimNonce({
        vaultId,
        endpointId,
        nonce: "aa".repeat(16),
        expiresAt: "2026-07-19T10:06:00.000Z",
      });
      if (!claimed) throw new Error();
      return { vaultId, endpointId };
    });
  });

  it("accepts only the current attended endpoint and claims its nonce", async () => {
    await expect(
      authenticatePrivateVaultAttendedEndpoint({
        proof: {},
        method: "POST",
        path: "/api/private-vault/migration/evidence",
        body: Uint8Array.of(1),
        now: new Date("2026-07-19T10:00:01.000Z"),
      }),
    ).resolves.toEqual({ ...scope, endpointId });
    expect(claim).toHaveBeenCalledWith(
      expect.objectContaining({ ...scope, endpointId }),
    );
  });

  it("rejects brokers and unattended identities at this ceremony boundary", async () => {
    loadState.mockResolvedValueOnce({
      ...(await loadState()),
      activeMembers: [
        {
          endpointId,
          role: "broker",
          unattended: true,
          signingPublicKey: "55".repeat(32),
          keyAgreementPublicKey: "66".repeat(32),
        },
      ],
    });
    await expect(
      authenticatePrivateVaultAttendedEndpoint({
        proof: {},
        method: "POST",
        path: "/api/private-vault/migration/evidence",
        body: Uint8Array.of(1),
        now: new Date("2026-07-19T10:00:01.000Z"),
      }),
    ).rejects.toBeInstanceOf(PrivateVaultEndpointAuthenticationError);
  });
});
