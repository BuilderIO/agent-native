import { describe, expect, it } from "vitest";

import {
  decodeAndVerifyAncV1Grant,
  decodeAndVerifyAncV1GrantRevocation,
  AncV1GrantCodecError,
  sealAncV1Grant,
  sealAncV1GrantRevocation,
} from "./grant-codecs.js";
import { buildAncV1InteroperabilityVectors } from "./interoperability-vectors.js";
import { ancV1SigningKeypairFromSeed } from "./portable-crypto.js";
import { E2EE_SIZE_LIMITS } from "./suite.js";

const p = (byte: number, length = 16) => new Uint8Array(length).fill(byte);
const CREATED = 1_721_111_111;

describe("anc/v1 capability grant codecs", () => {
  it("reproduces and verifies the fixed signed grant exactly", async () => {
    const signing = await ancV1SigningKeypairFromSeed(p(0x11, 32));
    const encoded = await sealAncV1Grant({
      vaultId: p(0x01),
      envelopeId: p(0x16),
      createdAt: CREATED,
      grantId: p(0x05),
      issuerEndpointId: p(0x02),
      subjectAccountId: p(0x07),
      subjectEndpointId: p(0x03),
      subjectAgentId: p(0x08),
      resourceIds: [p(0x04)],
      operations: ["read", "summarize"],
      providers: ["synthetic-provider"],
      issuedAt: CREATED,
      expiresAt: CREATED + 3600,
      revocationRef: p(0x09),
      signingPrivateKey: signing.privateKey,
    });
    const vectors = await buildAncV1InteroperabilityVectors();
    expect(encoded).toEqual(vectors.vectors.grant);

    const decoded = await decodeAndVerifyAncV1Grant({
      encoded,
      expectedVaultId: p(0x01),
      nowSeconds: CREATED + 1,
      resolveIssuerSigningPublicKey: (issuer) => {
        expect(issuer).toEqual(p(0x02));
        return signing.publicKey;
      },
    });
    expect(decoded).toMatchObject({
      operations: ["read", "summarize"],
      providers: ["synthetic-provider"],
      subjectEndpointId: p(0x03),
      revocationRef: p(0x09),
    });
    expect(decoded.grantRef).toHaveLength(32);
  });

  it("rejects unknown issuers, expiry, wrong vaults, and unordered scope", async () => {
    const signing = await ancV1SigningKeypairFromSeed(p(0x11, 32));
    const base = {
      vaultId: p(0x01),
      envelopeId: p(0x16),
      createdAt: CREATED,
      grantId: p(0x05),
      issuerEndpointId: p(0x02),
      subjectAccountId: p(0x07),
      subjectEndpointId: p(0x03),
      subjectAgentId: null,
      resourceIds: [p(0x04)],
      operations: ["read"],
      providers: ["local"],
      issuedAt: CREATED,
      expiresAt: CREATED + 3600,
      revocationRef: p(0x09),
      signingPrivateKey: signing.privateKey,
    } as const;
    const encoded = await sealAncV1Grant(base);
    const open = (
      overrides: Partial<Parameters<typeof decodeAndVerifyAncV1Grant>[0]> = {},
    ) =>
      decodeAndVerifyAncV1Grant({
        encoded,
        expectedVaultId: p(0x01),
        nowSeconds: CREATED + 1,
        resolveIssuerSigningPublicKey: () => signing.publicKey,
        ...overrides,
      });
    await expect(
      open({ resolveIssuerSigningPublicKey: () => null }),
    ).rejects.toBeInstanceOf(AncV1GrantCodecError);
    await expect(open({ nowSeconds: CREATED + 3601 })).rejects.toBeInstanceOf(
      AncV1GrantCodecError,
    );
    await expect(open({ expectedVaultId: p(0xff) })).rejects.toBeInstanceOf(
      AncV1GrantCodecError,
    );
    await expect(
      sealAncV1Grant({ ...base, operations: ["write", "read"] }),
    ).rejects.toBeInstanceOf(AncV1GrantCodecError);
  });

  it("binds revocation to the exact grant, issuer, and preallocated reference", async () => {
    const signing = await ancV1SigningKeypairFromSeed(p(0x11, 32));
    const grant = await decodeAndVerifyAncV1Grant({
      encoded: (await buildAncV1InteroperabilityVectors()).vectors.grant,
      expectedVaultId: p(0x01),
      nowSeconds: CREATED + 1,
      resolveIssuerSigningPublicKey: () => signing.publicKey,
    });
    const encoded = await sealAncV1GrantRevocation({
      vaultId: p(0x01),
      envelopeId: p(0x31),
      createdAt: CREATED + 2,
      grantRef: grant.grantRef,
      revocationRef: grant.revocationRef,
      revokedAt: CREATED + 2,
      reason: "user_revoked",
      issuerEndpointId: grant.issuerEndpointId,
      signingPrivateKey: signing.privateKey,
    });
    await expect(
      decodeAndVerifyAncV1GrantRevocation({
        encoded,
        expectedVaultId: p(0x01),
        expectedGrant: grant,
        resolveIssuerSigningPublicKey: () => signing.publicKey,
      }),
    ).resolves.toMatchObject({
      reason: "user_revoked",
      grantRef: grant.grantRef,
    });
    await expect(
      decodeAndVerifyAncV1GrantRevocation({
        encoded,
        expectedVaultId: p(0x01),
        expectedGrant: { ...grant, revocationRef: p(0xee) },
        resolveIssuerSigningPublicKey: () => signing.publicKey,
      }),
    ).rejects.toBeInstanceOf(AncV1GrantCodecError);
    await expect(
      sealAncV1GrantRevocation({
        vaultId: p(0x01),
        envelopeId: p(0x31),
        createdAt: CREATED + 2,
        grantRef: grant.grantRef,
        revocationRef: grant.revocationRef,
        revokedAt: CREATED + 2,
        reason: "x".repeat(E2EE_SIZE_LIMITS.controlEnvelopeBytes),
        issuerEndpointId: grant.issuerEndpointId,
        signingPrivateKey: signing.privateKey,
      }),
    ).rejects.toBeInstanceOf(AncV1GrantCodecError);
  });
});
