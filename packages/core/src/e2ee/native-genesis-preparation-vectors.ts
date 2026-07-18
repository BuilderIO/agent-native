import {
  type AncV1CanonicalValue,
  ancV1BytesToHex,
  encodeAncV1Canonical,
} from "./canonical.js";
import {
  type ControlLogMember,
  type ControlMembershipCommit,
  createSignedControlLogEntry,
  encodeSignedControlLogEntry,
} from "./control-log.js";
import {
  createAncV1GenesisBootstrapTranscript,
  encodeAncV1GenesisBootstrapTranscript,
  hashAncV1GenesisBootstrapTranscript,
} from "./genesis-bootstrap-transcript.js";
import {
  encodeAncV1GenesisAuthorization,
  encodeAncV1GenesisRecoveryConfirmation,
  hashAncV1GenesisRecoveryConfirmation,
  signAncV1GenesisAuthorization,
} from "./genesis-ceremony-codecs.js";
import {
  ancV1BoxKeypairFromSeed,
  ancV1Hash,
  ancV1RecoveryEntropyFromBip39Bytes,
  ancV1SignDetached,
  ancV1SigningKeypairFromSeed,
  ancV1VaultId,
} from "./portable-crypto.js";
import {
  createAncV1RecoveryWrap,
  deriveAncV1RecoveryAuthorityFromEntropy,
  encodeAncV1RecoveryWrap,
  hashAncV1RecoveryWrap,
} from "./recovery-ceremony-codecs.js";
import { E2EE_ENVELOPE_FIELDS as F, E2EE_SUITE_ID } from "./suite.js";

export const ANC_V1_NATIVE_GENESIS_PREPARATION_RECIPE = Object.freeze({
  schema: "anc/v1-native-genesis-preparation-runtime@1",
  syntheticInputs: "domain-hashed labels; materialized only at test runtime",
  timestamps: "wrap <= confirmation <= endpoint <= log <= authorization",
});

const utf8 = (value: string) => new TextEncoder().encode(value);
const material = (label: string) =>
  ancV1Hash(
    "recovery",
    utf8(`agent-native synthetic native genesis preparation ${label}`),
  );
const p16 = (byte: number) => new Uint8Array(16).fill(byte);

/** Test-only runtime oracle. Secret fields must be streamed, never persisted. */
export async function buildAncV1NativeGenesisPreparationRuntimeVector() {
  let recoveryEntropy: Uint8Array | undefined;
  let endpointSigningSeed: Uint8Array | undefined;
  let endpointAgreementSeed: Uint8Array | undefined;
  let eek: Uint8Array | undefined;
  let endpointSigning:
    | Awaited<ReturnType<typeof ancV1SigningKeypairFromSeed>>
    | undefined;
  let endpointAgreement:
    | Awaited<ReturnType<typeof ancV1BoxKeypairFromSeed>>
    | undefined;
  let recovery:
    | Awaited<ReturnType<typeof deriveAncV1RecoveryAuthorityFromEntropy>>
    | undefined;
  let completed = false;
  try {
    recoveryEntropy = await material("recovery entropy");
    endpointSigningSeed = await material("endpoint signing seed");
    endpointAgreementSeed = await material("endpoint agreement seed");
    eek = await material("epoch one eek");
    const vaultId = p16(1),
      ceremonyId = p16(2),
      endpointId = p16(3);
    const recoveryWrapEnvelopeId = p16(4),
      authorizationEnvelopeId = p16(5);
    const endpointEnvelopeId = p16(6),
      logEntryEnvelopeId = p16(7);
    const recoveryWrapNonce = new Uint8Array(24).fill(8);
    const times = [
      1721111080, 1721111100, 1721111110, 1721111120, 1721111130,
    ] as const;
    endpointSigning = await ancV1SigningKeypairFromSeed(endpointSigningSeed);
    endpointAgreement = await ancV1BoxKeypairFromSeed(endpointAgreementSeed);
    recovery = await deriveAncV1RecoveryAuthorityFromEntropy({
      recoveryEntropy: ancV1RecoveryEntropyFromBip39Bytes(recoveryEntropy),
      vaultId: ancV1VaultId(vaultId),
      recoveryGeneration: 1,
    });
    const recoveryWrap = encodeAncV1RecoveryWrap(
      await createAncV1RecoveryWrap(
        {
          suite: E2EE_SUITE_ID,
          vaultId,
          type: "recovery-wrap",
          createdAt: times[0],
          envelopeId: recoveryWrapEnvelopeId,
          ceremonyId,
          recoveryGeneration: 1,
          recoveryId: recovery.recoveryId,
          recoveryKeyAgreementPublicKey: recovery.keyAgreementPublicKey,
          epoch: 1,
          issuerEndpointId: endpointId,
          activationControlSequence: 0,
          activationPreviousHead: new Uint8Array(32),
          activationPreviousMembershipHash: new Uint8Array(32),
          nonce: recoveryWrapNonce,
          eek,
        },
        {
          issuerKeyAgreementPrivateKey: endpointAgreement.privateKey,
          issuerSigningPrivateKey: endpointSigning.privateKey,
        },
      ),
    );
    const recoveryWrapHash = await hashAncV1RecoveryWrap(recoveryWrap, vaultId);
    const recoveryConfirmation = encodeAncV1GenesisRecoveryConfirmation({
      suite: E2EE_SUITE_ID,
      vaultId,
      type: "genesis-recovery-confirmation",
      ceremonyId,
      endpointId,
      recoveryId: recovery.recoveryId,
      recoverySigningPublicKey: recovery.signingPublicKey,
      recoveryKeyAgreementPublicKey: recovery.keyAgreementPublicKey,
      recoveryWrapHash,
      confirmedAt: times[1],
      recoveryGeneration: 1,
    });
    const confirmationHash = await hashAncV1GenesisRecoveryConfirmation(
      recoveryConfirmation,
      vaultId,
    );
    const bootstrapTranscript = encodeAncV1GenesisBootstrapTranscript(
      await createAncV1GenesisBootstrapTranscript({
        vaultId,
        ceremonyId,
        endpointId,
        endpointSigningPublicKey: endpointSigning.publicKey,
        endpointKeyAgreementPublicKey: endpointAgreement.publicKey,
        enrollmentRef: authorizationEnvelopeId,
        recoveryConfirmation,
      }),
    );
    const bootstrapTranscriptDigest = await hashAncV1GenesisBootstrapTranscript(
      bootstrapTranscript,
      { expectedVaultId: vaultId },
    );
    const endpointUnsigned = new Map<number, AncV1CanonicalValue>([
      [F.common.suite, E2EE_SUITE_ID],
      [F.common.vaultId, vaultId],
      [F.common.type, "endpoint"],
      [F.common.createdAt, times[2]],
      [F.common.envelopeId, endpointEnvelopeId],
      [F.endpoint.endpointId, endpointId],
      [F.endpoint.role, "desktop"],
      [F.endpoint.unattended, false],
      [F.endpoint.signingPublicKey, endpointSigning.publicKey],
      [F.endpoint.keyAgreementPublicKey, endpointAgreement.publicKey],
      [F.endpoint.addedByEndpointId, endpointId],
      [F.endpoint.sasTranscriptHash, confirmationHash],
    ]);
    const endpointEnvelope = encodeAncV1Canonical(
      new Map([
        ...endpointUnsigned,
        [
          F.endpoint.signature,
          await ancV1SignDetached(
            "endpoint",
            encodeAncV1Canonical(endpointUnsigned),
            endpointSigning.privateKey,
          ),
        ],
      ]),
    );
    const member: ControlLogMember = {
      endpointId: ancV1BytesToHex(endpointId),
      role: "endpoint",
      unattended: false,
      signingPublicKey: ancV1BytesToHex(endpointSigning.publicKey),
      keyAgreementPublicKey: ancV1BytesToHex(endpointAgreement.publicKey),
      enrollmentRef: ancV1BytesToHex(authorizationEnvelopeId),
    };
    const commit: ControlMembershipCommit = {
      suite: E2EE_SUITE_ID,
      type: "membership_commit",
      vaultId: ancV1BytesToHex(vaultId),
      ceremonyId: ancV1BytesToHex(ceremonyId),
      ceremonyKind: "first_device",
      epoch: 1,
      previousMembershipHash: null,
      activeMembers: [member],
      removedEndpointIds: [],
      rotationCompleted: false,
      outstandingJobsResolved: false,
      recoverySnapshotHash: null,
      recoveryAuthorizationHash: null,
      recoveryGeneration: 1,
      recoveryId: ancV1BytesToHex(recovery.recoveryId),
      recoverySigningPublicKey: ancV1BytesToHex(recovery.signingPublicKey),
      recoveryKeyAgreementPublicKey: ancV1BytesToHex(
        recovery.keyAgreementPublicKey,
      ),
      recoveryWrapHash: ancV1BytesToHex(recoveryWrapHash),
    };
    const signedGenesisCommit = encodeSignedControlLogEntry(
      await createSignedControlLogEntry({
        vaultId: commit.vaultId,
        createdAt: new Date(times[3] * 1000).toISOString(),
        envelopeId: ancV1BytesToHex(logEntryEnvelopeId),
        sequence: 0,
        previousHash: "00".repeat(32),
        innerEnvelope: commit,
        signerEndpointId: member.endpointId,
        signingPrivateKey: endpointSigning.privateKey,
      }),
    );
    const authorization = encodeAncV1GenesisAuthorization(
      await signAncV1GenesisAuthorization(
        {
          suite: E2EE_SUITE_ID,
          vaultId,
          type: "genesis-authorization",
          createdAt: times[4],
          envelopeId: authorizationEnvelopeId,
          ceremonyId,
          endpointId,
          epoch: 1,
          endpointEnvelope,
          recoveryConfirmation,
          signedGenesisCommit,
        },
        endpointSigning.privateKey,
      ),
    );
    const result = {
      secretInputs: [
        recoveryEntropy,
        endpointSigningSeed,
        endpointAgreementSeed,
        eek,
      ],
      publicInputs: [
        vaultId,
        ceremonyId,
        endpointId,
        recoveryWrapEnvelopeId,
        authorizationEnvelopeId,
        endpointEnvelopeId,
        logEntryEnvelopeId,
        recoveryWrapNonce,
      ],
      times,
      expected: [
        recoveryWrap,
        recoveryConfirmation,
        bootstrapTranscript,
        authorization,
        bootstrapTranscriptDigest,
      ],
    };
    completed = true;
    return result;
  } finally {
    endpointSigning?.privateKey.fill(0);
    endpointAgreement?.privateKey.fill(0);
    recovery?.signingPrivateKey.fill(0);
    recovery?.keyAgreementPrivateKey.fill(0);
    if (!completed) {
      recoveryEntropy?.fill(0);
      endpointSigningSeed?.fill(0);
      endpointAgreementSeed?.fill(0);
      eek?.fill(0);
    }
  }
}
