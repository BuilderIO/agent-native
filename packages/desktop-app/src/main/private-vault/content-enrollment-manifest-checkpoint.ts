import { verifyAncV1EnrollmentManifestAuthorizationBundle } from "@agent-native/core/e2ee";

/**
 * Metadata obtained while fetching and decrypting the manifest object. These
 * values are deliberately not read from the hosted enrollment transcript: the
 * host is the rollback adversary this check is intended to constrain.
 */
export interface PrivateVaultTrustedEnrollmentManifestObject {
  readonly manifestObjectId: Uint8Array;
  readonly revisionId: Uint8Array;
  readonly generation: number;
  readonly ciphertextHash: Uint8Array;
}

/**
 * The desktop transport/native seam that H3 requires. Implementations must
 * obtain `manifest` from the exact fetched and successfully decrypted manifest
 * object, and `authorizerSigningPublicKey` from enrollment bootstrap state.
 * Neither value may be derived from a hosted enrollment response.
 */
export interface PrivateVaultEnrollmentManifestCheckpointSource {
  readCommittedManifestEvidence(input: {
    readonly vaultId: string;
    readonly encodedEnrollmentAuthorization: Uint8Array;
  }): Promise<Readonly<{
    readonly encodedManifestCheckpoint: Uint8Array;
    readonly encodedManifestAuthorization: Uint8Array;
    readonly authorizerSigningPublicKey: Uint8Array;
    readonly manifest: PrivateVaultTrustedEnrollmentManifestObject;
  }> | null>;
}

export class PrivateVaultEnrollmentManifestCheckpointError extends Error {
  constructor() {
    super("Private Vault enrollment manifest checkpoint could not be verified");
    this.name = "PrivateVaultEnrollmentManifestCheckpointError";
  }
}

function vaultIdBytes(vaultId: string): Uint8Array {
  if (!/^[0-9a-f]{32}$/i.test(vaultId)) throw new Error();
  return Uint8Array.from(Buffer.from(vaultId, "hex"));
}

/**
 * Fail-closed activation gate for enrollment. A valid signature alone is not
 * enough: the signed checkpoint must name the local trusted manifest bytes.
 */
export class PrivateVaultEnrollmentManifestCheckpointVerifier {
  readonly #source: PrivateVaultEnrollmentManifestCheckpointSource;
  readonly #now: () => number;

  constructor(input: {
    readonly source: PrivateVaultEnrollmentManifestCheckpointSource;
    readonly now?: () => number;
  }) {
    this.#source = input.source;
    this.#now = input.now ?? (() => Math.floor(Date.now() / 1000));
  }

  async verify(input: {
    readonly vaultId: string;
    readonly encodedEnrollmentAuthorization: Uint8Array;
  }): Promise<void> {
    try {
      const evidence = await this.#source.readCommittedManifestEvidence({
        vaultId: input.vaultId,
        encodedEnrollmentAuthorization:
          input.encodedEnrollmentAuthorization.slice(),
      });
      if (!evidence) throw new Error();
      await verifyAncV1EnrollmentManifestAuthorizationBundle({
        encodedEnrollmentAuthorization:
          input.encodedEnrollmentAuthorization.slice(),
        encodedManifestCheckpoint: evidence.encodedManifestCheckpoint.slice(),
        encodedManifestAuthorization:
          evidence.encodedManifestAuthorization.slice(),
        expectedVaultId: vaultIdBytes(input.vaultId),
        authorizerSigningPublicKey: evidence.authorizerSigningPublicKey.slice(),
        expectedManifestObjectId: evidence.manifest.manifestObjectId.slice(),
        expectedRevisionId: evidence.manifest.revisionId.slice(),
        expectedGeneration: evidence.manifest.generation,
        expectedCiphertextHash: evidence.manifest.ciphertextHash.slice(),
        now: this.#now(),
      });
    } catch {
      throw new PrivateVaultEnrollmentManifestCheckpointError();
    }
  }
}
