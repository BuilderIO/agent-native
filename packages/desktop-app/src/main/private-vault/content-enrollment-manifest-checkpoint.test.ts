import {
  ancV1Hash,
  ancV1SigningKeypairFromSeed,
  encodeAncV1Canonical,
  encodeAncV1EnrollmentAuthorization,
  encodeAncV1EnrollmentManifestAuthorization,
  encodeAncV1PrivateVaultManifestCheckpoint,
  hashAncV1PrivateVaultManifestCheckpoint,
  signAncV1EnrollmentAuthorization,
  signAncV1EnrollmentManifestAuthorization,
  signAncV1PrivateVaultManifestCheckpoint,
  type AncV1UnsignedEnrollmentAuthorization,
  ANC_ENROLLMENT_MANIFEST_SUITE_ID,
  E2EE_SUITE_ID,
} from "@agent-native/core/e2ee";
import { describe, expect, it, vi } from "vitest";

import {
  PrivateVaultEnrollmentManifestCheckpointError,
  PrivateVaultEnrollmentManifestCheckpointVerifier,
} from "./content-enrollment-manifest-checkpoint.js";

const fill = (value: number, length: number) =>
  new Uint8Array(length).fill(value);
const vaultId = fill(1, 16);
const vaultIdHex = Buffer.from(vaultId).toString("hex");
const authorizerId = fill(2, 16);
const manifestObjectId = fill(3, 16);
const revisionId = fill(4, 32);
const ciphertextHash = fill(5, 32);
const now = 1_721_111_200;

async function evidence() {
  const authorizer = await ancV1SigningKeypairFromSeed(fill(6, 32));
  const component = (key: number) =>
    encodeAncV1Canonical(new Map([[key, fill(key, 16)]]));
  const enrollment: AncV1UnsignedEnrollmentAuthorization = {
    suite: E2EE_SUITE_ID,
    vaultId,
    type: "enrollment-authorization",
    createdAt: now - 50,
    envelopeId: fill(7, 16),
    offerHash: fill(8, 32),
    challengeHash: fill(9, 32),
    authorizerEndpointId: authorizerId,
    targetMembershipRole: "endpoint",
    previousControlSequence: 1,
    previousControlHeadHash: fill(10, 32),
    previousMembershipHash: fill(11, 32),
    endpointEnvelope: component(1),
    eekWrapEnvelope: component(2),
    signedMembershipCommit: component(3),
    expiresAt: now + 500,
  };
  const encodedEnrollmentAuthorization = encodeAncV1EnrollmentAuthorization(
    await signAncV1EnrollmentAuthorization(enrollment, authorizer.privateKey),
  );
  const encodedManifestCheckpoint = encodeAncV1PrivateVaultManifestCheckpoint(
    await signAncV1PrivateVaultManifestCheckpoint(
      {
        suite: ANC_ENROLLMENT_MANIFEST_SUITE_ID,
        vaultId,
        type: "private-vault-manifest-checkpoint",
        createdAt: now - 25,
        envelopeId: fill(12, 16),
        manifestObjectId,
        revisionId,
        generation: 7,
        ciphertextHash,
        signerEndpointId: authorizerId,
      },
      authorizer.privateKey,
    ),
  );
  const encodedManifestAuthorization =
    encodeAncV1EnrollmentManifestAuthorization(
      await signAncV1EnrollmentManifestAuthorization(
        {
          suite: ANC_ENROLLMENT_MANIFEST_SUITE_ID,
          vaultId,
          type: "enrollment-manifest-authorization",
          createdAt: now,
          envelopeId: fill(13, 16),
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
      ),
    );
  return {
    encodedEnrollmentAuthorization,
    encodedManifestCheckpoint,
    encodedManifestAuthorization,
    authorizerSigningPublicKey: authorizer.publicKey,
  };
}

describe("enrollment manifest checkpoint activation gate", () => {
  it("accepts an exact trusted manifest with the production seconds clock", async () => {
    const signed = await evidence();
    const date = vi.spyOn(Date, "now").mockReturnValue(now * 1000);
    const verifier = new PrivateVaultEnrollmentManifestCheckpointVerifier({
      source: {
        readCommittedManifestEvidence: vi.fn(async () => ({
          ...signed,
          manifest: {
            manifestObjectId,
            revisionId,
            generation: 7,
            ciphertextHash,
          },
        })),
      },
    });

    await expect(
      verifier.verify({
        vaultId: vaultIdHex,
        encodedEnrollmentAuthorization: signed.encodedEnrollmentAuthorization,
      }),
    ).resolves.toBeUndefined();
    date.mockRestore();
  });

  it("rejects a valid authorizer-signed checkpoint when the fetched manifest is stale", async () => {
    const signed = await evidence();
    const source = {
      readCommittedManifestEvidence: vi.fn(async () => ({
        ...signed,
        manifest: {
          manifestObjectId,
          revisionId: fill(0xee, 32),
          generation: 6,
          ciphertextHash: fill(0xdd, 32),
        },
      })),
    };
    const verifier = new PrivateVaultEnrollmentManifestCheckpointVerifier({
      source,
      now: () => now,
    });

    await expect(
      verifier.verify({
        vaultId: vaultIdHex,
        encodedEnrollmentAuthorization: signed.encodedEnrollmentAuthorization,
      }),
    ).rejects.toBeInstanceOf(PrivateVaultEnrollmentManifestCheckpointError);
  });

  it("fails closed when the hosted path cannot supply checkpoint evidence", async () => {
    const verifier = new PrivateVaultEnrollmentManifestCheckpointVerifier({
      source: { readCommittedManifestEvidence: vi.fn(async () => null) },
      now: () => now,
    });

    await expect(
      verifier.verify({
        vaultId: vaultIdHex,
        encodedEnrollmentAuthorization: fill(0, 1),
      }),
    ).rejects.toBeInstanceOf(PrivateVaultEnrollmentManifestCheckpointError);
  });
});
