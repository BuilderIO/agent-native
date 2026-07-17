import { createRequire } from "node:module";

import { describe, expect, it, vi } from "vitest";

import {
  createEndpointRequestProof,
  E2EE_ENDPOINT_REQUEST_NONCE_RETENTION_SECONDS,
  encodeEndpointRequestUnsignedProof,
  EndpointRequestAuthError,
  verifyEndpointRequestProof,
  verifyEndpointRequestProofWithIdentity,
} from "./endpoint-request-auth.js";
import { ancV1SigningKeypairFromSeed } from "./portable-crypto.js";
import { e2eeDomainSeparationPrefix } from "./suite.js";

interface NativeSodium {
  crypto_sign_PUBLICKEYBYTES: number;
  crypto_sign_SECRETKEYBYTES: number;
  crypto_sign_BYTES: number;
  crypto_generichash(out: Buffer, input: Buffer, key?: Buffer | null): void;
  crypto_sign_seed_keypair(
    publicKey: Buffer,
    privateKey: Buffer,
    seed: Buffer,
  ): void;
  crypto_sign_detached(
    signature: Buffer,
    message: Buffer,
    privateKey: Buffer,
  ): void;
}

const require = createRequire(import.meta.url);
const sodium = require("sodium-native") as NativeSodium;

const encoder = new TextEncoder();
const issuedAt = "2026-07-17T01:00:00.000Z";
const now = new Date("2026-07-17T01:02:00.000Z");

async function fixture() {
  const pair = await ancV1SigningKeypairFromSeed(
    Uint8Array.from({ length: 32 }, (_, index) => index + 1),
  );
  const body = encoder.encode('{"lease":"opaque"}');
  const proof = await createEndpointRequestProof({
    vaultId: "vault-auth-0001",
    endpointId: "endpoint-auth-0001",
    method: "POST",
    path: "/api/private-vault/jobs/broker/claim",
    body,
    issuedAt,
    nonce: "0123456789abcdef0123456789abcdef",
    signingPrivateKey: pair.privateKey,
  });
  const resolveAuthorizedEndpoint = vi.fn(async () => ({
    vaultId: "vault-auth-0001",
    endpointId: "endpoint-auth-0001",
    role: "broker" as const,
    state: "active" as const,
    signingPublicKey: pair.publicKey,
    authenticatedControlHead: {
      sequence: 7,
      hash: "ab".repeat(32),
      verifiedAt: "2026-07-17T01:01:00.000Z",
    },
  }));
  const claimNonce = vi.fn(async () => true);
  return { body, proof, pair, resolveAuthorizedEndpoint, claimNonce };
}

describe("anc/v1 endpoint request authentication", () => {
  it("binds the endpoint, method, path, body, timestamp, and nonce", async () => {
    const value = await fixture();
    await expect(
      verifyEndpointRequestProof({
        proof: value.proof,
        expectedMethod: "POST",
        expectedPath: "/api/private-vault/jobs/broker/claim",
        body: value.body,
        now,
        resolveAuthorizedEndpoint: value.resolveAuthorizedEndpoint,
        claimNonce: value.claimNonce,
      }),
    ).resolves.toEqual({
      vaultId: "vault-auth-0001",
      endpointId: "endpoint-auth-0001",
    });
    expect(value.claimNonce).toHaveBeenCalledWith({
      vaultId: "vault-auth-0001",
      endpointId: "endpoint-auth-0001",
      nonce: "0123456789abcdef0123456789abcdef",
      expiresAt: "2026-07-17T01:06:00.000Z",
    });
  });

  it.each([
    ["method", { expectedMethod: "GET" as const }],
    ["path", { expectedPath: "/api/private-vault/jobs/broker/other" }],
    ["body", { body: encoder.encode("tampered") }],
  ])(
    "rejects a mismatched %s before consuming the nonce",
    async (_name, patch) => {
      const value = await fixture();
      await expect(
        verifyEndpointRequestProof({
          proof: value.proof,
          expectedMethod: "POST",
          expectedPath: "/api/private-vault/jobs/broker/claim",
          body: value.body,
          now,
          resolveAuthorizedEndpoint: value.resolveAuthorizedEndpoint,
          claimNonce: value.claimNonce,
          ...patch,
        }),
      ).rejects.toMatchObject({ code: "request_mismatch" });
      expect(value.claimNonce).not.toHaveBeenCalled();
    },
  );

  it("rejects expired and excessively future-dated proofs", async () => {
    const value = await fixture();
    for (const [testNow, code] of [
      [new Date("2026-07-17T01:05:00.000Z"), "expired"],
      [new Date("2026-07-17T00:59:29.999Z"), "future"],
    ] as const) {
      await expect(
        verifyEndpointRequestProof({
          proof: value.proof,
          expectedMethod: "POST",
          expectedPath: "/api/private-vault/jobs/broker/claim",
          body: value.body,
          now: testNow,
          resolveAuthorizedEndpoint: value.resolveAuthorizedEndpoint,
          claimNonce: value.claimNonce,
        }),
      ).rejects.toMatchObject({ code });
    }
    expect(value.claimNonce).not.toHaveBeenCalled();
  });

  it("rejects unauthorized endpoints and signatures made by another endpoint", async () => {
    const value = await fixture();
    const unknown = vi.fn(async () => null);
    await expect(
      verifyEndpointRequestProof({
        proof: value.proof,
        expectedMethod: "POST",
        expectedPath: "/api/private-vault/jobs/broker/claim",
        body: value.body,
        now,
        resolveAuthorizedEndpoint: unknown,
        claimNonce: value.claimNonce,
      }),
    ).rejects.toMatchObject({ code: "unauthorized_endpoint" });

    const other = await ancV1SigningKeypairFromSeed(new Uint8Array(32).fill(9));
    await expect(
      verifyEndpointRequestProof({
        proof: value.proof,
        expectedMethod: "POST",
        expectedPath: "/api/private-vault/jobs/broker/claim",
        body: value.body,
        now,
        resolveAuthorizedEndpoint: async () => ({
          ...(await value.resolveAuthorizedEndpoint()),
          signingPublicKey: other.publicKey,
        }),
        claimNonce: value.claimNonce,
      }),
    ).rejects.toMatchObject({ code: "invalid_signature" });
    expect(value.claimNonce).not.toHaveBeenCalled();
  });

  it("requires an atomic first-use nonce claim after signature verification", async () => {
    const value = await fixture();
    value.claimNonce.mockResolvedValue(false);
    await expect(
      verifyEndpointRequestProof({
        proof: value.proof,
        expectedMethod: "POST",
        expectedPath: "/api/private-vault/jobs/broker/claim",
        body: value.body,
        now,
        resolveAuthorizedEndpoint: value.resolveAuthorizedEndpoint,
        claimNonce: value.claimNonce,
      }),
    ).rejects.toMatchObject({ code: "replay" });
  });

  it("rejects non-canonical paths and malformed proofs with one content-free error", async () => {
    const value = await fixture();
    await expect(
      createEndpointRequestProof({
        vaultId: "vault-auth-0001",
        endpointId: "endpoint-auth-0001",
        method: "POST",
        path: "/api/private-vault/../admin",
        body: value.body,
        issuedAt,
        nonce: "0123456789abcdef0123456789abcdef",
        signingPrivateKey: value.pair.privateKey,
      }),
    ).rejects.toThrow();

    const error = await verifyEndpointRequestProof({
      proof: { ...value.proof, extra: "forbidden" },
      expectedMethod: "POST",
      expectedPath: "/api/private-vault/jobs/broker/claim",
      body: value.body,
      now,
      resolveAuthorizedEndpoint: value.resolveAuthorizedEndpoint,
      claimNonce: value.claimNonce,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(EndpointRequestAuthError);
    expect(error).toMatchObject({
      code: "invalid_proof",
      message: "Endpoint request authentication failed",
    });
  });

  it("requires fresh signed broker authorization before nonce consumption", async () => {
    const value = await fixture();
    for (const resolved of [
      {
        ...(await value.resolveAuthorizedEndpoint()),
        endpointId: "endpoint-auth-other",
      },
      {
        ...(await value.resolveAuthorizedEndpoint()),
        authenticatedControlHead: {
          sequence: 7,
          hash: "ab".repeat(32),
          verifiedAt: "2026-07-17T00:47:00.000Z",
        },
      },
    ]) {
      await expect(
        verifyEndpointRequestProof({
          proof: value.proof,
          expectedMethod: "POST",
          expectedPath: "/api/private-vault/jobs/broker/claim",
          body: value.body,
          now,
          resolveAuthorizedEndpoint: async () => resolved,
          claimNonce: value.claimNonce,
        }),
      ).rejects.toMatchObject({ code: "unauthorized_endpoint" });
    }
    expect(value.claimNonce).not.toHaveBeenCalled();
  });

  it("accepts a signed-control endpoint identity without broker freshness semantics", async () => {
    const value = await fixture();
    const resolveAuthorizedEndpoint = vi.fn(async () => ({
      vaultId: "vault-auth-0001",
      endpointId: "endpoint-auth-0001",
      state: "active" as const,
      signingPublicKey: value.pair.publicKey,
    }));
    await expect(
      verifyEndpointRequestProofWithIdentity({
        proof: value.proof,
        expectedMethod: "POST",
        expectedPath: "/api/private-vault/jobs/broker/claim",
        body: value.body,
        now,
        resolveAuthorizedEndpoint,
        claimNonce: value.claimNonce,
      }),
    ).resolves.toEqual({
      vaultId: "vault-auth-0001",
      endpointId: "endpoint-auth-0001",
    });
    expect(resolveAuthorizedEndpoint).toHaveBeenCalledWith({
      vaultId: "vault-auth-0001",
      endpointId: "endpoint-auth-0001",
      now,
    });
  });

  it("keeps generic signed-control identities exact and content-free", async () => {
    const value = await fixture();
    for (const resolved of [
      {
        vaultId: "vault-auth-other",
        endpointId: "endpoint-auth-0001",
        state: "active" as const,
        signingPublicKey: value.pair.publicKey,
      },
      {
        vaultId: "vault-auth-0001",
        endpointId: "endpoint-auth-other",
        state: "active" as const,
        signingPublicKey: value.pair.publicKey,
      },
    ]) {
      await expect(
        verifyEndpointRequestProofWithIdentity({
          proof: value.proof,
          expectedMethod: "POST",
          expectedPath: "/api/private-vault/jobs/broker/claim",
          body: value.body,
          now,
          resolveAuthorizedEndpoint: async () => resolved,
          claimNonce: value.claimNonce,
        }),
      ).rejects.toMatchObject({ code: "unauthorized_endpoint" });
    }
    expect(value.claimNonce).not.toHaveBeenCalled();
  });

  it("pins the nonce retention margin beyond the proof acceptance window", () => {
    expect(E2EE_ENDPOINT_REQUEST_NONCE_RETENTION_SECONDS).toBe(360);
  });

  it("matches a fixed sodium-native request proof vector", async () => {
    const seed = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const body = encoder.encode('{"lease":"opaque"}');
    const proof = await createEndpointRequestProof({
      vaultId: "vault-auth-0001",
      endpointId: "endpoint-auth-0001",
      method: "POST",
      path: "/api/private-vault/jobs/broker/claim",
      body,
      issuedAt,
      nonce: "0123456789abcdef0123456789abcdef",
      signingPrivateKey: (await ancV1SigningKeypairFromSeed(seed)).privateKey,
    });

    const nativeBodyHash = Buffer.alloc(32);
    sodium.crypto_generichash(
      nativeBodyHash,
      Buffer.concat([
        Buffer.from(e2eeDomainSeparationPrefix("endpoint-request-body")),
        Buffer.from(body),
      ]),
      null,
    );
    expect(proof.bodyHash).toBe(nativeBodyHash.toString("hex"));

    const nativePublicKey = Buffer.alloc(sodium.crypto_sign_PUBLICKEYBYTES);
    const nativePrivateKey = Buffer.alloc(sodium.crypto_sign_SECRETKEYBYTES);
    sodium.crypto_sign_seed_keypair(
      nativePublicKey,
      nativePrivateKey,
      Buffer.from(seed),
    );
    const { signature: _signature, ...unsigned } = proof;
    const nativeSignature = Buffer.alloc(sodium.crypto_sign_BYTES);
    sodium.crypto_sign_detached(
      nativeSignature,
      Buffer.concat([
        Buffer.from(e2eeDomainSeparationPrefix("endpoint-request")),
        Buffer.from(encodeEndpointRequestUnsignedProof(unsigned)),
      ]),
      nativePrivateKey,
    );
    expect(proof.signature).toBe(nativeSignature.toString("hex"));

    expect(proof.bodyHash).toBe(
      "04529bc5771aa0e955c38045b880b3596817f557627443ae03438223b318997e",
    );
    expect(proof.signature).toBe(
      "fb81bddd278c8e55f998cac27de192c95341632b7ceea32f6d3e9c9f442adaea53c63a2cb5ea6d8adc153ae63a806174e7ff1d6d436c7e133897f78dc8e48608",
    );
  });
});
