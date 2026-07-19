import { describe, expect, it } from "vitest";

import {
  type AncV1CanonicalValue,
  ancV1BytesToHex,
  decodeAncV1Canonical,
  encodeAncV1Canonical,
} from "./canonical.js";
import {
  type AncV1UnsignedEnrollmentAuthorization,
  encodeAncV1EnrollmentAuthorization,
  signAncV1EnrollmentAuthorization,
} from "./enrollment-ceremony-codecs.js";
import {
  AncV1ManifestCheckpointError,
  ANC_ENROLLMENT_MANIFEST_FIELDS,
  ANC_ENROLLMENT_MANIFEST_SUITE_ID,
  decodeAncV1EnrollmentManifestAuthorization,
  decodeAncV1PrivateVaultManifestCheckpoint,
  encodeAncV1EnrollmentManifestAuthorization,
  encodeAncV1PrivateVaultManifestCheckpoint,
  hashAncV1PrivateVaultManifestCheckpoint,
  signAncV1EnrollmentManifestAuthorization,
  signAncV1PrivateVaultManifestCheckpoint,
  verifyAncV1EnrollmentManifestAuthorizationBundle,
  verifyAncV1PrivateVaultManifestCheckpoint,
} from "./manifest-checkpoint-codecs.js";
import { ANC_ENROLLMENT_MANIFEST_VECTOR_HEX } from "./manifest-checkpoint-vectors.js";
import { ancV1Hash, ancV1SigningKeypairFromSeed } from "./portable-crypto.js";
import { E2EE_ENVELOPE_FIELDS, E2EE_SUITE_ID } from "./suite.js";

const p = (byte: number, length: number) => new Uint8Array(length).fill(byte);
const vaultId = p(0x01, 16);
const authorizerId = p(0x02, 16);
const manifestObjectId = p(0x31, 16);
const revisionId = p(0x32, 32);
const ciphertextHash = p(0x33, 32);
const now = 1_721_111_200;

function map(encoded: Uint8Array): Map<number, AncV1CanonicalValue> {
  return decodeAncV1Canonical(encoded) as Map<number, AncV1CanonicalValue>;
}

function mutate(
  encoded: Uint8Array,
  key: number,
  value: AncV1CanonicalValue,
): Uint8Array {
  const decoded = map(encoded);
  decoded.set(key, value);
  return encodeAncV1Canonical(decoded);
}

async function fixture() {
  const authorizer = await ancV1SigningKeypairFromSeed(p(0x11, 32));
  const component = (key: number) =>
    encodeAncV1Canonical(new Map([[key, p(key, 16)]]));
  const unsignedAuthorization: AncV1UnsignedEnrollmentAuthorization = {
    suite: E2EE_SUITE_ID,
    vaultId,
    type: "enrollment-authorization",
    createdAt: now - 50,
    envelopeId: p(0x10, 16),
    offerHash: p(0x20, 32),
    challengeHash: p(0x21, 32),
    authorizerEndpointId: authorizerId,
    targetMembershipRole: "endpoint",
    previousControlSequence: 9,
    previousControlHeadHash: p(0x22, 32),
    previousMembershipHash: p(0x23, 32),
    endpointEnvelope: component(1),
    eekWrapEnvelope: component(2),
    signedMembershipCommit: component(3),
    expiresAt: now + 500,
  };
  const encodedEnrollmentAuthorization = encodeAncV1EnrollmentAuthorization(
    await signAncV1EnrollmentAuthorization(
      unsignedAuthorization,
      authorizer.privateKey,
    ),
  );
  const checkpoint = await signAncV1PrivateVaultManifestCheckpoint(
    {
      suite: ANC_ENROLLMENT_MANIFEST_SUITE_ID,
      vaultId,
      type: "private-vault-manifest-checkpoint",
      createdAt: now - 25,
      envelopeId: p(0x30, 16),
      manifestObjectId,
      revisionId,
      generation: 7,
      ciphertextHash,
      signerEndpointId: authorizerId,
    },
    authorizer.privateKey,
  );
  const encodedManifestCheckpoint =
    encodeAncV1PrivateVaultManifestCheckpoint(checkpoint);
  const manifestAuthorization = await signAncV1EnrollmentManifestAuthorization(
    {
      suite: ANC_ENROLLMENT_MANIFEST_SUITE_ID,
      vaultId,
      type: "enrollment-manifest-authorization",
      createdAt: now,
      envelopeId: p(0x34, 16),
      enrollmentAuthorizationHash: await ancV1Hash(
        "enrollment-authorization",
        encodedEnrollmentAuthorization,
      ),
      manifestCheckpointHash: await hashAncV1PrivateVaultManifestCheckpoint(
        encodedManifestCheckpoint,
        vaultId,
      ),
      authorizerEndpointId: authorizerId,
      expiresAt: now + 400,
    },
    authorizer.privateKey,
  );
  return {
    authorizer,
    checkpoint,
    manifestAuthorization,
    encodedEnrollmentAuthorization,
    encodedManifestCheckpoint,
    encodedManifestAuthorization: encodeAncV1EnrollmentManifestAuthorization(
      manifestAuthorization,
    ),
  };
}

function verificationInput(value: Awaited<ReturnType<typeof fixture>>) {
  return {
    encodedEnrollmentAuthorization: value.encodedEnrollmentAuthorization,
    encodedManifestCheckpoint: value.encodedManifestCheckpoint,
    encodedManifestAuthorization: value.encodedManifestAuthorization,
    expectedVaultId: vaultId,
    authorizerSigningPublicKey: value.authorizer.publicKey,
    expectedManifestObjectId: manifestObjectId,
    expectedRevisionId: revisionId,
    expectedGeneration: 7,
    expectedCiphertextHash: ciphertextHash,
    now,
  };
}

describe("anc/v1 Private Vault manifest checkpoint", () => {
  it("pins canonical endpoint-signed checkpoint and enrollment binding vectors", async () => {
    const value = await fixture();
    expect(ancV1BytesToHex(value.encodedManifestCheckpoint)).toBe(
      ANC_ENROLLMENT_MANIFEST_VECTOR_HEX.checkpoint,
    );
    expect(ancV1BytesToHex(value.encodedManifestAuthorization)).toBe(
      ANC_ENROLLMENT_MANIFEST_VECTOR_HEX.authorization,
    );
    expect(
      encodeAncV1PrivateVaultManifestCheckpoint(
        decodeAncV1PrivateVaultManifestCheckpoint(
          value.encodedManifestCheckpoint,
          { expectedVaultId: vaultId },
        ),
      ),
    ).toEqual(value.encodedManifestCheckpoint);
  });

  it("verifies the complete enrollment-bound checkpoint bundle", async () => {
    const value = await fixture();
    const verified = await verifyAncV1EnrollmentManifestAuthorizationBundle(
      verificationInput(value),
    );
    expect(verified.manifestCheckpoint.generation).toBe(7);
    expect(verified.manifestCheckpoint.ciphertextHash).toEqual(ciphertextHash);
  });

  it("verifies the checkpoint signature independently", async () => {
    const value = await fixture();
    await expect(
      verifyAncV1PrivateVaultManifestCheckpoint(
        value.encodedManifestCheckpoint,
        {
          expectedVaultId: vaultId,
          signerSigningPublicKey: value.authorizer.publicKey,
        },
      ),
    ).resolves.toEqual(value.checkpoint);
    const substituted = value.encodedManifestCheckpoint.slice();
    substituted[substituted.length - 1] ^= 1;
    await expect(
      verifyAncV1PrivateVaultManifestCheckpoint(substituted, {
        expectedVaultId: vaultId,
        signerSigningPublicKey: value.authorizer.publicKey,
      }),
    ).rejects.toThrow(/signature verification failed/);
  });

  it.each([
    ["wrong vault", { expectedVaultId: p(0xff, 16) }],
    ["wrong object", { expectedManifestObjectId: p(0xff, 16) }],
    ["wrong revision", { expectedRevisionId: p(0xff, 32) }],
    ["wrong generation", { expectedGeneration: 8 }],
    ["wrong ciphertext hash", { expectedCiphertextHash: p(0xff, 32) }],
  ])("rejects %s substitution", async (_name, replacement) => {
    const value = await fixture();
    await expect(
      verifyAncV1EnrollmentManifestAuthorizationBundle({
        ...verificationInput(value),
        ...replacement,
      }),
    ).rejects.toThrow();
  });

  it("rejects checkpoint or legacy authorization substitution", async () => {
    const value = await fixture();
    const changedCheckpoint = mutate(
      value.encodedManifestCheckpoint,
      ANC_ENROLLMENT_MANIFEST_FIELDS.checkpoint.generation,
      8,
    );
    await expect(
      verifyAncV1EnrollmentManifestAuthorizationBundle({
        ...verificationInput(value),
        encodedManifestCheckpoint: changedCheckpoint,
      }),
    ).rejects.toBeInstanceOf(AncV1ManifestCheckpointError);
    const changedAuthorization = value.encodedEnrollmentAuthorization.slice();
    changedAuthorization[changedAuthorization.length - 1] ^= 1;
    await expect(
      verifyAncV1EnrollmentManifestAuthorizationBundle({
        ...verificationInput(value),
        encodedEnrollmentAuthorization: changedAuthorization,
      }),
    ).rejects.toThrow();
  });

  it("rejects binding signature substitution and expired or future bindings", async () => {
    const value = await fixture();
    const changedBinding = value.encodedManifestAuthorization.slice();
    changedBinding[changedBinding.length - 1] ^= 1;
    await expect(
      verifyAncV1EnrollmentManifestAuthorizationBundle({
        ...verificationInput(value),
        encodedManifestAuthorization: changedBinding,
      }),
    ).rejects.toThrow(/signature verification failed/);
    await expect(
      verifyAncV1EnrollmentManifestAuthorizationBundle({
        ...verificationInput(value),
        now: value.manifestAuthorization.expiresAt + 1,
      }),
    ).rejects.toThrow(/not bound to this live enrollment authorization/);
    await expect(
      verifyAncV1EnrollmentManifestAuthorizationBundle({
        ...verificationInput(value),
        now: value.manifestAuthorization.createdAt - 1,
      }),
    ).rejects.toThrow(/not bound to this live enrollment authorization/);
  });

  it("makes every artifact mandatory and rejects unknown input aliases", async () => {
    const value = await fixture();
    const omitted = verificationInput(value) as Record<string, unknown>;
    delete omitted.encodedManifestCheckpoint;
    await expect(
      verifyAncV1EnrollmentManifestAuthorizationBundle(omitted as never),
    ).rejects.toThrow(/exactly its versioned fields/);
    await expect(
      verifyAncV1EnrollmentManifestAuthorizationBundle({
        ...verificationInput(value),
        challengeHash: p(0x44, 32),
      } as never),
    ).rejects.toThrow(/exactly its versioned fields/);
  });

  it("rejects missing, unknown, non-canonical, and oversized checkpoint encodings", async () => {
    const value = await fixture();
    const fields = ANC_ENROLLMENT_MANIFEST_FIELDS.checkpoint;
    const missing = map(value.encodedManifestCheckpoint);
    missing.delete(fields.ciphertextHash);
    expect(() =>
      decodeAncV1PrivateVaultManifestCheckpoint(encodeAncV1Canonical(missing), {
        expectedVaultId: vaultId,
      }),
    ).toThrow(/ciphertextHash is required/);
    expect(() =>
      decodeAncV1PrivateVaultManifestCheckpoint(
        mutate(value.encodedManifestCheckpoint, 799, p(0x01, 1)),
        { expectedVaultId: vaultId },
      ),
    ).toThrow(/unknown key/);
    expect(() =>
      decodeAncV1PrivateVaultManifestCheckpoint(
        mutate(
          value.encodedManifestCheckpoint,
          ANC_ENROLLMENT_MANIFEST_FIELDS.checkpoint.revisionId,
          p(0x01, 16),
        ),
        { expectedVaultId: vaultId },
      ),
    ).toThrow(/32 bytes/);
    const nonCanonical = new Uint8Array(
      value.encodedManifestCheckpoint.byteLength + 1,
    );
    nonCanonical.set(value.encodedManifestCheckpoint);
    expect(() =>
      decodeAncV1PrivateVaultManifestCheckpoint(nonCanonical, {
        expectedVaultId: vaultId,
      }),
    ).toThrow();
    expect(() =>
      decodeAncV1PrivateVaultManifestCheckpoint(new Uint8Array(1_025), {
        expectedVaultId: vaultId,
      }),
    ).toThrow(/exceeds 1024 bytes/);
  });

  it("rejects malformed binding hashes and preserves exact decoding", async () => {
    const value = await fixture();
    expect(
      encodeAncV1EnrollmentManifestAuthorization(
        decodeAncV1EnrollmentManifestAuthorization(
          value.encodedManifestAuthorization,
          { expectedVaultId: vaultId },
        ),
      ),
    ).toEqual(value.encodedManifestAuthorization);
    expect(() =>
      decodeAncV1EnrollmentManifestAuthorization(
        mutate(
          value.encodedManifestAuthorization,
          ANC_ENROLLMENT_MANIFEST_FIELDS.authorization.manifestCheckpointHash,
          p(0x01, 31),
        ),
        { expectedVaultId: vaultId },
      ),
    ).toThrow(/32 bytes/);
  });
});
