import {
  type AncV1CanonicalValue,
  ancV1HexToBytes,
  encodeAncV1Canonical,
} from "./canonical.js";
import {
  ancV1AeadEncrypt,
  ancV1BoxEncrypt,
  ancV1BoxKeypairFromSeed,
  ancV1DeriveRecoveryKey,
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
  jobKey: 0x77,
  resultKey: 0x88,
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
  materials: {
    signingPublicKey: Uint8Array;
    senderBoxPublicKey: Uint8Array;
    recipientBoxPublicKey: Uint8Array;
    recipientBoxPrivateKey: Uint8Array;
    eek: Uint8Array;
    dek: Uint8Array;
    chunkKey: Uint8Array;
    jobKey: Uint8Array;
    resultKey: Uint8Array;
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
  const jobKey = ancV1PatternBytes(ANC_V1_SYNTHETIC_PATTERNS.jobKey, 32);
  const resultKey = ancV1PatternBytes(ANC_V1_SYNTHETIC_PATTERNS.resultKey, 32);

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
        await ancV1AeadEncrypt(
          "job",
          text("synthetic encrypted job request"),
          encodeAncV1Canonical(jobAad),
          jobNonce,
          jobKey,
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
  ]);
  const resultUnsigned = withEntries(resultAad, [
    [
      E2EE_ENVELOPE_FIELDS.result.ciphertext,
      ancV1PackNonceCiphertext(
        resultNonce,
        await ancV1AeadEncrypt(
          "result",
          text("synthetic encrypted job result"),
          encodeAncV1Canonical(resultAad),
          resultNonce,
          resultKey,
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
  const recoveryKey = await ancV1DeriveRecoveryKey(
    "synthetic recovery phrase for fixed vectors only",
    recoverySalt,
    { opsLimit: 2, memLimit: 67_108_864 },
  );
  const recoveryAad = withEntries(commonEnvelope("recovery", 0x1c), [
    [200, recoverySalt],
    [201, 2],
    [202, 67_108_864],
    [203, recoveryNonce],
  ]);
  const recovery = encodeAncV1Canonical(
    withEntries(recoveryAad, [
      [
        204,
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
    materials: {
      signingPublicKey: signing.publicKey,
      senderBoxPublicKey: senderBox.publicKey,
      recipientBoxPublicKey: recipientBox.publicKey,
      recipientBoxPrivateKey: recipientBox.privateKey,
      eek,
      dek,
      chunkKey,
      jobKey,
      resultKey,
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
  job: "ac0166616e632f763102500101010101010101010101010101010103636a6f62041a66961247055018181818181818181818181818181818185a5006060606060606060606060606060606185b582076841ff39e85522ccfe9eb53ed39925d615f5997cfbb8f3f71e10b22eec0f824185c1a66961247185d1a6696149f185e5003030303030303030303030303030303185f5847939393939393939393939393939393939393939393939393f1420d2ed59cc6ffb2b9c638ae5ecd3e24a0b43e1e856dd6a9d96592d4b689128aee5356661f92a6684e1cc8911ca018605840438870682e93e9ed1b0197cd7b7ad45f6cd1d8ea9f7a03cacbe8bf39573722527f142cb923924fca027c61fe70fd3b408ef209af47a78f7a1bcbf31196b4fa0e",
  result:
    "aa0166616e632f76310250010101010101010101010101010101010366726573756c74041a669612470550191919191919191919191919191919191864500606060606060606060606060606060618655820d86e05e1f309fe39b284ee2daf85df444af5f4bdc1d7f2d85e62e46e4f067d301866500303030303030303030303030303030318675846949494949494949494949494949494949494949494949494556244222febea6c815836d2295fb9d86ed4968ab84415ce427692f5de31441c1733759075605733c385aae15718186858400073958c028eb4f6826e44938b34c2a1241a6b6f265249805dcea76827f29b3b9d32c4f3c12c44d324371a88c2113b89ebcefe4efc1f12be58968fce73428c06",
  "log-entry":
    "aa0166616e632f763102500101010101010101010101010101010103696c6f672d656e747279041a6696124705501a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a186e09186f500a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a1870590106ac0166616e632f7631025001010101010101010101010101010101036a646973636c6f73757265041a669612470550171717171717171717171717171717171850582076841ff39e85522ccfe9eb53ed39925d615f5997cfbb8f3f71e10b22eec0f82418517273796e7468657469632d70726f766964657218527573796e7468657469632d64657374696e6174696f6e185358206e9aa8d95e9af4efe15639f3b4d5797d278a1f387b70539ba9873e9f3c0bf96918541a6696124718551a669615cb1856584075a92ee2e3ad0f9dd2c59de5d560b538026b97c6ade0a51eba3c14e42cc91c38bc28d473acceb2dcc9739c5cb96b22a310d3301e66e2d1ee41c241be050ba20018715002020202020202020202020202020202187258406a5823f9dcd3a8227288f7dc52672ca558cb8f639c425bdac46648a3866bf8286c570d887d56ef25ebc5fab0c1a95cc76360d8356e21e5f5f9be4cedb0a01e08",
  manifest:
    "a90166616e632f763102500101010101010101010101010101010103686d616e6966657374041a6696124705501b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b18780c18798182500404040404040404040404040404040403187a5002020202020202020202020202020202187b58400339806d41e7216fdf72a6f184973e27c79d8b85fba02d470b2d53ba44d81f1ba33d8dd7233cbf5de05703788c367b5e14a3e591fbc7044dc022daaf4ea2dd07",
  recovery:
    "aa0166616e632f763102500101010101010101010101010101010103687265636f76657279041a6696124705501c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c18c850a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a118c90218ca1a0400000018cb5818a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a218cc58305ce632d2360829235eb57c373940cebcb1e29b3b32beedabe10c3f3e7097ae61b634d5bcc16a27e5361a258bccce62df",
  tombstone:
    "a90166616e632f76310250010101010101010101010101010101010369746f6d6273746f6e65041a6696124705501d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d18d2500404040404040404040404040404040418d30318d47773796e7468657469635f757365725f64656c6574696f6e18d558407338691ef27ac61960c870cfaa113b266e06dddeffb5f8399d36976d8b4596d368ab82fb5df59b4d34930be8d5759390060016af7a198769aeeff284a0b27807",
});
