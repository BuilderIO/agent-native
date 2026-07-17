/** Frozen cryptographic suite identifiers and interoperability limits. */
export const E2EE_SUITE_ID = "anc/v1" as const;
export const E2EE_CANONICAL_ENCODING = "cbor-rfc8949-deterministic" as const;

export const E2EE_PRIMITIVES = Object.freeze({
  contentAead: "xchacha20-poly1305-ietf",
  streamAead: "secretstream-xchacha20-poly1305",
  signatures: "ed25519",
  endpointKeyAgreement: "x25519-xsalsa20-poly1305",
  hash: "blake2b-256",
  passwordHash: "argon2id",
});

export const E2EE_DOMAIN_TAGS = Object.freeze([
  "endpoint",
  "endpoint-request-body",
  "endpoint-request",
  "epoch",
  "eek-wrap",
  "dek-wrap",
  "object-header",
  "chunk",
  "grant",
  "grant-revoke",
  "disclosure",
  "job",
  "result",
  "log-entry",
  "manifest",
  "recovery",
  "tombstone",
] as const);

export type E2EEDomainTag = (typeof E2EE_DOMAIN_TAGS)[number];

/** Integer CBOR keys are fixed per envelope type; unknown keys are rejected. */
export const E2EE_ENVELOPE_FIELDS = Object.freeze({
  common: Object.freeze({
    suite: 1,
    vaultId: 2,
    type: 3,
    createdAt: 4,
    envelopeId: 5,
  }),
  endpoint: Object.freeze({
    endpointId: 10,
    role: 11,
    unattended: 12,
    signingPublicKey: 13,
    keyAgreementPublicKey: 14,
    addedByEndpointId: 15,
    sasTranscriptHash: 16,
    signature: 17,
  }),
  epoch: Object.freeze({
    epoch: 20,
    authorizedEndpointIds: 21,
    reason: 22,
    signature: 23,
  }),
  eekWrap: Object.freeze({
    epoch: 30,
    recipientEndpointId: 31,
    issuerEndpointId: 32,
    nonce: 33,
    ciphertext: 34,
    signature: 35,
  }),
  dekWrap: Object.freeze({
    objectId: 40,
    revision: 41,
    epoch: 42,
    nonce: 43,
    ciphertext: 44,
  }),
  objectHeader: Object.freeze({
    objectId: 50,
    revision: 51,
    epoch: 52,
    chunkCount: 53,
    plaintextLength: 54,
    contentType: 55,
    dekWrapRef: 56,
    writerEndpointId: 57,
    signature: 58,
  }),
  grant: Object.freeze({
    grantId: 60,
    issuerEndpointId: 61,
    subjectAccountId: 62,
    subjectEndpointId: 63,
    subjectAgentId: 64,
    resourceIds: 65,
    operations: 66,
    providers: 67,
    issuedAt: 68,
    expiresAt: 69,
    revocationRef: 70,
    signature: 71,
  }),
  disclosure: Object.freeze({
    grantRef: 80,
    providerId: 81,
    destination: 82,
    scopeHash: 83,
    issuedAt: 84,
    expiresAt: 85,
    signature: 86,
  }),
  job: Object.freeze({
    jobId: 90,
    grantRef: 91,
    issuedAt: 92,
    expiresAt: 93,
    recipientEndpointId: 94,
    ciphertext: 95,
    signature: 96,
  }),
  result: Object.freeze({
    jobId: 100,
    jobHash: 101,
    recipientEndpointId: 102,
    ciphertext: 103,
    signature: 104,
  }),
  logEntry: Object.freeze({
    sequence: 110,
    previousHash: 111,
    innerEnvelope: 112,
    signerEndpointId: 113,
    signature: 114,
  }),
  manifest: Object.freeze({
    sequence: 120,
    objectRevisions: 121,
    signerEndpointId: 122,
    signature: 123,
  }),
  chunk: Object.freeze({
    objectId: 130,
    revision: 131,
    chunkIndex: 132,
    chunkCount: 133,
    secretstreamHeader: 134,
    ciphertext: 135,
  }),
});

export const E2EE_SIZE_LIMITS = Object.freeze({
  controlEnvelopeBytes: 64 * 1024,
  objectHeaderBytes: 16 * 1024,
  chunkPlaintextBytes: 1024 * 1024,
  objectPlaintextBytes: 256 * 1024 * 1024,
  jobPayloadBytes: 16 * 1024 * 1024,
  resultPayloadBytes: 16 * 1024 * 1024,
  vaultLogEntryBytes: 64 * 1024,
});

export const E2EE_LIFETIME_LIMITS_SECONDS = Object.freeze({
  internalGrantMaximum: 30 * 24 * 60 * 60,
  disclosureDefault: 24 * 60 * 60,
  disclosureMaximum: 7 * 24 * 60 * 60,
  brokerAuthorizationFreshness: 15 * 60,
});

export function e2eeDomainSeparationPrefix(tag: E2EEDomainTag): Uint8Array {
  return new TextEncoder().encode(`${E2EE_SUITE_ID}/${tag}\0`);
}
