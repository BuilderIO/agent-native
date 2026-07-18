import sodium from "libsodium-wrappers-sumo";

import {
  type AncV1CanonicalValue,
  ancV1HexToBytes,
  encodeAncV1Canonical,
} from "./canonical.js";
import { encodeAncV1EndpointEnrollmentOffer } from "./lifecycle-codecs.js";
import {
  ancV1AeadEncrypt,
  ancV1BoxEncrypt,
  ancV1BoxKeypairFromSeed,
  ancV1Hash,
  ancV1PackNonceCiphertext,
  ancV1SignDetached,
  ancV1SigningKeypairFromSeed,
} from "./portable-crypto.js";
import {
  type E2EEDomainTag,
  E2EE_ENVELOPE_FIELDS,
  E2EE_SUITE_ID,
} from "./suite.js";

export const ANC_V1_VECTOR_NAMES = [
  "endpoint",
  "epoch",
  "eek-wrap",
  "dek-wrap",
  "object-header",
  "chunk",
  "grant",
  "disclosure",
  "job",
  "result",
  "log-entry",
  "manifest",
  "recovery",
  "tombstone",
] as const;

export type AncV1VectorName = (typeof ANC_V1_VECTOR_NAMES)[number];

/** Obvious repeated-byte material reserved exclusively for fixed tests. */
export const ANC_V1_SYNTHETIC_PATTERNS = Object.freeze({
  signingSeed: 0x11,
  senderBoxSeed: 0x22,
  recipientBoxSeed: 0x33,
  eek: 0x44,
  dek: 0x55,
  chunkKey: 0x66,
  eekWrapNonce: 0x91,
  dekWrapNonce: 0x92,
  jobNonce: 0x93,
  resultNonce: 0x94,
  recoverySalt: 0xa1,
  recoveryNonce: 0xa2,
});

export function ancV1PatternBytes(byte: number, length: number): Uint8Array {
  if (!Number.isInteger(byte) || byte < 0 || byte > 255 || length < 0) {
    throw new Error(
      "Synthetic pattern requires a byte and non-negative length",
    );
  }
  return new Uint8Array(length).fill(byte);
}

const text = (value: string) => new TextEncoder().encode(value);
const fixtureId = (byte: number) => ancV1PatternBytes(byte, 16);
const FIXED_CREATED_AT = 1_721_111_111;
const VAULT_ID = fixtureId(0x01);
const ENDPOINT_ID = fixtureId(0x02);
const RECIPIENT_ENDPOINT_ID = fixtureId(0x03);
const OBJECT_ID = fixtureId(0x04);
const GRANT_ID = fixtureId(0x05);
const JOB_ID = fixtureId(0x06);

/** Fixed-input compatibility materializer for the frozen synthetic corpus. */
async function fixedSyntheticRecoveryVectorKey(): Promise<Uint8Array> {
  await sodium.ready;
  const password = text("synthetic recovery phrase for fixed vectors only");
  const salt = ancV1PatternBytes(ANC_V1_SYNTHETIC_PATTERNS.recoverySalt, 16);
  try {
    return sodium.crypto_pwhash(
      32,
      password,
      salt,
      2,
      67_108_864,
      sodium.crypto_pwhash_ALG_ARGON2ID13,
    );
  } finally {
    password.fill(0);
    salt.fill(0);
  }
}

// Secretstream does not expose deterministic header injection. These values
// are one pinned, synthetic libsodium output generated from the 0x66 key and
// the chunk AAD/plaintext below; interoperability tests only decrypt it.
export const ANC_V1_FIXED_SECRETSTREAM_HEADER_HEX =
  "3f5fda67e8463e269d11c141f228d3921570da36f06db90d";
export const ANC_V1_FIXED_SECRETSTREAM_CIPHERTEXT_HEX =
  "03f8b067a34acb2883703117670be1a0e10b6255798ce738db867e8aff6732b021a168c3470c";

function commonEnvelope(
  type: AncV1VectorName,
  envelopeByte: number,
): Map<number, AncV1CanonicalValue> {
  return new Map<number, AncV1CanonicalValue>([
    [E2EE_ENVELOPE_FIELDS.common.suite, E2EE_SUITE_ID],
    [E2EE_ENVELOPE_FIELDS.common.vaultId, VAULT_ID],
    [E2EE_ENVELOPE_FIELDS.common.type, type],
    [E2EE_ENVELOPE_FIELDS.common.createdAt, FIXED_CREATED_AT],
    [E2EE_ENVELOPE_FIELDS.common.envelopeId, fixtureId(envelopeByte)],
  ]);
}

function withEntries(
  base: Map<number, AncV1CanonicalValue>,
  entries: readonly (readonly [number, AncV1CanonicalValue])[],
): Map<number, AncV1CanonicalValue> {
  return new Map([...base, ...entries]);
}

async function signedEnvelope(
  tag: E2EEDomainTag,
  unsigned: Map<number, AncV1CanonicalValue>,
  signatureField: number,
  privateKey: Uint8Array,
): Promise<Uint8Array> {
  const signature = await ancV1SignDetached(
    tag,
    encodeAncV1Canonical(unsigned),
    privateKey,
  );
  return encodeAncV1Canonical(
    withEntries(unsigned, [[signatureField, signature]]),
  );
}

export interface AncV1InteroperabilityVectorSet {
  vectors: Record<AncV1VectorName, Uint8Array>;
  lifecycleVectors: {
    enrollmentOffer: Uint8Array;
    recovery: Uint8Array;
  };
  materials: {
    signingPublicKey: Uint8Array;
    senderBoxPublicKey: Uint8Array;
    senderBoxPrivateKey: Uint8Array;
    recipientBoxPublicKey: Uint8Array;
    recipientBoxPrivateKey: Uint8Array;
    eek: Uint8Array;
    dek: Uint8Array;
    chunkKey: Uint8Array;
    recoveryKey: Uint8Array;
    chunkAad: Uint8Array;
  };
}

/** Build the fixed anc/v1 corpus without installing any key-custody runtime. */
export async function buildAncV1InteroperabilityVectors(): Promise<AncV1InteroperabilityVectorSet> {
  const signing = await ancV1SigningKeypairFromSeed(
    ancV1PatternBytes(ANC_V1_SYNTHETIC_PATTERNS.signingSeed, 32),
  );
  const senderBox = await ancV1BoxKeypairFromSeed(
    ancV1PatternBytes(ANC_V1_SYNTHETIC_PATTERNS.senderBoxSeed, 32),
  );
  const recipientBox = await ancV1BoxKeypairFromSeed(
    ancV1PatternBytes(ANC_V1_SYNTHETIC_PATTERNS.recipientBoxSeed, 32),
  );
  const eek = ancV1PatternBytes(ANC_V1_SYNTHETIC_PATTERNS.eek, 32);
  const dek = ancV1PatternBytes(ANC_V1_SYNTHETIC_PATTERNS.dek, 32);
  const chunkKey = ancV1PatternBytes(ANC_V1_SYNTHETIC_PATTERNS.chunkKey, 32);

  const endpointUnsigned = withEntries(commonEnvelope("endpoint", 0x10), [
    [E2EE_ENVELOPE_FIELDS.endpoint.endpointId, ENDPOINT_ID],
    [E2EE_ENVELOPE_FIELDS.endpoint.role, "desktop"],
    [E2EE_ENVELOPE_FIELDS.endpoint.unattended, false],
    [E2EE_ENVELOPE_FIELDS.endpoint.signingPublicKey, signing.publicKey],
    [E2EE_ENVELOPE_FIELDS.endpoint.keyAgreementPublicKey, senderBox.publicKey],
    [E2EE_ENVELOPE_FIELDS.endpoint.addedByEndpointId, ENDPOINT_ID],
    [
      E2EE_ENVELOPE_FIELDS.endpoint.sasTranscriptHash,
      await ancV1Hash("endpoint", text("synthetic SAS transcript")),
    ],
  ]);
  const endpoint = await signedEnvelope(
    "endpoint",
    endpointUnsigned,
    E2EE_ENVELOPE_FIELDS.endpoint.signature,
    signing.privateKey,
  );

  const enrollmentOffer = encodeAncV1EndpointEnrollmentOffer({
    suite: E2EE_SUITE_ID,
    vaultId: VAULT_ID,
    type: "enrollment-offer",
    createdAt: FIXED_CREATED_AT,
    envelopeId: fixtureId(0x0e),
    endpointId: RECIPIENT_ENDPOINT_ID,
    ceremonyId: fixtureId(0x0c),
    membershipRole: "endpoint",
    unattended: false,
    signingPublicKey: signing.publicKey,
    keyAgreementPublicKey: recipientBox.publicKey,
    enrollmentNonce: ancV1PatternBytes(0xa5, 32),
    expiresAt: FIXED_CREATED_AT + 600,
  });

  const epochUnsigned = withEntries(commonEnvelope("epoch", 0x11), [
    [E2EE_ENVELOPE_FIELDS.epoch.epoch, 7],
    [
      E2EE_ENVELOPE_FIELDS.epoch.authorizedEndpointIds,
      [ENDPOINT_ID, RECIPIENT_ENDPOINT_ID],
    ],
    [E2EE_ENVELOPE_FIELDS.epoch.reason, "synthetic_rotation"],
  ]);
  const epoch = await signedEnvelope(
    "epoch",
    epochUnsigned,
    E2EE_ENVELOPE_FIELDS.epoch.signature,
    signing.privateKey,
  );

  const eekWrapNonce = ancV1PatternBytes(
    ANC_V1_SYNTHETIC_PATTERNS.eekWrapNonce,
    24,
  );
  const eekCiphertext = await ancV1BoxEncrypt(
    "eek-wrap",
    eek,
    eekWrapNonce,
    recipientBox.publicKey,
    senderBox.privateKey,
  );
  const eekWrapUnsigned = withEntries(commonEnvelope("eek-wrap", 0x12), [
    [E2EE_ENVELOPE_FIELDS.eekWrap.epoch, 7],
    [E2EE_ENVELOPE_FIELDS.eekWrap.recipientEndpointId, RECIPIENT_ENDPOINT_ID],
    [E2EE_ENVELOPE_FIELDS.eekWrap.issuerEndpointId, ENDPOINT_ID],
    [E2EE_ENVELOPE_FIELDS.eekWrap.nonce, eekWrapNonce],
    [E2EE_ENVELOPE_FIELDS.eekWrap.ciphertext, eekCiphertext],
  ]);
  const eekWrap = await signedEnvelope(
    "eek-wrap",
    eekWrapUnsigned,
    E2EE_ENVELOPE_FIELDS.eekWrap.signature,
    signing.privateKey,
  );

  const dekWrapNonce = ancV1PatternBytes(
    ANC_V1_SYNTHETIC_PATTERNS.dekWrapNonce,
    24,
  );
  const dekWrapAad = withEntries(commonEnvelope("dek-wrap", 0x13), [
    [E2EE_ENVELOPE_FIELDS.dekWrap.objectId, OBJECT_ID],
    [E2EE_ENVELOPE_FIELDS.dekWrap.revision, 3],
    [E2EE_ENVELOPE_FIELDS.dekWrap.epoch, 7],
    [E2EE_ENVELOPE_FIELDS.dekWrap.nonce, dekWrapNonce],
  ]);
  const dekWrap = encodeAncV1Canonical(
    withEntries(dekWrapAad, [
      [
        E2EE_ENVELOPE_FIELDS.dekWrap.ciphertext,
        await ancV1AeadEncrypt(
          "dek-wrap",
          dek,
          encodeAncV1Canonical(dekWrapAad),
          dekWrapNonce,
          eek,
        ),
      ],
    ]),
  );

  const objectHeaderUnsigned = withEntries(
    commonEnvelope("object-header", 0x14),
    [
      [E2EE_ENVELOPE_FIELDS.objectHeader.objectId, OBJECT_ID],
      [E2EE_ENVELOPE_FIELDS.objectHeader.revision, 3],
      [E2EE_ENVELOPE_FIELDS.objectHeader.epoch, 7],
      [E2EE_ENVELOPE_FIELDS.objectHeader.chunkCount, 1],
      [E2EE_ENVELOPE_FIELDS.objectHeader.plaintextLength, 21],
      [
        E2EE_ENVELOPE_FIELDS.objectHeader.contentType,
        "application/octet-stream",
      ],
      [
        E2EE_ENVELOPE_FIELDS.objectHeader.dekWrapRef,
        await ancV1Hash("dek-wrap", dekWrap),
      ],
      [E2EE_ENVELOPE_FIELDS.objectHeader.writerEndpointId, ENDPOINT_ID],
    ],
  );
  const objectHeader = await signedEnvelope(
    "object-header",
    objectHeaderUnsigned,
    E2EE_ENVELOPE_FIELDS.objectHeader.signature,
    signing.privateKey,
  );

  const chunkAad = encodeAncV1Canonical(
    new Map<number, AncV1CanonicalValue>([
      [E2EE_ENVELOPE_FIELDS.objectHeader.objectId, OBJECT_ID],
      [E2EE_ENVELOPE_FIELDS.objectHeader.revision, 3],
      [E2EE_ENVELOPE_FIELDS.chunk.chunkIndex, 0],
      [E2EE_ENVELOPE_FIELDS.chunk.chunkCount, 1],
    ]),
  );
  const chunk = encodeAncV1Canonical(
    withEntries(commonEnvelope("chunk", 0x15), [
      [E2EE_ENVELOPE_FIELDS.chunk.objectId, OBJECT_ID],
      [E2EE_ENVELOPE_FIELDS.chunk.revision, 3],
      [E2EE_ENVELOPE_FIELDS.chunk.chunkIndex, 0],
      [E2EE_ENVELOPE_FIELDS.chunk.chunkCount, 1],
      [
        E2EE_ENVELOPE_FIELDS.chunk.secretstreamHeader,
        ancV1HexToBytes(ANC_V1_FIXED_SECRETSTREAM_HEADER_HEX),
      ],
      [
        E2EE_ENVELOPE_FIELDS.chunk.ciphertext,
        ancV1HexToBytes(ANC_V1_FIXED_SECRETSTREAM_CIPHERTEXT_HEX),
      ],
    ]),
  );

  const grantUnsigned = withEntries(commonEnvelope("grant", 0x16), [
    [E2EE_ENVELOPE_FIELDS.grant.grantId, GRANT_ID],
    [E2EE_ENVELOPE_FIELDS.grant.issuerEndpointId, ENDPOINT_ID],
    [E2EE_ENVELOPE_FIELDS.grant.subjectAccountId, fixtureId(0x07)],
    [E2EE_ENVELOPE_FIELDS.grant.subjectEndpointId, RECIPIENT_ENDPOINT_ID],
    [E2EE_ENVELOPE_FIELDS.grant.subjectAgentId, fixtureId(0x08)],
    [E2EE_ENVELOPE_FIELDS.grant.resourceIds, [OBJECT_ID]],
    [E2EE_ENVELOPE_FIELDS.grant.operations, ["read", "summarize"]],
    [E2EE_ENVELOPE_FIELDS.grant.providers, ["synthetic-provider"]],
    [E2EE_ENVELOPE_FIELDS.grant.issuedAt, FIXED_CREATED_AT],
    [E2EE_ENVELOPE_FIELDS.grant.expiresAt, FIXED_CREATED_AT + 3600],
    [E2EE_ENVELOPE_FIELDS.grant.revocationRef, fixtureId(0x09)],
  ]);
  const grant = await signedEnvelope(
    "grant",
    grantUnsigned,
    E2EE_ENVELOPE_FIELDS.grant.signature,
    signing.privateKey,
  );

  const disclosureUnsigned = withEntries(commonEnvelope("disclosure", 0x17), [
    [E2EE_ENVELOPE_FIELDS.disclosure.grantRef, await ancV1Hash("grant", grant)],
    [E2EE_ENVELOPE_FIELDS.disclosure.providerId, "synthetic-provider"],
    [E2EE_ENVELOPE_FIELDS.disclosure.destination, "synthetic-destination"],
    [
      E2EE_ENVELOPE_FIELDS.disclosure.scopeHash,
      await ancV1Hash("disclosure", OBJECT_ID),
    ],
    [E2EE_ENVELOPE_FIELDS.disclosure.issuedAt, FIXED_CREATED_AT],
    [E2EE_ENVELOPE_FIELDS.disclosure.expiresAt, FIXED_CREATED_AT + 900],
  ]);
  const disclosure = await signedEnvelope(
    "disclosure",
    disclosureUnsigned,
    E2EE_ENVELOPE_FIELDS.disclosure.signature,
    signing.privateKey,
  );

  const jobNonce = ancV1PatternBytes(ANC_V1_SYNTHETIC_PATTERNS.jobNonce, 24);
  const jobAad = withEntries(commonEnvelope("job", 0x18), [
    [E2EE_ENVELOPE_FIELDS.job.jobId, JOB_ID],
    [E2EE_ENVELOPE_FIELDS.job.grantRef, await ancV1Hash("grant", grant)],
    [E2EE_ENVELOPE_FIELDS.job.issuedAt, FIXED_CREATED_AT],
    [E2EE_ENVELOPE_FIELDS.job.expiresAt, FIXED_CREATED_AT + 600],
    [E2EE_ENVELOPE_FIELDS.job.recipientEndpointId, RECIPIENT_ENDPOINT_ID],
  ]);
  const jobUnsigned = withEntries(jobAad, [
    [
      E2EE_ENVELOPE_FIELDS.job.ciphertext,
      ancV1PackNonceCiphertext(
        jobNonce,
        await ancV1BoxEncrypt(
          "job",
          text("synthetic encrypted job request"),
          jobNonce,
          recipientBox.publicKey,
          senderBox.privateKey,
        ),
      ),
    ],
  ]);
  const job = await signedEnvelope(
    "job",
    jobUnsigned,
    E2EE_ENVELOPE_FIELDS.job.signature,
    signing.privateKey,
  );

  const resultNonce = ancV1PatternBytes(
    ANC_V1_SYNTHETIC_PATTERNS.resultNonce,
    24,
  );
  const resultAad = withEntries(commonEnvelope("result", 0x19), [
    [E2EE_ENVELOPE_FIELDS.result.jobId, JOB_ID],
    [E2EE_ENVELOPE_FIELDS.result.jobHash, await ancV1Hash("job", job)],
    [E2EE_ENVELOPE_FIELDS.result.recipientEndpointId, RECIPIENT_ENDPOINT_ID],
    [E2EE_ENVELOPE_FIELDS.result.state, "completed"],
  ]);
  const resultUnsigned = withEntries(resultAad, [
    [
      E2EE_ENVELOPE_FIELDS.result.ciphertext,
      ancV1PackNonceCiphertext(
        resultNonce,
        await ancV1BoxEncrypt(
          "result",
          text("synthetic encrypted job result"),
          resultNonce,
          senderBox.publicKey,
          recipientBox.privateKey,
        ),
      ),
    ],
  ]);
  const result = await signedEnvelope(
    "result",
    resultUnsigned,
    E2EE_ENVELOPE_FIELDS.result.signature,
    signing.privateKey,
  );

  const logUnsigned = withEntries(commonEnvelope("log-entry", 0x1a), [
    [E2EE_ENVELOPE_FIELDS.logEntry.sequence, 9],
    [E2EE_ENVELOPE_FIELDS.logEntry.previousHash, fixtureId(0x0a)],
    [E2EE_ENVELOPE_FIELDS.logEntry.innerEnvelope, disclosure],
    [E2EE_ENVELOPE_FIELDS.logEntry.signerEndpointId, ENDPOINT_ID],
  ]);
  const logEntry = await signedEnvelope(
    "log-entry",
    logUnsigned,
    E2EE_ENVELOPE_FIELDS.logEntry.signature,
    signing.privateKey,
  );

  const manifestUnsigned = withEntries(commonEnvelope("manifest", 0x1b), [
    [E2EE_ENVELOPE_FIELDS.manifest.sequence, 12],
    [E2EE_ENVELOPE_FIELDS.manifest.objectRevisions, [[OBJECT_ID, 3]]],
    [E2EE_ENVELOPE_FIELDS.manifest.signerEndpointId, ENDPOINT_ID],
  ]);
  const manifest = await signedEnvelope(
    "manifest",
    manifestUnsigned,
    E2EE_ENVELOPE_FIELDS.manifest.signature,
    signing.privateKey,
  );

  const recoverySalt = ancV1PatternBytes(
    ANC_V1_SYNTHETIC_PATTERNS.recoverySalt,
    16,
  );
  const recoveryNonce = ancV1PatternBytes(
    ANC_V1_SYNTHETIC_PATTERNS.recoveryNonce,
    24,
  );
  const recoveryKey = await fixedSyntheticRecoveryVectorKey();
  const recoveryAad = withEntries(commonEnvelope("recovery", 0x1c), [
    [E2EE_ENVELOPE_FIELDS.recovery.salt, recoverySalt],
    [E2EE_ENVELOPE_FIELDS.recovery.opsLimit, 2],
    [E2EE_ENVELOPE_FIELDS.recovery.memLimitBytes, 67_108_864],
    [E2EE_ENVELOPE_FIELDS.recovery.nonce, recoveryNonce],
  ]);
  const recovery = encodeAncV1Canonical(
    withEntries(recoveryAad, [
      [
        E2EE_ENVELOPE_FIELDS.recovery.ciphertext,
        await ancV1AeadEncrypt(
          "recovery",
          eek,
          encodeAncV1Canonical(recoveryAad),
          recoveryNonce,
          recoveryKey,
        ),
      ],
    ]),
  );

  const lifecycleRecoveryAad = withEntries(commonEnvelope("recovery", 0x1e), [
    [E2EE_ENVELOPE_FIELDS.recovery.salt, recoverySalt],
    [E2EE_ENVELOPE_FIELDS.recovery.opsLimit, 2],
    [E2EE_ENVELOPE_FIELDS.recovery.memLimitBytes, 67_108_864],
    [E2EE_ENVELOPE_FIELDS.recovery.nonce, recoveryNonce],
    [E2EE_ENVELOPE_FIELDS.recovery.recoveryGeneration, 2],
    [E2EE_ENVELOPE_FIELDS.recovery.recoveryId, fixtureId(0x0b)],
    [E2EE_ENVELOPE_FIELDS.recovery.snapshotHash, ancV1PatternBytes(0xa3, 32)],
    [
      E2EE_ENVELOPE_FIELDS.recovery.authorizationHash,
      ancV1PatternBytes(0xa4, 32),
    ],
  ]);
  const lifecycleRecovery = encodeAncV1Canonical(
    withEntries(lifecycleRecoveryAad, [
      [
        E2EE_ENVELOPE_FIELDS.recovery.ciphertext,
        await ancV1AeadEncrypt(
          "recovery",
          eek,
          encodeAncV1Canonical(lifecycleRecoveryAad),
          recoveryNonce,
          recoveryKey,
        ),
      ],
    ]),
  );

  const tombstoneUnsigned = withEntries(commonEnvelope("tombstone", 0x1d), [
    [210, OBJECT_ID],
    [211, 3],
    [212, "synthetic_user_deletion"],
  ]);
  const tombstone = await signedEnvelope(
    "tombstone",
    tombstoneUnsigned,
    213,
    signing.privateKey,
  );

  return {
    vectors: {
      endpoint,
      epoch,
      "eek-wrap": eekWrap,
      "dek-wrap": dekWrap,
      "object-header": objectHeader,
      chunk,
      grant,
      disclosure,
      job,
      result,
      "log-entry": logEntry,
      manifest,
      recovery,
      tombstone,
    },
    lifecycleVectors: { enrollmentOffer, recovery: lifecycleRecovery },
    materials: {
      signingPublicKey: signing.publicKey,
      senderBoxPublicKey: senderBox.publicKey,
      senderBoxPrivateKey: senderBox.privateKey,
      recipientBoxPublicKey: recipientBox.publicKey,
      recipientBoxPrivateKey: recipientBox.privateKey,
      eek,
      dek,
      chunkKey,
      recoveryKey,
      chunkAad,
    },
  };
}

/** Filled from the independent fixed corpus and compared byte-for-byte. */
export const ANC_V1_EXPECTED_VECTOR_HEX: Readonly<
  Record<AncV1VectorName, string>
> = Object.freeze({
  endpoint:
    "ad0166616e632f76310250010101010101010101010101010101010368656e64706f696e74041a669612470550101010101010101010101010101010100a50020202020202020202020202020202020b676465736b746f700cf40d5820d04ab232742bb4ab3a1368bd4615e4e6d0224ab71a016baf8520a332c97787370e58209d8d78b9c9e6661e552f2f1af02095ee2f8743fa2e6183f41bb7077ef51b53790f50020202020202020202020202020202021058201e83e9fbf5be3b00610ce9cb7773316e189cf52d7d278c3b8c2f1cf48543269811584058586d07b58ab6bf14e3b47be65f1db6b899406ad888844fbedff513d27acc2bf33ffb9fa19fe1a24254994911f24409e789c72d6061ea1a93038731f525220b",
  epoch:
    "a90166616e632f7631025001010101010101010101010101010101036565706f6368041a669612470550111111111111111111111111111111111407158250020202020202020202020202020202025003030303030303030303030303030303167273796e7468657469635f726f746174696f6e1758401fe1856ee4dd55b79f106d74168a3636d086be33c5df50431e36f2883fe3e72edb05d56291ffb84cdab48c57f2001a9f581e9d3fe9e3d27b2ac93502553f8f06",
  "eek-wrap":
    "ab0166616e632f7631025001010101010101010101010101010101036865656b2d77726170041a66961247055012121212121212121212121212121212181e07181f50030303030303030303030303030303031820500202020202020202020202020202020218215818919191919191919191919191919191919191919191919191182258405731304237672e128234cfc8dd5ec5c492e25a196cf7dba33b8e4e92c48c331ed0d8b9ef8e68d24fe8c64118fd9c16c82d9f1f888a764815e3f63afb721057e318235840380f28fad03ba789928c943f98e58a3f4d410ae76b8f124ddcd906e74c983836936d766ee7ad7232b5b41c653debbbd735c45810db12d180c2c6091af68f0101",
  "dek-wrap":
    "aa0166616e632f7631025001010101010101010101010101010101036864656b2d77726170041a6696124705501313131313131313131313131313131318285004040404040404040404040404040404182903182a07182b5818929292929292929292929292929292929292929292929292182c583025a0a59b832e030d8c9606d14beb832ff42b4edbb5735954d0c6b4da3505875fb61db292c6baef48ecd0849aa1a3c3f6",
  "object-header":
    "ae0166616e632f7631025001010101010101010101010101010101036d6f626a6563742d686561646572041a6696124705501414141414141414141414141414141418325004040404040404040404040404040404183303183407183501183615183778186170706c69636174696f6e2f6f637465742d73747265616d18385820c863b5f137d4fb73a68d6a91a5476e6220998fa3e24fcdbc084891cc8f7e057418395002020202020202020202020202020202183a584006e49c866d1a93d3e733063f6de77af8da72b968889260c3a559cf256b3701d0d6ef78ebfa8bf1f59a57c751b9288d1830b7b1e52fc7a34e2bae8d62c1c56c00",
  chunk:
    "ab0166616e632f763102500101010101010101010101010101010103656368756e6b041a6696124705501515151515151515151515151515151518825004040404040404040404040404040404188303188400188501188658183f5fda67e8463e269d11c141f228d3921570da36f06db90d1887582603f8b067a34acb2883703117670be1a0e10b6255798ce738db867e8aff6732b021a168c3470c",
  grant:
    "b10166616e632f763102500101010101010101010101010101010103656772616e74041a66961247055016161616161616161616161616161616183c5005050505050505050505050505050505183d5002020202020202020202020202020202183e5007070707070707070707070707070707183f500303030303030303030303030303030318405008080808080808080808080808080808184181500404040404040404040404040404040418428264726561646973756d6d6172697a651843817273796e7468657469632d70726f766964657218441a6696124718451a669620571846500909090909090909090909090909090918475840375f79aa1a33d3766de017f95a7b30dc0032d332589b3b9dbb44467e26892d2aa76f22b1e52ba7207803edac04a803c2083c8658ec27053bfe92dbf2daa30200",
  disclosure:
    "ac0166616e632f7631025001010101010101010101010101010101036a646973636c6f73757265041a669612470550171717171717171717171717171717171850582076841ff39e85522ccfe9eb53ed39925d615f5997cfbb8f3f71e10b22eec0f82418517273796e7468657469632d70726f766964657218527573796e7468657469632d64657374696e6174696f6e185358206e9aa8d95e9af4efe15639f3b4d5797d278a1f387b70539ba9873e9f3c0bf96918541a6696124718551a669615cb1856584075a92ee2e3ad0f9dd2c59de5d560b538026b97c6ade0a51eba3c14e42cc91c38bc28d473acceb2dcc9739c5cb96b22a310d3301e66e2d1ee41c241be050ba200",
  job: "ac0166616e632f763102500101010101010101010101010101010103636a6f62041a66961247055018181818181818181818181818181818185a5006060606060606060606060606060606185b582076841ff39e85522ccfe9eb53ed39925d615f5997cfbb8f3f71e10b22eec0f824185c1a66961247185d1a6696149f185e5003030303030303030303030303030303185f5852939393939393939393939393939393939393939393939393ef05269e840644ee9631e5cc7bbfc68feb8b7947b7d4dd07288ddfdbd9f561adba227ab1fda0d80a3e98a02078e6e0ee6b555e2b53095251595a1860584005fb2843edbab5ef8d2f2a14bcb9a3225ead67d48962ed5b133e30658f0a90002538566406725ec50c4f4b2b1b9b896001d5f37faa8cbdd94d97ca2cc0e86c04",
  result:
    "ab0166616e632f76310250010101010101010101010101010101010366726573756c74041a669612470550191919191919191919191919191919191864500606060606060606060606060606060618655820b2437f2f0396a4f877e49ce6d8d0fe7888fc7efd547efff3c7ad3b1431c2b2f6186650030303030303030303030303030303031867585494949494949494949494949494949494949494949494949457008cdcbf16605ccbb5b711aaa1a3c791da42c0cee5335752da897d119f18962c04cf198d01a168a77e935ec5de286c2f14523c85a10ac116d19c3718685840e02be8b08b7d71f4e3798b48eca55850009d7124d6b1383c370a61cf3583c46277b385f86d35e57a458e7efbb82971ae8a69f3001e3d6ec4904ef68182b8b701186969636f6d706c65746564",
  "log-entry":
    "aa0166616e632f763102500101010101010101010101010101010103696c6f672d656e747279041a6696124705501a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a186e09186f500a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a1870590106ac0166616e632f7631025001010101010101010101010101010101036a646973636c6f73757265041a669612470550171717171717171717171717171717171850582076841ff39e85522ccfe9eb53ed39925d615f5997cfbb8f3f71e10b22eec0f82418517273796e7468657469632d70726f766964657218527573796e7468657469632d64657374696e6174696f6e185358206e9aa8d95e9af4efe15639f3b4d5797d278a1f387b70539ba9873e9f3c0bf96918541a6696124718551a669615cb1856584075a92ee2e3ad0f9dd2c59de5d560b538026b97c6ade0a51eba3c14e42cc91c38bc28d473acceb2dcc9739c5cb96b22a310d3301e66e2d1ee41c241be050ba20018715002020202020202020202020202020202187258406a5823f9dcd3a8227288f7dc52672ca558cb8f639c425bdac46648a3866bf8286c570d887d56ef25ebc5fab0c1a95cc76360d8356e21e5f5f9be4cedb0a01e08",
  manifest:
    "a90166616e632f763102500101010101010101010101010101010103686d616e6966657374041a6696124705501b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b18780c18798182500404040404040404040404040404040403187a5002020202020202020202020202020202187b58400339806d41e7216fdf72a6f184973e27c79d8b85fba02d470b2d53ba44d81f1ba33d8dd7233cbf5de05703788c367b5e14a3e591fbc7044dc022daaf4ea2dd07",
  recovery:
    "aa0166616e632f763102500101010101010101010101010101010103687265636f76657279041a6696124705501c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c18c850a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a118c90218ca1a0400000018cb5818a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a218cc58305ce632d2360829235eb57c373940cebcb1e29b3b32beedabe10c3f3e7097ae61b634d5bcc16a27e5361a258bccce62df",
  tombstone:
    "a90166616e632f76310250010101010101010101010101010101010369746f6d6273746f6e65041a6696124705501d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d18d2500404040404040404040404040404040418d30318d47773796e7468657469635f757365725f64656c6574696f6e18d558407338691ef27ac61960c870cfaa113b266e06dddeffb5f8399d36976d8b4596d368ab82fb5df59b4d34930be8d5759390060016af7a198769aeeff284a0b27807",
});

/**
 * Additional lifecycle bytes. The original fourteen vectors, including the
 * legacy recovery bytes, remain byte-for-byte compatible.
 */
export const ANC_V1_EXPECTED_ENROLLMENT_OFFER_HEX =
  "ad0166616e632f76310250010101010101010101010101010101010370656e726f6c6c6d656e742d6f66666572041a6696124705500e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e18a0500303030303030303030303030303030318a1500c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c18a268656e64706f696e7418a3f418a45820d04ab232742bb4ab3a1368bd4615e4e6d0224ab71a016baf8520a332c977873718a558204eb4fafee2bd3018a24e310de8106333c2b364eaed029a7f05d7b45ccc77683a18a65820a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a518a81a6696149f";
export const ANC_V1_EXPECTED_LIFECYCLE_RECOVERY_HEX =
  "ae0166616e632f763102500101010101010101010101010101010103687265636f76657279041a6696124705501e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e18c850a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a118c90218ca1a0400000018cb5818a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a218cc58305ce632d2360829235eb57c373940cebcb1e29b3b32beedabe10c3f3e7097ae616dae259ab901442154cd647e7102ba7418cd0218ce500b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b18cf5820a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a318d05820a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4";
