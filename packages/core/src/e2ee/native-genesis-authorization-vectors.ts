import {
  type AncV1CanonicalValue,
  ancV1BytesToHex,
  decodeAncV1Canonical,
  encodeAncV1Canonical,
} from "./canonical.js";
import {
  type ControlLogMember,
  type ControlMembershipCommit,
  type SignedControlLogEntry,
  encodeSignedControlLogEntry,
  encodeUnsignedControlLogEntry,
} from "./control-log.js";
import {
  createAncV1GenesisBootstrapTranscript,
  encodeAncV1GenesisBootstrapTranscript,
  hashAncV1GenesisBootstrapTranscript,
} from "./genesis-bootstrap-transcript.js";
import {
  type AncV1GenesisRecoveryConfirmation,
  type AncV1UnsignedGenesisAuthorization,
  encodeAncV1GenesisAuthorization,
  encodeAncV1GenesisRecoveryConfirmation,
  encodeAncV1UnsignedGenesisAuthorization,
  hashAncV1GenesisRecoveryConfirmation,
} from "./genesis-ceremony-codecs.js";
import {
  ancV1BoxKeypairFromSeed,
  ancV1Hash,
  ancV1SignDetached,
  ancV1SigningKeypairFromSeed,
} from "./portable-crypto.js";
import {
  E2EE_ENVELOPE_FIELDS,
  E2EE_SIZE_LIMITS,
  E2EE_SUITE_ID,
  type E2EEDomainTag,
  e2eeDomainSeparationPrefix,
} from "./suite.js";

export const ANC_V1_NATIVE_GENESIS_AUTHORIZATION_CORPUS_SCHEMA =
  "anc/v1-native-genesis-authorization-vectors@1" as const;
export const ANC_V1_NATIVE_GENESIS_AUTHORIZATION_GENERATOR =
  "buildAncV1NativeGenesisAuthorizationVectors" as const;
export const ANC_V1_NATIVE_GENESIS_AUTHORIZATION_SOURCE_PATHS = [
  "packages/core/src/e2ee/native-genesis-authorization-vectors.ts",
  "packages/core/src/e2ee/genesis-ceremony-codecs.ts",
  "packages/core/src/e2ee/genesis-bootstrap-transcript.ts",
  "packages/core/src/e2ee/control-log.ts",
  "packages/core/src/e2ee/canonical.ts",
  "packages/core/src/e2ee/portable-crypto.ts",
  "packages/core/src/e2ee/suite.ts",
] as const;

export const ANC_V1_NATIVE_GENESIS_AUTHORIZATION_CATEGORIES = [
  "wire.invalid_canonical",
  "wire.missing_field",
  "wire.unknown_field",
  "wire.wrong_type",
  "wire.wrong_literal",
  "wire.length",
  "wire.range",
  "wire.endpoint.invalid_canonical",
  "wire.endpoint.missing_field",
  "wire.endpoint.unknown_field",
  "wire.endpoint.wrong_type",
  "wire.endpoint.wrong_literal",
  "wire.endpoint.length",
  "wire.endpoint.range",
  "wire.endpoint.role",
  "limits.confirmation",
  "limits.authorization",
  "limits.endpoint",
  "limits.commit",
  "binding.vault",
  "binding.recovery_confirmation",
  "binding.ceremony",
  "binding.endpoint",
  "binding.recovery",
  "binding.bootstrap",
  "binding.commit",
  "binding.time",
  "binding.order",
  "binding.head",
  "binding.role",
  "binding.member",
  "crypto.endpoint_signature",
  "crypto.commit_signature",
  "crypto.authorization_signature",
  "crypto.domain",
] as const;

export type AncV1NativeGenesisAuthorizationCategory =
  (typeof ANC_V1_NATIVE_GENESIS_AUTHORIZATION_CATEGORIES)[number];
export type AncV1NativeGenesisAuthorizationStage =
  | "confirmation-decode"
  | "authorization-decode"
  | "verify";

export interface AncV1NativeGenesisAuthorizationProvenance {
  protocolBaseCommit: string;
  sources: readonly {
    path: (typeof ANC_V1_NATIVE_GENESIS_AUTHORIZATION_SOURCE_PATHS)[number];
    sha256: string;
  }[];
}

export interface AncV1NativeGenesisAuthorizationCase {
  name: string;
  stage: AncV1NativeGenesisAuthorizationStage;
  authorizationHex: string;
  recoveryConfirmationHex: string;
  bootstrapTranscriptHex: string;
  callbackSignedGenesisCommitHex: string | null;
  expectedVaultIdHex: string;
  expectedCategory: AncV1NativeGenesisAuthorizationCategory;
}

export interface AncV1NativeGenesisAuthorizationPositiveCase {
  name: string;
  authorizationHex: string;
  recoveryConfirmationHex: string;
  bootstrapTranscriptHex: string;
}

export interface AncV1NativeGenesisAuthorizationCorpus {
  schema: typeof ANC_V1_NATIVE_GENESIS_AUTHORIZATION_CORPUS_SCHEMA;
  suite: typeof E2EE_SUITE_ID;
  encoding: "hex";
  generator: typeof ANC_V1_NATIVE_GENESIS_AUTHORIZATION_GENERATOR;
  protocolBaseCommit: string;
  sourceAnchors: AncV1NativeGenesisAuthorizationProvenance["sources"];
  domains: Readonly<
    Record<
      "recoveryConfirmation" | "endpoint" | "commit" | "authorization",
      { escaped: string; utf8Hex: string }
    >
  >;
  fieldKeys: {
    common: Readonly<Record<string, number>>;
    recoveryConfirmation: Readonly<Record<string, number>>;
    endpoint: Readonly<Record<string, number>>;
    authorization: Readonly<Record<string, number>>;
    logEntry: Readonly<Record<string, number>>;
    membershipCommit: Readonly<Record<string, number>>;
  };
  limits: {
    confirmationBytes: number;
    authorizationBytes: number;
    signedCommitBytes: number;
  };
  categoryVocabulary: readonly AncV1NativeGenesisAuthorizationCategory[];
  exact: {
    recoveryConfirmationHex: string;
    recoveryConfirmationDigestHex: string;
    bootstrapTranscriptHex: string;
    bootstrapTranscriptDigestHex: string;
    endpointEnvelopeHex: string;
    signedGenesisCommitHex: string;
    authorizationHex: string;
    authorizationDigestHex: string;
    parsed: Readonly<Record<string, string | number | boolean>>;
  };
  positiveCases: readonly AncV1NativeGenesisAuthorizationPositiveCase[];
  negativeCases: readonly AncV1NativeGenesisAuthorizationCase[];
}

const F = E2EE_ENVELOPE_FIELDS;
const p = (byte: number, length: number) => new Uint8Array(length).fill(byte);
const concat = (...parts: readonly Uint8Array[]) => {
  const output = new Uint8Array(
    parts.reduce((sum, part) => sum + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
};

function provenanceValid(value: AncV1NativeGenesisAuthorizationProvenance) {
  return (
    /^[0-9a-f]{40}$/.test(value.protocolBaseCommit) &&
    value.sources.length ===
      ANC_V1_NATIVE_GENESIS_AUTHORIZATION_SOURCE_PATHS.length &&
    ANC_V1_NATIVE_GENESIS_AUTHORIZATION_SOURCE_PATHS.every(
      (path, index) =>
        value.sources[index]?.path === path &&
        /^[0-9a-f]{64}$/.test(value.sources[index]!.sha256),
    )
  );
}

function mutate(
  encoded: Uint8Array,
  update: (map: Map<number, AncV1CanonicalValue>) => void,
) {
  const decoded = decodeAncV1Canonical(encoded);
  if (!(decoded instanceof Map)) throw new Error("Expected canonical map");
  const copy = new Map(decoded);
  update(copy);
  return encodeAncV1Canonical(copy);
}

function mapPairs(encoded: Uint8Array) {
  const decoded = decodeAncV1Canonical(encoded);
  if (!(decoded instanceof Map)) throw new Error("Expected canonical map");
  return [...decoded].map(([key, value]) =>
    encodeAncV1Canonical(new Map([[key, value]])).slice(1),
  );
}

export async function buildAncV1NativeGenesisAuthorizationVectors(
  provenance: AncV1NativeGenesisAuthorizationProvenance,
): Promise<AncV1NativeGenesisAuthorizationCorpus> {
  if (!provenanceValid(provenance))
    throw new Error("Invalid fixture provenance");

  const vaultId = p(0x11, 16);
  const endpointId = p(0x22, 16);
  const ceremonyId = p(0x33, 16);
  const recoveryId = p(0x44, 16);
  const authorizationId = p(0x55, 16);
  const endpointEnvelopeId = p(0x66, 16);
  const logEntryId = p(0x77, 16);
  const syntheticMaterial = (label: string) =>
    ancV1Hash(
      "recovery",
      new TextEncoder().encode(
        `agent-native synthetic genesis authorization vector ${label}`,
      ),
    );
  const endpointSigning = await ancV1SigningKeypairFromSeed(
    await syntheticMaterial("endpoint signing"),
  );
  const endpointAgreement = await ancV1BoxKeypairFromSeed(
    await syntheticMaterial("endpoint agreement"),
  );
  const recoverySigning = await ancV1SigningKeypairFromSeed(
    await syntheticMaterial("recovery signing"),
  );
  const recoveryAgreement = await ancV1BoxKeypairFromSeed(
    await syntheticMaterial("recovery agreement"),
  );
  const alternateSigning = await ancV1SigningKeypairFromSeed(
    await syntheticMaterial("alternate signing"),
  );
  const recoveryWrapHash = await ancV1Hash(
    "recovery",
    new TextEncoder().encode("synthetic public genesis recovery wrap"),
  );
  const confirmationTime = 1_721_111_100;
  const endpointTime = 1_721_111_110;
  const commitTime = 1_721_111_120;
  const authorizationTime = 1_721_111_130;

  const recoveryConfirmationValue: AncV1GenesisRecoveryConfirmation = {
    suite: E2EE_SUITE_ID,
    vaultId,
    type: "genesis-recovery-confirmation",
    ceremonyId,
    endpointId,
    recoveryId,
    recoverySigningPublicKey: recoverySigning.publicKey,
    recoveryKeyAgreementPublicKey: recoveryAgreement.publicKey,
    recoveryWrapHash,
    confirmedAt: confirmationTime,
    recoveryGeneration: 1,
  };
  const recoveryConfirmation = encodeAncV1GenesisRecoveryConfirmation(
    recoveryConfirmationValue,
  );
  const recoveryConfirmationDigest = await hashAncV1GenesisRecoveryConfirmation(
    recoveryConfirmation,
    vaultId,
  );
  const bootstrapTranscriptValue = await createAncV1GenesisBootstrapTranscript({
    vaultId,
    ceremonyId,
    endpointId,
    endpointSigningPublicKey: endpointSigning.publicKey,
    endpointKeyAgreementPublicKey: endpointAgreement.publicKey,
    enrollmentRef: authorizationId,
    recoveryConfirmation,
  });
  const bootstrapTranscript = encodeAncV1GenesisBootstrapTranscript(
    bootstrapTranscriptValue,
  );
  const bootstrapTranscriptDigest = await hashAncV1GenesisBootstrapTranscript(
    bootstrapTranscript,
    { expectedVaultId: vaultId },
  );

  const endpointBase = new Map<number, AncV1CanonicalValue>([
    [F.common.suite, E2EE_SUITE_ID],
    [F.common.vaultId, vaultId],
    [F.common.type, "endpoint"],
    [F.common.createdAt, endpointTime],
    [F.common.envelopeId, endpointEnvelopeId],
    [F.endpoint.endpointId, endpointId],
    [F.endpoint.role, "desktop"],
    [F.endpoint.unattended, false],
    [F.endpoint.signingPublicKey, endpointSigning.publicKey],
    [F.endpoint.keyAgreementPublicKey, endpointAgreement.publicKey],
    [F.endpoint.addedByEndpointId, endpointId],
    [F.endpoint.sasTranscriptHash, recoveryConfirmationDigest],
  ]);
  const signEndpoint = async (
    update?: (map: Map<number, AncV1CanonicalValue>) => void,
    domain: E2EEDomainTag = "endpoint",
    signingKey = endpointSigning.privateKey,
  ) => {
    const unsigned = new Map(endpointBase);
    update?.(unsigned);
    return encodeAncV1Canonical(
      new Map<number, AncV1CanonicalValue>([
        ...unsigned,
        [
          F.endpoint.signature,
          await ancV1SignDetached(
            domain,
            encodeAncV1Canonical(unsigned),
            signingKey,
          ),
        ],
      ]),
    );
  };
  const endpointEnvelope = await signEndpoint();

  const member: ControlLogMember = {
    endpointId: ancV1BytesToHex(endpointId),
    role: "endpoint",
    unattended: false,
    signingPublicKey: ancV1BytesToHex(endpointSigning.publicKey),
    keyAgreementPublicKey: ancV1BytesToHex(endpointAgreement.publicKey),
    enrollmentRef: ancV1BytesToHex(authorizationId),
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
    recoveryId: ancV1BytesToHex(recoveryId),
    recoverySigningPublicKey: ancV1BytesToHex(recoverySigning.publicKey),
    recoveryKeyAgreementPublicKey: ancV1BytesToHex(recoveryAgreement.publicKey),
    recoveryWrapHash: ancV1BytesToHex(recoveryWrapHash),
  };
  const signCommit = async (
    inner: ControlMembershipCommit = commit,
    update: Partial<
      Omit<SignedControlLogEntry, "signature" | "innerEnvelope">
    > = {},
    domain: E2EEDomainTag = "log-entry",
    signingKey = endpointSigning.privateKey,
  ) => {
    const unsigned = {
      suite: E2EE_SUITE_ID,
      vaultId: commit.vaultId,
      type: "log-entry" as const,
      createdAt: new Date(commitTime * 1_000).toISOString(),
      envelopeId: ancV1BytesToHex(logEntryId),
      sequence: 0,
      previousHash: "00".repeat(32),
      innerEnvelope: inner,
      signerEndpointId: member.endpointId,
      ...update,
    };
    return encodeSignedControlLogEntry({
      ...unsigned,
      signature: ancV1BytesToHex(
        await ancV1SignDetached(
          domain,
          encodeUnsignedControlLogEntry(unsigned),
          signingKey,
        ),
      ),
    });
  };
  const signedGenesisCommit = await signCommit();

  const authorizationBase: AncV1UnsignedGenesisAuthorization = {
    suite: E2EE_SUITE_ID,
    vaultId,
    type: "genesis-authorization",
    createdAt: authorizationTime,
    envelopeId: authorizationId,
    ceremonyId,
    endpointId,
    epoch: 1,
    endpointEnvelope,
    recoveryConfirmation,
    signedGenesisCommit,
  };
  const signAuthorization = async (
    update: Partial<AncV1UnsignedGenesisAuthorization> = {},
    domain: E2EEDomainTag = "genesis-authorization",
    signingKey = endpointSigning.privateKey,
  ) => {
    const unsigned = { ...authorizationBase, ...update };
    return encodeAncV1GenesisAuthorization({
      ...unsigned,
      signature: await ancV1SignDetached(
        domain,
        encodeAncV1UnsignedGenesisAuthorization(unsigned),
        signingKey,
      ),
    });
  };
  const authorization = await signAuthorization();
  const authorizationDigest = await ancV1Hash(
    "genesis-authorization",
    authorization,
  );

  const buildPositive = async (
    name: string,
    timestamps: {
      confirmation: number;
      endpoint: number;
      commitIso: string;
      authorization: number;
    },
    role = "desktop",
  ): Promise<AncV1NativeGenesisAuthorizationPositiveCase> => {
    const confirmationValue = {
      ...recoveryConfirmationValue,
      confirmedAt: timestamps.confirmation,
    };
    const confirmationBytes =
      encodeAncV1GenesisRecoveryConfirmation(confirmationValue);
    const confirmationHash = await hashAncV1GenesisRecoveryConfirmation(
      confirmationBytes,
      vaultId,
    );
    const bootstrapValue = await createAncV1GenesisBootstrapTranscript({
      vaultId,
      ceremonyId,
      endpointId,
      endpointSigningPublicKey: endpointSigning.publicKey,
      endpointKeyAgreementPublicKey: endpointAgreement.publicKey,
      enrollmentRef: authorizationId,
      recoveryConfirmation: confirmationBytes,
    });
    const positiveEndpointUnsigned = new Map<number, AncV1CanonicalValue>([
      [F.common.suite, E2EE_SUITE_ID],
      [F.common.vaultId, vaultId],
      [F.common.type, "endpoint"],
      [F.common.createdAt, timestamps.endpoint],
      [F.common.envelopeId, endpointEnvelopeId],
      [F.endpoint.endpointId, endpointId],
      [F.endpoint.role, role],
      [F.endpoint.unattended, false],
      [F.endpoint.signingPublicKey, endpointSigning.publicKey],
      [F.endpoint.keyAgreementPublicKey, endpointAgreement.publicKey],
      [F.endpoint.addedByEndpointId, endpointId],
      [F.endpoint.sasTranscriptHash, confirmationHash],
    ]);
    const positiveEndpointEnvelope = encodeAncV1Canonical(
      new Map<number, AncV1CanonicalValue>([
        ...positiveEndpointUnsigned,
        [
          F.endpoint.signature,
          await ancV1SignDetached(
            "endpoint",
            encodeAncV1Canonical(positiveEndpointUnsigned),
            endpointSigning.privateKey,
          ),
        ],
      ]),
    );
    const positiveCommitUnsigned = {
      suite: E2EE_SUITE_ID,
      vaultId: commit.vaultId,
      type: "log-entry" as const,
      createdAt: timestamps.commitIso,
      envelopeId: ancV1BytesToHex(logEntryId),
      sequence: 0,
      previousHash: "00".repeat(32),
      innerEnvelope: commit,
      signerEndpointId: member.endpointId,
    };
    const positiveSignedCommit = encodeSignedControlLogEntry({
      ...positiveCommitUnsigned,
      signature: ancV1BytesToHex(
        await ancV1SignDetached(
          "log-entry",
          encodeUnsignedControlLogEntry(positiveCommitUnsigned),
          endpointSigning.privateKey,
        ),
      ),
    });
    const positiveAuthorizationUnsigned = {
      ...authorizationBase,
      createdAt: timestamps.authorization,
      endpointEnvelope: positiveEndpointEnvelope,
      recoveryConfirmation: confirmationBytes,
      signedGenesisCommit: positiveSignedCommit,
    };
    const positiveAuthorization = encodeAncV1GenesisAuthorization({
      ...positiveAuthorizationUnsigned,
      signature: await ancV1SignDetached(
        "genesis-authorization",
        encodeAncV1UnsignedGenesisAuthorization(positiveAuthorizationUnsigned),
        endpointSigning.privateKey,
      ),
    });
    return {
      name,
      authorizationHex: ancV1BytesToHex(positiveAuthorization),
      recoveryConfirmationHex: ancV1BytesToHex(confirmationBytes),
      bootstrapTranscriptHex: ancV1BytesToHex(
        encodeAncV1GenesisBootstrapTranscript(bootstrapValue),
      ),
    };
  };
  const positiveCases = await Promise.all([
    buildPositive("confirmation_equals_endpoint", {
      confirmation: confirmationTime,
      endpoint: confirmationTime,
      commitIso: new Date(commitTime * 1_000).toISOString(),
      authorization: authorizationTime,
    }),
    buildPositive("endpoint_equals_commit", {
      confirmation: confirmationTime,
      endpoint: commitTime,
      commitIso: new Date(commitTime * 1_000).toISOString(),
      authorization: authorizationTime,
    }),
    buildPositive("commit_equals_authorization", {
      confirmation: confirmationTime,
      endpoint: endpointTime,
      commitIso: new Date(authorizationTime * 1_000).toISOString(),
      authorization: authorizationTime,
    }),
    buildPositive("all_timestamps_equal", {
      confirmation: confirmationTime,
      endpoint: confirmationTime,
      commitIso: new Date(confirmationTime * 1_000).toISOString(),
      authorization: confirmationTime,
    }),
    buildPositive("fractional_commit_iso_accepted", {
      confirmation: confirmationTime,
      endpoint: endpointTime,
      commitIso: new Date(commitTime * 1_000 + 500).toISOString(),
      authorization: authorizationTime,
    }),
    buildPositive(
      "endpoint_role_one_character_accepted",
      {
        confirmation: confirmationTime,
        endpoint: endpointTime,
        commitIso: new Date(commitTime * 1_000).toISOString(),
        authorization: authorizationTime,
      },
      "d",
    ),
    buildPositive(
      "endpoint_role_sixty_four_characters_accepted",
      {
        confirmation: confirmationTime,
        endpoint: endpointTime,
        commitIso: new Date(commitTime * 1_000).toISOString(),
        authorization: authorizationTime,
      },
      "r".repeat(64),
    ),
  ]);

  const cases: AncV1NativeGenesisAuthorizationCase[] = [];
  const add = (
    name: string,
    stage: AncV1NativeGenesisAuthorizationStage,
    expectedCategory: AncV1NativeGenesisAuthorizationCategory,
    options: Partial<
      Pick<
        AncV1NativeGenesisAuthorizationCase,
        | "authorizationHex"
        | "recoveryConfirmationHex"
        | "bootstrapTranscriptHex"
        | "callbackSignedGenesisCommitHex"
        | "expectedVaultIdHex"
      >
    > = {},
  ) =>
    cases.push({
      name,
      stage,
      authorizationHex:
        options.authorizationHex ?? ancV1BytesToHex(authorization),
      recoveryConfirmationHex:
        options.recoveryConfirmationHex ??
        ancV1BytesToHex(recoveryConfirmation),
      bootstrapTranscriptHex:
        options.bootstrapTranscriptHex ?? ancV1BytesToHex(bootstrapTranscript),
      callbackSignedGenesisCommitHex:
        options.callbackSignedGenesisCommitHex ?? null,
      expectedVaultIdHex:
        options.expectedVaultIdHex ?? ancV1BytesToHex(vaultId),
      expectedCategory,
    });

  const confirmationFields = [
    ["suite", F.common.suite, E2EE_SUITE_ID, null],
    ["vault_id", F.common.vaultId, vaultId, 16],
    ["type", F.common.type, "genesis-recovery-confirmation", null],
    ["ceremony_id", F.genesisRecoveryConfirmation.ceremonyId, ceremonyId, 16],
    ["endpoint_id", F.genesisRecoveryConfirmation.endpointId, endpointId, 16],
    ["recovery_id", F.genesisRecoveryConfirmation.recoveryId, recoveryId, 16],
    [
      "recovery_signing_public_key",
      F.genesisRecoveryConfirmation.recoverySigningPublicKey,
      recoverySigning.publicKey,
      32,
    ],
    [
      "recovery_key_agreement_public_key",
      F.genesisRecoveryConfirmation.recoveryKeyAgreementPublicKey,
      recoveryAgreement.publicKey,
      32,
    ],
    [
      "recovery_wrap_hash",
      F.genesisRecoveryConfirmation.recoveryWrapHash,
      recoveryWrapHash,
      32,
    ],
    [
      "confirmed_at",
      F.genesisRecoveryConfirmation.confirmedAt,
      confirmationTime,
      null,
    ],
    [
      "recovery_generation",
      F.genesisRecoveryConfirmation.recoveryGeneration,
      1,
      null,
    ],
  ] as const;
  for (const [name, key, value, length] of confirmationFields) {
    add(
      `confirmation_missing_${name}`,
      "confirmation-decode",
      "wire.missing_field",
      {
        recoveryConfirmationHex: ancV1BytesToHex(
          mutate(recoveryConfirmation, (map) => map.delete(key)),
        ),
      },
    );
    add(
      `confirmation_wrong_type_${name}`,
      "confirmation-decode",
      "wire.wrong_type",
      {
        recoveryConfirmationHex: ancV1BytesToHex(
          mutate(recoveryConfirmation, (map) =>
            map.set(key, typeof value === "number" ? "1" : 7),
          ),
        ),
      },
    );
    if (length !== null) {
      for (const [kind, actual] of [
        ["short", length - 1],
        ["long", length + 1],
      ] as const)
        add(
          `confirmation_${kind}_${name}`,
          "confirmation-decode",
          "wire.length",
          {
            recoveryConfirmationHex: ancV1BytesToHex(
              mutate(recoveryConfirmation, (map) =>
                map.set(key, p(0xee, actual)),
              ),
            ),
          },
        );
    }
  }
  add("confirmation_wrong_suite", "confirmation-decode", "wire.wrong_literal", {
    recoveryConfirmationHex: ancV1BytesToHex(
      mutate(recoveryConfirmation, (map) => map.set(F.common.suite, "anc/v2")),
    ),
  });
  add(
    "confirmation_wrong_type_literal",
    "confirmation-decode",
    "wire.wrong_literal",
    {
      recoveryConfirmationHex: ancV1BytesToHex(
        mutate(recoveryConfirmation, (map) =>
          map.set(F.common.type, "recovery-authorization"),
        ),
      ),
    },
  );
  add("confirmation_zero_time", "confirmation-decode", "wire.range", {
    recoveryConfirmationHex: ancV1BytesToHex(
      mutate(recoveryConfirmation, (map) =>
        map.set(F.genesisRecoveryConfirmation.confirmedAt, 0),
      ),
    ),
  });
  add("confirmation_wrong_generation", "confirmation-decode", "wire.range", {
    recoveryConfirmationHex: ancV1BytesToHex(
      mutate(recoveryConfirmation, (map) =>
        map.set(F.genesisRecoveryConfirmation.recoveryGeneration, 2),
      ),
    ),
  });
  add(
    "confirmation_unknown_field",
    "confirmation-decode",
    "wire.unknown_field",
    {
      recoveryConfirmationHex: ancV1BytesToHex(
        mutate(recoveryConfirmation, (map) => map.set(399, 1)),
      ),
    },
  );
  const confirmationPairs = mapPairs(recoveryConfirmation);
  for (const [name, bytes] of [
    [
      "reversed_map_order",
      concat(Uint8Array.of(0xab), ...confirmationPairs.toReversed()),
    ],
    [
      "duplicate_key",
      concat(Uint8Array.of(0xac), ...confirmationPairs, confirmationPairs[0]!),
    ],
    [
      "indefinite_map",
      concat(Uint8Array.of(0xbf), ...confirmationPairs, Uint8Array.of(0xff)),
    ],
    [
      "nonshortest_map",
      concat(Uint8Array.of(0xb8, 0x0b), ...confirmationPairs),
    ],
  ] as const)
    add(
      `confirmation_noncanonical_${name}`,
      "confirmation-decode",
      "wire.invalid_canonical",
      {
        recoveryConfirmationHex: ancV1BytesToHex(bytes),
      },
    );
  add("confirmation_over_limit", "confirmation-decode", "limits.confirmation", {
    recoveryConfirmationHex: ancV1BytesToHex(
      p(0, E2EE_SIZE_LIMITS.controlEnvelopeBytes + 1),
    ),
  });
  add("confirmation_vault_binding", "confirmation-decode", "binding.vault", {
    expectedVaultIdHex: ancV1BytesToHex(p(0xfe, 16)),
  });

  const authorizationFields = [
    ["suite", F.common.suite, E2EE_SUITE_ID, null],
    ["vault_id", F.common.vaultId, vaultId, 16],
    ["type", F.common.type, "genesis-authorization", null],
    ["created_at", F.common.createdAt, authorizationTime, null],
    ["envelope_id", F.common.envelopeId, authorizationId, 16],
    ["ceremony_id", F.genesisAuthorization.ceremonyId, ceremonyId, 16],
    ["endpoint_id", F.genesisAuthorization.endpointId, endpointId, 16],
    ["epoch", F.genesisAuthorization.epoch, 1, null],
    [
      "endpoint_envelope",
      F.genesisAuthorization.endpointEnvelope,
      endpointEnvelope,
      null,
    ],
    [
      "recovery_confirmation",
      F.genesisAuthorization.recoveryConfirmation,
      recoveryConfirmation,
      null,
    ],
    [
      "signed_genesis_commit",
      F.genesisAuthorization.signedGenesisCommit,
      signedGenesisCommit,
      null,
    ],
    ["signature", F.genesisAuthorization.signature, p(0, 64), 64],
  ] as const;
  for (const [name, key, value, length] of authorizationFields) {
    add(
      `authorization_missing_${name}`,
      "authorization-decode",
      "wire.missing_field",
      {
        authorizationHex: ancV1BytesToHex(
          mutate(authorization, (map) => map.delete(key)),
        ),
      },
    );
    add(
      `authorization_wrong_type_${name}`,
      "authorization-decode",
      "wire.wrong_type",
      {
        authorizationHex: ancV1BytesToHex(
          mutate(authorization, (map) =>
            map.set(key, typeof value === "number" ? "1" : 7),
          ),
        ),
      },
    );
    if (length !== null) {
      for (const [kind, actual] of [
        ["short", length - 1],
        ["long", length + 1],
      ] as const)
        add(
          `authorization_${kind}_${name}`,
          "authorization-decode",
          "wire.length",
          {
            authorizationHex: ancV1BytesToHex(
              mutate(authorization, (map) => map.set(key, p(0xed, actual))),
            ),
          },
        );
    }
  }
  add(
    "authorization_wrong_suite",
    "authorization-decode",
    "wire.wrong_literal",
    {
      authorizationHex: ancV1BytesToHex(
        mutate(authorization, (map) => map.set(F.common.suite, "anc/v2")),
      ),
    },
  );
  add(
    "authorization_wrong_type_literal",
    "authorization-decode",
    "wire.wrong_literal",
    {
      authorizationHex: ancV1BytesToHex(
        mutate(authorization, (map) =>
          map.set(F.common.type, "enrollment-authorization"),
        ),
      ),
    },
  );
  add("authorization_zero_time", "authorization-decode", "wire.range", {
    authorizationHex: ancV1BytesToHex(
      mutate(authorization, (map) => map.set(F.common.createdAt, 0)),
    ),
  });
  add("authorization_wrong_epoch", "authorization-decode", "wire.range", {
    authorizationHex: ancV1BytesToHex(
      mutate(authorization, (map) => map.set(F.genesisAuthorization.epoch, 2)),
    ),
  });
  add(
    "authorization_unknown_field",
    "authorization-decode",
    "wire.unknown_field",
    {
      authorizationHex: ancV1BytesToHex(
        mutate(authorization, (map) => map.set(399, 1)),
      ),
    },
  );
  const authorizationPairs = mapPairs(authorization);
  for (const [name, bytes] of [
    [
      "reversed_map_order",
      concat(Uint8Array.of(0xac), ...authorizationPairs.toReversed()),
    ],
    [
      "duplicate_key",
      concat(
        Uint8Array.of(0xad),
        ...authorizationPairs,
        authorizationPairs[0]!,
      ),
    ],
    [
      "indefinite_map",
      concat(Uint8Array.of(0xbf), ...authorizationPairs, Uint8Array.of(0xff)),
    ],
    [
      "nonshortest_map",
      concat(Uint8Array.of(0xb8, 0x0c), ...authorizationPairs),
    ],
  ] as const)
    add(
      `authorization_noncanonical_${name}`,
      "authorization-decode",
      "wire.invalid_canonical",
      {
        authorizationHex: ancV1BytesToHex(bytes),
      },
    );
  add(
    "authorization_over_limit",
    "authorization-decode",
    "limits.authorization",
    {
      authorizationHex: ancV1BytesToHex(
        p(0, E2EE_SIZE_LIMITS.enrollmentAuthorizationBytes + 1),
      ),
    },
  );
  add("authorization_vault_binding", "authorization-decode", "binding.vault", {
    expectedVaultIdHex: ancV1BytesToHex(p(0xfe, 16)),
  });

  const endpointAuthorization = (bytes: Uint8Array) =>
    ancV1BytesToHex(
      mutate(authorization, (map) =>
        map.set(F.genesisAuthorization.endpointEnvelope, bytes),
      ),
    );
  const endpointFields = [
    ["suite", F.common.suite, E2EE_SUITE_ID, null],
    ["vault_id", F.common.vaultId, vaultId, 16],
    ["type", F.common.type, "endpoint", null],
    ["created_at", F.common.createdAt, endpointTime, null],
    ["envelope_id", F.common.envelopeId, endpointEnvelopeId, 16],
    ["endpoint_id", F.endpoint.endpointId, endpointId, 16],
    ["role", F.endpoint.role, "desktop", null],
    ["unattended", F.endpoint.unattended, false, null],
    [
      "signing_public_key",
      F.endpoint.signingPublicKey,
      endpointSigning.publicKey,
      32,
    ],
    [
      "key_agreement_public_key",
      F.endpoint.keyAgreementPublicKey,
      endpointAgreement.publicKey,
      32,
    ],
    ["added_by_endpoint_id", F.endpoint.addedByEndpointId, endpointId, 16],
    [
      "recovery_confirmation_hash",
      F.endpoint.sasTranscriptHash,
      recoveryConfirmationDigest,
      32,
    ],
    ["signature", F.endpoint.signature, p(0, 64), 64],
  ] as const;
  for (const [name, key, value, length] of endpointFields) {
    add(`endpoint_missing_${name}`, "verify", "wire.endpoint.missing_field", {
      authorizationHex: endpointAuthorization(
        mutate(endpointEnvelope, (map) => map.delete(key)),
      ),
    });
    add(`endpoint_wrong_type_${name}`, "verify", "wire.endpoint.wrong_type", {
      authorizationHex: endpointAuthorization(
        mutate(endpointEnvelope, (map) =>
          map.set(
            key,
            typeof value === "number"
              ? "1"
              : typeof value === "boolean"
                ? 1
                : 7,
          ),
        ),
      ),
    });
    if (length !== null)
      for (const [kind, actual] of [
        ["short", length - 1],
        ["long", length + 1],
      ] as const)
        add(`endpoint_${kind}_${name}`, "verify", "wire.endpoint.length", {
          authorizationHex: endpointAuthorization(
            mutate(endpointEnvelope, (map) => map.set(key, p(0xec, actual))),
          ),
        });
  }
  add("endpoint_wrong_suite", "verify", "wire.endpoint.wrong_literal", {
    authorizationHex: endpointAuthorization(
      mutate(endpointEnvelope, (map) => map.set(F.common.suite, "anc/v2")),
    ),
  });
  add("endpoint_wrong_type_literal", "verify", "wire.endpoint.wrong_literal", {
    authorizationHex: endpointAuthorization(
      mutate(endpointEnvelope, (map) =>
        map.set(F.common.type, "genesis-authorization"),
      ),
    ),
  });
  add("endpoint_created_at_zero", "verify", "wire.endpoint.range", {
    authorizationHex: endpointAuthorization(
      mutate(endpointEnvelope, (map) => map.set(F.common.createdAt, 0)),
    ),
  });
  add("endpoint_role_empty", "verify", "wire.endpoint.role", {
    authorizationHex: endpointAuthorization(
      mutate(endpointEnvelope, (map) => map.set(F.endpoint.role, "")),
    ),
  });
  add("endpoint_role_over_64", "verify", "wire.endpoint.role", {
    authorizationHex: endpointAuthorization(
      mutate(endpointEnvelope, (map) =>
        map.set(F.endpoint.role, "r".repeat(65)),
      ),
    ),
  });
  add("endpoint_unknown_field", "verify", "wire.endpoint.unknown_field", {
    authorizationHex: endpointAuthorization(
      mutate(endpointEnvelope, (map) => map.set(399, 1)),
    ),
  });
  const endpointPairs = mapPairs(endpointEnvelope);
  for (const [name, bytes] of [
    [
      "reversed_map_order",
      concat(Uint8Array.of(0xad), ...endpointPairs.toReversed()),
    ],
    [
      "duplicate_key",
      concat(Uint8Array.of(0xae), ...endpointPairs, endpointPairs[0]!),
    ],
    [
      "indefinite_map",
      concat(Uint8Array.of(0xbf), ...endpointPairs, Uint8Array.of(0xff)),
    ],
    ["nonshortest_map", concat(Uint8Array.of(0xb8, 0x0d), ...endpointPairs)],
  ] as const)
    add(
      `endpoint_noncanonical_${name}`,
      "verify",
      "wire.endpoint.invalid_canonical",
      { authorizationHex: endpointAuthorization(bytes) },
    );
  add("endpoint_over_64k_limit", "verify", "limits.endpoint", {
    authorizationHex: endpointAuthorization(
      p(0, E2EE_SIZE_LIMITS.controlEnvelopeBytes + 1),
    ),
  });
  add("embedded_confirmation_over_64k_limit", "verify", "limits.confirmation", {
    authorizationHex: ancV1BytesToHex(
      mutate(authorization, (map) =>
        map.set(
          F.genesisAuthorization.recoveryConfirmation,
          p(0, E2EE_SIZE_LIMITS.controlEnvelopeBytes + 1),
        ),
      ),
    ),
  });
  add("embedded_commit_over_64k_limit", "verify", "limits.commit", {
    authorizationHex: ancV1BytesToHex(
      mutate(authorization, (map) =>
        map.set(
          F.genesisAuthorization.signedGenesisCommit,
          p(0, E2EE_SIZE_LIMITS.vaultLogEntryBytes + 1),
        ),
      ),
    ),
  });

  const alternateConfirmation = mutate(recoveryConfirmation, (map) =>
    map.set(F.genesisRecoveryConfirmation.recoveryWrapHash, p(0xa1, 32)),
  );
  add(
    "embedded_recovery_confirmation_substitution",
    "verify",
    "binding.recovery_confirmation",
    {
      authorizationHex: ancV1BytesToHex(
        await signAuthorization({
          recoveryConfirmation: alternateConfirmation,
        }),
      ),
    },
  );
  add("authorization_ceremony_substitution", "verify", "binding.ceremony", {
    authorizationHex: ancV1BytesToHex(
      await signAuthorization({ ceremonyId: p(0xa2, 16) }),
    ),
  });
  const authorizationForConfirmation = async (value: Uint8Array) => {
    const digest = await ancV1Hash("genesis-recovery-confirmation", value);
    return signAuthorization({
      recoveryConfirmation: value,
      endpointEnvelope: await signEndpoint((map) =>
        map.set(F.endpoint.sasTranscriptHash, digest),
      ),
    });
  };
  const bootstrapForConfirmation = async (
    value: Uint8Array,
    boundCeremonyId = ceremonyId,
    boundEndpointId = endpointId,
  ) =>
    encodeAncV1GenesisBootstrapTranscript(
      await createAncV1GenesisBootstrapTranscript({
        vaultId,
        ceremonyId: boundCeremonyId,
        endpointId: boundEndpointId,
        endpointSigningPublicKey: endpointSigning.publicKey,
        endpointKeyAgreementPublicKey: endpointAgreement.publicKey,
        enrollmentRef: authorizationId,
        recoveryConfirmation: value,
      }),
    );
  const confirmationCeremonySubstitution = mutate(recoveryConfirmation, (map) =>
    map.set(F.genesisRecoveryConfirmation.ceremonyId, p(0xa3, 16)),
  );
  add("confirmation_ceremony_substitution", "verify", "binding.ceremony", {
    recoveryConfirmationHex: ancV1BytesToHex(confirmationCeremonySubstitution),
    authorizationHex: ancV1BytesToHex(
      await authorizationForConfirmation(confirmationCeremonySubstitution),
    ),
    bootstrapTranscriptHex: ancV1BytesToHex(
      await bootstrapForConfirmation(
        confirmationCeremonySubstitution,
        p(0xa3, 16),
      ),
    ),
  });
  add("authorization_endpoint_substitution", "verify", "binding.endpoint", {
    authorizationHex: ancV1BytesToHex(
      await signAuthorization({ endpointId: p(0xa4, 16) }),
    ),
  });
  const confirmationEndpointSubstitution = mutate(recoveryConfirmation, (map) =>
    map.set(F.genesisRecoveryConfirmation.endpointId, p(0xa5, 16)),
  );
  add("confirmation_endpoint_substitution", "verify", "binding.endpoint", {
    recoveryConfirmationHex: ancV1BytesToHex(confirmationEndpointSubstitution),
    authorizationHex: ancV1BytesToHex(
      await authorizationForConfirmation(confirmationEndpointSubstitution),
    ),
    bootstrapTranscriptHex: ancV1BytesToHex(
      await bootstrapForConfirmation(
        confirmationEndpointSubstitution,
        ceremonyId,
        p(0xa5, 16),
      ),
    ),
  });
  add("endpoint_id_substitution", "verify", "binding.endpoint", {
    authorizationHex: ancV1BytesToHex(
      await signAuthorization({
        endpointEnvelope: await signEndpoint((map) =>
          map.set(F.endpoint.endpointId, p(0xa6, 16)),
        ),
      }),
    ),
  });
  add("endpoint_added_by_substitution", "verify", "binding.endpoint", {
    authorizationHex: ancV1BytesToHex(
      await signAuthorization({
        endpointEnvelope: await signEndpoint((map) =>
          map.set(F.endpoint.addedByEndpointId, p(0xa7, 16)),
        ),
      }),
    ),
  });
  add("endpoint_recovery_hash_substitution", "verify", "binding.recovery", {
    authorizationHex: ancV1BytesToHex(
      await signAuthorization({
        endpointEnvelope: await signEndpoint((map) =>
          map.set(F.endpoint.sasTranscriptHash, p(0xa8, 32)),
        ),
      }),
    ),
  });
  for (const [name, key, value] of [
    ["vault", F.common.vaultId, p(0xa0, 16)],
    ["ceremony", F.genesisBootstrapTranscript.ceremonyId, p(0xa1, 16)],
    ["endpoint", F.genesisBootstrapTranscript.endpointId, p(0xa2, 16)],
    [
      "endpoint_signing_key",
      F.genesisBootstrapTranscript.endpointSigningPublicKey,
      p(0xa9, 32),
    ],
    [
      "endpoint_agreement_key",
      F.genesisBootstrapTranscript.endpointKeyAgreementPublicKey,
      p(0xaa, 32),
    ],
    ["enrollment_ref", F.genesisBootstrapTranscript.enrollmentRef, p(0xab, 16)],
    ["recovery_id", F.genesisBootstrapTranscript.recoveryId, p(0xac, 16)],
    [
      "recovery_signing_key",
      F.genesisBootstrapTranscript.recoverySigningPublicKey,
      p(0xad, 32),
    ],
    [
      "recovery_agreement_key",
      F.genesisBootstrapTranscript.recoveryKeyAgreementPublicKey,
      p(0xae, 32),
    ],
    ["recovery_generation", F.genesisBootstrapTranscript.recoveryGeneration, 2],
    ["epoch", F.genesisBootstrapTranscript.epoch, 2],
    [
      "recovery_wrap_hash",
      F.genesisBootstrapTranscript.recoveryWrapHash,
      p(0xaf, 32),
    ],
    [
      "recovery_confirmation_hash",
      F.genesisBootstrapTranscript.recoveryConfirmationHash,
      p(0xb0, 32),
    ],
  ] as const)
    add(`bootstrap_${name}_substitution`, "verify", "binding.bootstrap", {
      bootstrapTranscriptHex: ancV1BytesToHex(
        mutate(bootstrapTranscript, (map) => map.set(key, value)),
      ),
    });
  add("endpoint_unattended_true", "verify", "binding.role", {
    authorizationHex: ancV1BytesToHex(
      await signAuthorization({
        endpointEnvelope: await signEndpoint((map) =>
          map.set(F.endpoint.unattended, true),
        ),
      }),
    ),
  });

  for (const [name, key, value] of [
    ["recovery_id", F.genesisRecoveryConfirmation.recoveryId, p(0xb1, 16)],
    [
      "recovery_signing_key",
      F.genesisRecoveryConfirmation.recoverySigningPublicKey,
      p(0xb2, 32),
    ],
    [
      "recovery_agreement_key",
      F.genesisRecoveryConfirmation.recoveryKeyAgreementPublicKey,
      p(0xb3, 32),
    ],
    [
      "recovery_wrap_hash",
      F.genesisRecoveryConfirmation.recoveryWrapHash,
      p(0xb4, 32),
    ],
  ] as const) {
    const substituted = mutate(recoveryConfirmation, (map) =>
      map.set(key, value),
    );
    const substitutedConfirmationHash = await ancV1Hash(
      "genesis-recovery-confirmation",
      substituted,
    );
    add(`recovery_${name}_commit_mismatch`, "verify", "binding.recovery", {
      recoveryConfirmationHex: ancV1BytesToHex(substituted),
      bootstrapTranscriptHex: ancV1BytesToHex(
        await bootstrapForConfirmation(substituted),
      ),
      authorizationHex: ancV1BytesToHex(
        await signAuthorization({
          recoveryConfirmation: substituted,
          endpointEnvelope: await signEndpoint((map) =>
            map.set(F.endpoint.sasTranscriptHash, substitutedConfirmationHash),
          ),
        }),
      ),
    });
  }

  const addCommitCase = async (
    name: string,
    category: AncV1NativeGenesisAuthorizationCategory,
    changedCommit: ControlMembershipCommit,
    entryUpdate: Partial<
      Omit<SignedControlLogEntry, "signature" | "innerEnvelope">
    > = {},
  ) => {
    const changedEntry = await signCommit(changedCommit, entryUpdate);
    add(name, "verify", category, {
      authorizationHex: ancV1BytesToHex(
        await signAuthorization({ signedGenesisCommit: changedEntry }),
      ),
    });
  };
  await addCommitCase("commit_vault_substitution", "binding.commit", {
    ...commit,
    vaultId: "c1".repeat(16),
  });
  await addCommitCase("commit_ceremony_substitution", "binding.ceremony", {
    ...commit,
    ceremonyId: "c2".repeat(16),
  });
  await addCommitCase("commit_wrong_kind", "binding.role", {
    ...commit,
    ceremonyKind: "add_device",
  });
  await addCommitCase("commit_wrong_epoch", "binding.commit", {
    ...commit,
    epoch: 2,
  });
  await addCommitCase("commit_previous_membership_head", "binding.head", {
    ...commit,
    previousMembershipHash: "c3".repeat(32),
  });
  await addCommitCase("commit_removed_member", "binding.member", {
    ...commit,
    removedEndpointIds: ["c4".repeat(16)],
  });
  await addCommitCase("commit_rotation_completed", "binding.commit", {
    ...commit,
    rotationCompleted: true,
  });
  await addCommitCase("commit_outstanding_jobs_resolved", "binding.commit", {
    ...commit,
    outstandingJobsResolved: true,
  });
  await addCommitCase("commit_recovery_generation", "binding.recovery", {
    ...commit,
    recoveryGeneration: 2,
  });
  await addCommitCase("member_extra", "binding.member", {
    ...commit,
    activeMembers: [member, { ...member, endpointId: "c7".repeat(16) }],
  });
  for (const [name, changed] of [
    ["endpoint_id", { endpointId: "d1".repeat(16) }],
    ["role", { role: "broker" as const, unattended: true }],
    ["signing_key", { signingPublicKey: "d2".repeat(32) }],
    ["agreement_key", { keyAgreementPublicKey: "d3".repeat(32) }],
    ["enrollment_ref", { enrollmentRef: "d4".repeat(16) }],
  ] as const)
    await addCommitCase(`member_${name}_substitution`, "binding.member", {
      ...commit,
      activeMembers: [{ ...member, ...changed }],
    });
  await addCommitCase("entry_sequence_nonzero", "binding.head", commit, {
    sequence: 1,
  });
  await addCommitCase("entry_previous_hash_nonzero", "binding.head", commit, {
    previousHash: "d5".repeat(32),
  });
  await addCommitCase("entry_signer_substitution", "binding.endpoint", commit, {
    signerEndpointId: "d6".repeat(16),
  });
  await addCommitCase("entry_vault_substitution", "binding.commit", commit, {
    vaultId: "d7".repeat(16),
  });

  add("callback_commit_substitution", "verify", "binding.commit", {
    callbackSignedGenesisCommitHex: ancV1BytesToHex(
      await signCommit({ ...commit, recoveryWrapHash: "d8".repeat(32) }),
    ),
  });
  const confirmationAfterEndpoint = mutate(recoveryConfirmation, (map) =>
    map.set(F.genesisRecoveryConfirmation.confirmedAt, endpointTime + 1),
  );
  add("confirmation_after_endpoint", "verify", "binding.order", {
    recoveryConfirmationHex: ancV1BytesToHex(confirmationAfterEndpoint),
    bootstrapTranscriptHex: ancV1BytesToHex(
      await bootstrapForConfirmation(confirmationAfterEndpoint),
    ),
    authorizationHex: ancV1BytesToHex(
      await authorizationForConfirmation(confirmationAfterEndpoint),
    ),
  });
  add("endpoint_after_commit", "verify", "binding.order", {
    authorizationHex: ancV1BytesToHex(
      await signAuthorization({
        endpointEnvelope: await signEndpoint((map) =>
          map.set(F.common.createdAt, commitTime + 1),
        ),
      }),
    ),
  });
  add("commit_after_authorization", "verify", "binding.order", {
    authorizationHex: ancV1BytesToHex(
      await signAuthorization({ createdAt: commitTime - 1 }),
    ),
  });
  add("authorization_before_confirmation", "verify", "binding.time", {
    authorizationHex: ancV1BytesToHex(
      await signAuthorization({ createdAt: confirmationTime - 1 }),
    ),
  });
  add("fractional_commit_after_authorization", "verify", "binding.order", {
    authorizationHex: ancV1BytesToHex(
      await signAuthorization({
        createdAt: commitTime,
        signedGenesisCommit: await signCommit(commit, {
          createdAt: new Date(commitTime * 1_000 + 500).toISOString(),
        }),
      }),
    ),
  });

  const flipSignature = (encoded: Uint8Array, key: number) =>
    mutate(encoded, (map) => {
      const signature = (map.get(key) as Uint8Array).slice();
      signature[0] ^= 0x80;
      map.set(key, signature);
    });
  add("wrong_endpoint_signature", "verify", "crypto.endpoint_signature", {
    authorizationHex: ancV1BytesToHex(
      await signAuthorization({
        endpointEnvelope: flipSignature(endpointEnvelope, F.endpoint.signature),
      }),
    ),
  });
  add("wrong_commit_signature", "verify", "crypto.commit_signature", {
    authorizationHex: ancV1BytesToHex(
      await signAuthorization({
        signedGenesisCommit: flipSignature(
          signedGenesisCommit,
          F.logEntry.signature,
        ),
      }),
    ),
  });
  add(
    "wrong_authorization_signature",
    "verify",
    "crypto.authorization_signature",
    {
      authorizationHex: ancV1BytesToHex(
        flipSignature(authorization, F.genesisAuthorization.signature),
      ),
    },
  );
  add(
    "wrong_authorization_signer",
    "verify",
    "crypto.authorization_signature",
    {
      authorizationHex: ancV1BytesToHex(
        await signAuthorization(
          {},
          "genesis-authorization",
          alternateSigning.privateKey,
        ),
      ),
    },
  );
  add("endpoint_wrong_domain", "verify", "crypto.domain", {
    authorizationHex: ancV1BytesToHex(
      await signAuthorization({
        endpointEnvelope: await signEndpoint(
          undefined,
          "genesis-authorization",
        ),
      }),
    ),
  });
  add("commit_wrong_domain", "verify", "crypto.domain", {
    authorizationHex: ancV1BytesToHex(
      await signAuthorization({
        signedGenesisCommit: await signCommit(commit, {}, "endpoint"),
      }),
    ),
  });
  add("authorization_wrong_domain", "verify", "crypto.domain", {
    authorizationHex: ancV1BytesToHex(await signAuthorization({}, "endpoint")),
  });

  const domain = (label: E2EEDomainTag) => ({
    escaped: `anc/v1/${label}\\0`,
    utf8Hex: ancV1BytesToHex(e2eeDomainSeparationPrefix(label)),
  });
  return {
    schema: ANC_V1_NATIVE_GENESIS_AUTHORIZATION_CORPUS_SCHEMA,
    suite: E2EE_SUITE_ID,
    encoding: "hex",
    generator: ANC_V1_NATIVE_GENESIS_AUTHORIZATION_GENERATOR,
    protocolBaseCommit: provenance.protocolBaseCommit,
    sourceAnchors: provenance.sources,
    domains: {
      recoveryConfirmation: domain("genesis-recovery-confirmation"),
      endpoint: domain("endpoint"),
      commit: domain("log-entry"),
      authorization: domain("genesis-authorization"),
    },
    fieldKeys: {
      common: F.common,
      recoveryConfirmation: F.genesisRecoveryConfirmation,
      endpoint: F.endpoint,
      authorization: F.genesisAuthorization,
      logEntry: F.logEntry,
      membershipCommit: F.controlMembership,
    },
    limits: {
      confirmationBytes: E2EE_SIZE_LIMITS.controlEnvelopeBytes,
      authorizationBytes: E2EE_SIZE_LIMITS.enrollmentAuthorizationBytes,
      signedCommitBytes: E2EE_SIZE_LIMITS.vaultLogEntryBytes,
    },
    categoryVocabulary: ANC_V1_NATIVE_GENESIS_AUTHORIZATION_CATEGORIES,
    exact: {
      recoveryConfirmationHex: ancV1BytesToHex(recoveryConfirmation),
      recoveryConfirmationDigestHex: ancV1BytesToHex(
        recoveryConfirmationDigest,
      ),
      bootstrapTranscriptHex: ancV1BytesToHex(bootstrapTranscript),
      bootstrapTranscriptDigestHex: ancV1BytesToHex(bootstrapTranscriptDigest),
      endpointEnvelopeHex: ancV1BytesToHex(endpointEnvelope),
      signedGenesisCommitHex: ancV1BytesToHex(signedGenesisCommit),
      authorizationHex: ancV1BytesToHex(authorization),
      authorizationDigestHex: ancV1BytesToHex(authorizationDigest),
      parsed: {
        vaultIdHex: ancV1BytesToHex(vaultId),
        ceremonyIdHex: ancV1BytesToHex(ceremonyId),
        endpointIdHex: ancV1BytesToHex(endpointId),
        endpointEnvelopeIdHex: ancV1BytesToHex(endpointEnvelopeId),
        authorizationIdHex: ancV1BytesToHex(authorizationId),
        logEntryIdHex: ancV1BytesToHex(logEntryId),
        endpointSigningPublicKeyHex: ancV1BytesToHex(endpointSigning.publicKey),
        endpointKeyAgreementPublicKeyHex: ancV1BytesToHex(
          endpointAgreement.publicKey,
        ),
        recoveryIdHex: ancV1BytesToHex(recoveryId),
        recoverySigningPublicKeyHex: ancV1BytesToHex(recoverySigning.publicKey),
        recoveryKeyAgreementPublicKeyHex: ancV1BytesToHex(
          recoveryAgreement.publicKey,
        ),
        recoveryWrapHashHex: ancV1BytesToHex(recoveryWrapHash),
        confirmationTime,
        endpointTime,
        commitTime,
        authorizationTime,
        epoch: 1,
        sequence: 0,
        previousHeadHex: "00".repeat(32),
        memberRole: "endpoint",
        unattended: false,
      },
    },
    positiveCases,
    negativeCases: cases,
  };
}
