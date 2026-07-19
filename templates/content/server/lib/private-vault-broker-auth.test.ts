import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyEndpointRequestProof = vi.hoisted(() => vi.fn());
const resolveActivePrivateVaultControlScope = vi.hoisted(() => vi.fn());
const resolveBrokerAuthorization = vi.hoisted(() => vi.fn());
const claimAuthorizedControlRequest = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/e2ee", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/e2ee")>()),
  verifyEndpointRequestProof: (...args: unknown[]) =>
    verifyEndpointRequestProof(...args),
}));
vi.mock("./private-vault-control-log-runtime.js", () => ({
  resolveActivePrivateVaultControlScope: (...args: unknown[]) =>
    resolveActivePrivateVaultControlScope(...args),
  privateVaultControlLogService: {
    resolveBrokerAuthorization: (...args: unknown[]) =>
      resolveBrokerAuthorization(...args),
  },
}));
vi.mock("./private-vault-endpoint-request-nonces.js", () => ({
  sqlPrivateVaultEndpointRequestNonceStore: {
    claimAuthorizedControlRequest: (...args: unknown[]) =>
      claimAuthorizedControlRequest(...args),
  },
}));

import { endpointRequestProofSchema } from "@agent-native/core/e2ee";

import {
  authenticatePrivateVaultBrokerRequest,
  decodePrivateVaultEndpointProofHeader,
  PrivateVaultBrokerAuthenticationError,
} from "./private-vault-broker-auth.js";

const scope = {
  ownerEmail: "owner@example.com",
  orgId: "org_12345678",
  vaultId: "vault_12345678",
};
const endpointId = "endpoint_12345678";
const body = Uint8Array.of(1, 2, 3);
const now = new Date("2026-07-18T12:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  resolveActivePrivateVaultControlScope.mockResolvedValue(scope);
  resolveBrokerAuthorization.mockResolvedValue({
    signingPublicKey: new Uint8Array(32).fill(7),
    authenticatedControlHead: {
      sequence: 4,
      hash: "11".repeat(32),
    },
  });
  claimAuthorizedControlRequest.mockResolvedValue(true);
  verifyEndpointRequestProof.mockImplementation(async (input) => {
    const identity = await input.resolveAuthorizedEndpoint({
      vaultId: scope.vaultId,
      endpointId,
      requiredRole: "broker",
      now,
    });
    expect(identity).toMatchObject({
      vaultId: scope.vaultId,
      endpointId,
      role: "broker",
      state: "active",
      authenticatedControlHead: {
        sequence: 4,
        hash: "11".repeat(32),
        verifiedAt: now.toISOString(),
      },
    });
    expect(
      await input.claimNonce({
        vaultId: scope.vaultId,
        endpointId,
        nonce: "22".repeat(16),
        expiresAt: "2026-07-18T12:06:00.000Z",
      }),
    ).toBe(true);
    return { vaultId: scope.vaultId, endpointId };
  });
});

describe("Private Vault broker authentication", () => {
  it("derives the principal only from verified control authority", async () => {
    await expect(
      authenticatePrivateVaultBrokerRequest({
        proof: { opaque: true },
        method: "POST",
        path: "/api/private-vault/jobs/broker/claim",
        body,
        now,
      }),
    ).resolves.toEqual({
      ...scope,
      endpointId,
      signingPublicKey: new Uint8Array(32).fill(7),
    });
    expect(verifyEndpointRequestProof).toHaveBeenCalledWith(
      expect.objectContaining({
        proof: { opaque: true },
        expectedMethod: "POST",
        expectedPath: "/api/private-vault/jobs/broker/claim",
        body,
        now,
      }),
    );
    expect(resolveBrokerAuthorization).toHaveBeenCalledWith(scope, endpointId);
    expect(claimAuthorizedControlRequest).toHaveBeenCalledWith({
      ...scope,
      endpointId,
      nonce: "22".repeat(16),
      expiresAt: "2026-07-18T12:06:00.000Z",
    });
  });

  it("fails closed when signed broker authority is absent", async () => {
    resolveBrokerAuthorization.mockResolvedValue(null);
    verifyEndpointRequestProof.mockImplementation(async (input) => {
      expect(
        await input.resolveAuthorizedEndpoint({
          vaultId: scope.vaultId,
          endpointId,
          requiredRole: "broker",
          now,
        }),
      ).toBeNull();
      throw new Error("unauthorized");
    });
    await expect(
      authenticatePrivateVaultBrokerRequest({
        proof: {},
        method: "POST",
        path: "/api/private-vault/jobs/broker/claim",
        body,
        now,
      }),
    ).rejects.toBeInstanceOf(PrivateVaultBrokerAuthenticationError);
    expect(claimAuthorizedControlRequest).not.toHaveBeenCalled();
  });

  it("accepts only canonical bounded proof headers", () => {
    const proof = endpointRequestProofSchema.parse({
      version: 1,
      suite: "anc/v1",
      type: "endpoint_request",
      vaultId: scope.vaultId,
      endpointId,
      method: "POST",
      path: "/api/private-vault/jobs/broker/claim",
      bodyHash: "11".repeat(32),
      issuedAt: now.toISOString(),
      nonce: "22".repeat(16),
      signature: "33".repeat(64),
    });
    const canonical = Buffer.from(JSON.stringify(proof)).toString("base64url");
    expect(decodePrivateVaultEndpointProofHeader(canonical)).toEqual(proof);
    const { signature, ...unsigned } = proof;
    const noncanonical = Buffer.from(
      JSON.stringify({ signature, ...unsigned }),
    ).toString("base64url");
    expect(() => decodePrivateVaultEndpointProofHeader(noncanonical)).toThrow(
      PrivateVaultBrokerAuthenticationError,
    );
    expect(() => decodePrivateVaultEndpointProofHeader("not+base64")).toThrow(
      PrivateVaultBrokerAuthenticationError,
    );
  });
});
