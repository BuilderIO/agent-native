import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  type AncV1CanonicalValue,
  ancV1BytesToHex,
  ancV1HexToBytes,
  decodeAncV1Canonical,
  encodeAncV1Canonical,
} from "./canonical.js";
import {
  decodeSignedControlLogEntry,
  encodeSignedControlLogEntry,
  encodeUnsignedControlLogEntry,
} from "./control-log.js";
import {
  createAncV1GenesisBootstrapTranscript,
  decodeAncV1GenesisBootstrapTranscript,
  encodeAncV1GenesisBootstrapTranscript,
  hashAncV1GenesisBootstrapTranscript,
} from "./genesis-bootstrap-transcript.js";
import {
  decodeAncV1GenesisAuthorization,
  decodeAncV1GenesisRecoveryConfirmation,
  encodeAncV1GenesisAuthorization,
  encodeAncV1GenesisRecoveryConfirmation,
  encodeAncV1UnsignedGenesisAuthorization,
  hashAncV1GenesisRecoveryConfirmation,
  verifyAncV1GenesisAuthorization,
} from "./genesis-ceremony-codecs.js";
import {
  ANC_V1_NATIVE_GENESIS_AUTHORIZATION_CATEGORIES,
  ANC_V1_NATIVE_GENESIS_AUTHORIZATION_CORPUS_SCHEMA,
  ANC_V1_NATIVE_GENESIS_AUTHORIZATION_GENERATOR,
  ANC_V1_NATIVE_GENESIS_AUTHORIZATION_SOURCE_PATHS,
  type AncV1NativeGenesisAuthorizationCase,
  type AncV1NativeGenesisAuthorizationCategory,
  buildAncV1NativeGenesisAuthorizationVectors,
} from "./native-genesis-authorization-vectors.js";
import { ancV1Hash, ancV1VerifyDetached } from "./portable-crypto.js";
import { E2EE_ENVELOPE_FIELDS, E2EE_SIZE_LIMITS } from "./suite.js";

const PROTOCOL_BASE_COMMIT = "93eedf69431ee33fcfb71f075428f0d3c199eee7";
const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const FIXTURE = new URL(
  "./fixtures/anc-v1-native-genesis-authorization-vectors.json",
  import.meta.url,
);
const F = E2EE_ENVELOPE_FIELDS;
const hex = z.string().regex(/^(?:[0-9a-f]{2})+$/);
const hex16 = z.string().regex(/^[0-9a-f]{32}$/);
const hex32 = z.string().regex(/^[0-9a-f]{64}$/);
const category = z.enum(ANC_V1_NATIVE_GENESIS_AUTHORIZATION_CATEGORIES);
const literalKeyObject = (value: Readonly<Record<string, number>>) =>
  z
    .object(
      Object.fromEntries(
        Object.entries(value).map(([name, key]) => [name, z.literal(key)]),
      ),
    )
    .strict();
const source = <
  T extends (typeof ANC_V1_NATIVE_GENESIS_AUTHORIZATION_SOURCE_PATHS)[number],
>(
  path: T,
) => z.object({ path: z.literal(path), sha256: hex32 }).strict();
const domain = (label: string) =>
  z
    .object({
      escaped: z.literal(`anc/v1/${label}\\0`),
      utf8Hex: hex,
    })
    .strict();
const caseSchema = z
  .object({
    name: z.string().min(1),
    stage: z.enum(["confirmation-decode", "authorization-decode", "verify"]),
    authorizationHex: hex,
    recoveryConfirmationHex: hex,
    bootstrapTranscriptHex: hex,
    callbackSignedGenesisCommitHex: hex.nullable(),
    expectedVaultIdHex: hex16,
    expectedCategory: category,
  })
  .strict();
const positiveCaseSchema = z
  .object({
    name: z.string().min(1),
    authorizationHex: hex,
    recoveryConfirmationHex: hex,
    bootstrapTranscriptHex: hex,
  })
  .strict();
const corpusSchema = z
  .object({
    schema: z.literal(ANC_V1_NATIVE_GENESIS_AUTHORIZATION_CORPUS_SCHEMA),
    suite: z.literal("anc/v1"),
    encoding: z.literal("hex"),
    generator: z.literal(ANC_V1_NATIVE_GENESIS_AUTHORIZATION_GENERATOR),
    protocolBaseCommit: z.literal(PROTOCOL_BASE_COMMIT),
    sourceAnchors: z.tuple(
      ANC_V1_NATIVE_GENESIS_AUTHORIZATION_SOURCE_PATHS.map(source) as [
        ReturnType<typeof source>,
        ReturnType<typeof source>,
        ReturnType<typeof source>,
        ReturnType<typeof source>,
        ReturnType<typeof source>,
        ReturnType<typeof source>,
        ReturnType<typeof source>,
      ],
    ),
    domains: z
      .object({
        recoveryConfirmation: domain("genesis-recovery-confirmation"),
        endpoint: domain("endpoint"),
        commit: domain("log-entry"),
        authorization: domain("genesis-authorization"),
      })
      .strict(),
    fieldKeys: z
      .object({
        common: literalKeyObject(F.common),
        recoveryConfirmation: literalKeyObject(F.genesisRecoveryConfirmation),
        endpoint: literalKeyObject(F.endpoint),
        authorization: literalKeyObject(F.genesisAuthorization),
        logEntry: literalKeyObject(F.logEntry),
        membershipCommit: literalKeyObject(F.controlMembership),
      })
      .strict(),
    limits: z
      .object({
        confirmationBytes: z.literal(E2EE_SIZE_LIMITS.controlEnvelopeBytes),
        authorizationBytes: z.literal(
          E2EE_SIZE_LIMITS.enrollmentAuthorizationBytes,
        ),
        signedCommitBytes: z.literal(E2EE_SIZE_LIMITS.vaultLogEntryBytes),
      })
      .strict(),
    categoryVocabulary: z.tuple(
      ANC_V1_NATIVE_GENESIS_AUTHORIZATION_CATEGORIES.map((value) =>
        z.literal(value),
      ) as [
        z.ZodLiteral<AncV1NativeGenesisAuthorizationCategory>,
        ...z.ZodLiteral<AncV1NativeGenesisAuthorizationCategory>[],
      ],
    ),
    exact: z
      .object({
        recoveryConfirmationHex: hex,
        recoveryConfirmationDigestHex: hex32,
        bootstrapTranscriptHex: hex,
        bootstrapTranscriptDigestHex: hex32,
        endpointEnvelopeHex: hex,
        signedGenesisCommitHex: hex,
        authorizationHex: hex,
        authorizationDigestHex: hex32,
        parsed: z
          .object({
            vaultIdHex: hex16,
            ceremonyIdHex: hex16,
            endpointIdHex: hex16,
            endpointEnvelopeIdHex: hex16,
            authorizationIdHex: hex16,
            logEntryIdHex: hex16,
            endpointSigningPublicKeyHex: hex32,
            endpointKeyAgreementPublicKeyHex: hex32,
            recoveryIdHex: hex16,
            recoverySigningPublicKeyHex: hex32,
            recoveryKeyAgreementPublicKeyHex: hex32,
            recoveryWrapHashHex: hex32,
            confirmationTime: z.number().int().positive(),
            endpointTime: z.number().int().positive(),
            commitTime: z.number().int().positive(),
            authorizationTime: z.number().int().positive(),
            epoch: z.literal(1),
            sequence: z.literal(0),
            previousHeadHex: hex32,
            memberRole: z.literal("endpoint"),
            unattended: z.literal(false),
          })
          .strict(),
      })
      .strict(),
    positiveCases: z.array(positiveCaseSchema).min(7),
    negativeCases: z.array(caseSchema).min(100),
  })
  .strict();

const equal = (left: Uint8Array, right: Uint8Array) =>
  left.length === right.length &&
  left.every((value, index) => value === right[index]);

function structuralOracle(
  encoded: Uint8Array,
  kind: "confirmation" | "authorization",
  expectedVaultId: Uint8Array,
): AncV1NativeGenesisAuthorizationCategory | null {
  const maximum =
    kind === "confirmation"
      ? E2EE_SIZE_LIMITS.controlEnvelopeBytes
      : E2EE_SIZE_LIMITS.enrollmentAuthorizationBytes;
  if (encoded.length > maximum)
    return kind === "confirmation"
      ? "limits.confirmation"
      : "limits.authorization";
  let value: AncV1CanonicalValue;
  try {
    value = decodeAncV1Canonical(encoded, { maxBytes: maximum });
  } catch {
    return "wire.invalid_canonical";
  }
  if (!(value instanceof Map)) return "wire.wrong_type";
  const specific =
    kind === "confirmation"
      ? F.genesisRecoveryConfirmation
      : F.genesisAuthorization;
  const keys =
    kind === "confirmation"
      ? [
          F.common.suite,
          F.common.vaultId,
          F.common.type,
          ...Object.values(specific),
        ]
      : [...Object.values(F.common), ...Object.values(specific)];
  if ([...value.keys()].some((key) => !keys.includes(key)))
    return "wire.unknown_field";
  if (value.size !== keys.length || keys.some((key) => !value.has(key)))
    return "wire.missing_field";
  const byteLengths = new Map<number, number>([
    [F.common.vaultId, 16],
    ...(kind === "confirmation"
      ? [
          [F.genesisRecoveryConfirmation.ceremonyId, 16],
          [F.genesisRecoveryConfirmation.endpointId, 16],
          [F.genesisRecoveryConfirmation.recoveryId, 16],
          [F.genesisRecoveryConfirmation.recoverySigningPublicKey, 32],
          [F.genesisRecoveryConfirmation.recoveryKeyAgreementPublicKey, 32],
          [F.genesisRecoveryConfirmation.recoveryWrapHash, 32],
        ]
      : [
          [F.common.envelopeId, 16],
          [F.genesisAuthorization.ceremonyId, 16],
          [F.genesisAuthorization.endpointId, 16],
          [F.genesisAuthorization.signature, 64],
        ]),
  ] as [number, number][]);
  for (const [key, length] of byteLengths) {
    const field = value.get(key);
    if (!(field instanceof Uint8Array)) return "wire.wrong_type";
    if (field.length !== length) return "wire.length";
  }
  for (const key of kind === "confirmation"
    ? [
        F.genesisRecoveryConfirmation.confirmedAt,
        F.genesisRecoveryConfirmation.recoveryGeneration,
      ]
    : [F.common.createdAt, F.genesisAuthorization.epoch])
    if (typeof value.get(key) !== "number") return "wire.wrong_type";
  if (
    kind === "authorization" &&
    [
      F.genesisAuthorization.endpointEnvelope,
      F.genesisAuthorization.recoveryConfirmation,
      F.genesisAuthorization.signedGenesisCommit,
    ].some((key) => !(value.get(key) instanceof Uint8Array))
  )
    return "wire.wrong_type";
  if (
    typeof value.get(F.common.suite) !== "string" ||
    typeof value.get(F.common.type) !== "string"
  )
    return "wire.wrong_type";
  if (
    value.get(F.common.suite) !== "anc/v1" ||
    value.get(F.common.type) !==
      (kind === "confirmation"
        ? "genesis-recovery-confirmation"
        : "genesis-authorization")
  )
    return "wire.wrong_literal";
  const timestamp = value.get(
    kind === "confirmation"
      ? F.genesisRecoveryConfirmation.confirmedAt
      : F.common.createdAt,
  ) as number;
  const fixed = value.get(
    kind === "confirmation"
      ? F.genesisRecoveryConfirmation.recoveryGeneration
      : F.genesisAuthorization.epoch,
  );
  if (!Number.isSafeInteger(timestamp) || timestamp < 1 || fixed !== 1)
    return "wire.range";
  if (!equal(value.get(F.common.vaultId) as Uint8Array, expectedVaultId))
    return "binding.vault";
  return null;
}

function endpointStructuralOracle(
  encoded: Uint8Array,
): AncV1NativeGenesisAuthorizationCategory | null {
  if (encoded.length > E2EE_SIZE_LIMITS.controlEnvelopeBytes)
    return "limits.endpoint";
  let value: AncV1CanonicalValue;
  try {
    value = decodeAncV1Canonical(encoded, {
      maxBytes: E2EE_SIZE_LIMITS.controlEnvelopeBytes,
    });
  } catch {
    return "wire.endpoint.invalid_canonical";
  }
  if (!(value instanceof Map)) return "wire.endpoint.wrong_type";
  const keys = [...Object.values(F.common), ...Object.values(F.endpoint)];
  if ([...value.keys()].some((key) => !keys.includes(key)))
    return "wire.endpoint.unknown_field";
  if (value.size !== keys.length || keys.some((key) => !value.has(key)))
    return "wire.endpoint.missing_field";
  const byteLengths = new Map<number, number>([
    [F.common.vaultId, 16],
    [F.common.envelopeId, 16],
    [F.endpoint.endpointId, 16],
    [F.endpoint.signingPublicKey, 32],
    [F.endpoint.keyAgreementPublicKey, 32],
    [F.endpoint.addedByEndpointId, 16],
    [F.endpoint.sasTranscriptHash, 32],
    [F.endpoint.signature, 64],
  ]);
  for (const [key, length] of byteLengths) {
    const field = value.get(key);
    if (!(field instanceof Uint8Array)) return "wire.endpoint.wrong_type";
    if (field.length !== length) return "wire.endpoint.length";
  }
  if (
    typeof value.get(F.common.suite) !== "string" ||
    typeof value.get(F.common.type) !== "string" ||
    typeof value.get(F.endpoint.role) !== "string" ||
    typeof value.get(F.endpoint.unattended) !== "boolean" ||
    typeof value.get(F.common.createdAt) !== "number"
  )
    return "wire.endpoint.wrong_type";
  if (
    value.get(F.common.suite) !== "anc/v1" ||
    value.get(F.common.type) !== "endpoint"
  )
    return "wire.endpoint.wrong_literal";
  const createdAt = value.get(F.common.createdAt) as number;
  if (!Number.isSafeInteger(createdAt) || createdAt < 1)
    return "wire.endpoint.range";
  const role = value.get(F.endpoint.role) as string;
  if (role.length < 1 || role.length > 64) return "wire.endpoint.role";
  return null;
}

async function bootstrapBindingOracle(
  encoded: Uint8Array,
  authorization: ReturnType<typeof decodeAncV1GenesisAuthorization>,
  confirmation: ReturnType<typeof decodeAncV1GenesisRecoveryConfirmation>,
  endpoint: Map<number, AncV1CanonicalValue>,
): Promise<AncV1NativeGenesisAuthorizationCategory | null> {
  let value: AncV1CanonicalValue;
  try {
    value = decodeAncV1Canonical(encoded, {
      maxBytes: E2EE_SIZE_LIMITS.genesisBootstrapTranscriptBytes,
    });
  } catch {
    return "binding.bootstrap";
  }
  if (!(value instanceof Map)) return "binding.bootstrap";
  const keys = [
    F.common.suite,
    F.common.vaultId,
    F.common.type,
    ...Object.values(F.genesisBootstrapTranscript),
  ];
  if (
    value.size !== keys.length ||
    keys.some((key) => !value.has(key)) ||
    [...value.keys()].some((key) => !keys.includes(key))
  )
    return "binding.bootstrap";
  const bytes = (key: number, length: number) => {
    const field = value.get(key);
    return field instanceof Uint8Array && field.length === length
      ? field
      : null;
  };
  const vaultId = bytes(F.common.vaultId, 16);
  const ceremonyId = bytes(F.genesisBootstrapTranscript.ceremonyId, 16);
  const endpointId = bytes(F.genesisBootstrapTranscript.endpointId, 16);
  const endpointSigningKey = bytes(
    F.genesisBootstrapTranscript.endpointSigningPublicKey,
    32,
  );
  const endpointAgreementKey = bytes(
    F.genesisBootstrapTranscript.endpointKeyAgreementPublicKey,
    32,
  );
  const enrollmentRef = bytes(F.genesisBootstrapTranscript.enrollmentRef, 16);
  const recoveryId = bytes(F.genesisBootstrapTranscript.recoveryId, 16);
  const recoverySigningKey = bytes(
    F.genesisBootstrapTranscript.recoverySigningPublicKey,
    32,
  );
  const recoveryAgreementKey = bytes(
    F.genesisBootstrapTranscript.recoveryKeyAgreementPublicKey,
    32,
  );
  const recoveryWrapHash = bytes(
    F.genesisBootstrapTranscript.recoveryWrapHash,
    32,
  );
  const confirmationHash = bytes(
    F.genesisBootstrapTranscript.recoveryConfirmationHash,
    32,
  );
  if (
    value.get(F.common.suite) !== "anc/v1" ||
    value.get(F.common.type) !== "genesis-bootstrap-transcript" ||
    !vaultId ||
    !ceremonyId ||
    !endpointId ||
    !endpointSigningKey ||
    !endpointAgreementKey ||
    !enrollmentRef ||
    !recoveryId ||
    !recoverySigningKey ||
    !recoveryAgreementKey ||
    !recoveryWrapHash ||
    !confirmationHash ||
    value.get(F.genesisBootstrapTranscript.recoveryGeneration) !== 1 ||
    value.get(F.genesisBootstrapTranscript.epoch) !== 1
  )
    return "binding.bootstrap";
  const expectedConfirmationHash = await ancV1Hash(
    "genesis-recovery-confirmation",
    encodeAncV1GenesisRecoveryConfirmation(confirmation),
  );
  if (
    !equal(vaultId, authorization.vaultId) ||
    !equal(ceremonyId, authorization.ceremonyId) ||
    !equal(ceremonyId, confirmation.ceremonyId) ||
    !equal(endpointId, authorization.endpointId) ||
    !equal(endpointId, confirmation.endpointId) ||
    !equal(endpointId, endpoint.get(F.endpoint.endpointId) as Uint8Array) ||
    !equal(
      endpointSigningKey,
      endpoint.get(F.endpoint.signingPublicKey) as Uint8Array,
    ) ||
    !equal(
      endpointAgreementKey,
      endpoint.get(F.endpoint.keyAgreementPublicKey) as Uint8Array,
    ) ||
    !equal(enrollmentRef, authorization.envelopeId) ||
    !equal(recoveryId, confirmation.recoveryId) ||
    !equal(recoverySigningKey, confirmation.recoverySigningPublicKey) ||
    !equal(recoveryAgreementKey, confirmation.recoveryKeyAgreementPublicKey) ||
    !equal(recoveryWrapHash, confirmation.recoveryWrapHash) ||
    !equal(confirmationHash, expectedConfirmationHash)
  )
    return "binding.bootstrap";
  return null;
}

async function verifyOracle(
  testCase: AncV1NativeGenesisAuthorizationCase,
): Promise<AncV1NativeGenesisAuthorizationCategory | null> {
  const authorizationBytes = ancV1HexToBytes(testCase.authorizationHex);
  const confirmationBytes = ancV1HexToBytes(testCase.recoveryConfirmationHex);
  const expectedVaultId = ancV1HexToBytes(testCase.expectedVaultIdHex);
  const authorizationMap = decodeAncV1Canonical(authorizationBytes, {
    maxBytes: E2EE_SIZE_LIMITS.enrollmentAuthorizationBytes,
  }) as Map<number, AncV1CanonicalValue>;
  const endpointBytes = authorizationMap.get(
    F.genesisAuthorization.endpointEnvelope,
  ) as Uint8Array;
  const endpointCategory = endpointStructuralOracle(endpointBytes);
  if (endpointCategory) return endpointCategory;
  const embeddedConfirmation = authorizationMap.get(
    F.genesisAuthorization.recoveryConfirmation,
  );
  if (
    embeddedConfirmation instanceof Uint8Array &&
    embeddedConfirmation.length > E2EE_SIZE_LIMITS.controlEnvelopeBytes
  )
    return "limits.confirmation";
  const embeddedCommit = authorizationMap.get(
    F.genesisAuthorization.signedGenesisCommit,
  );
  if (
    embeddedCommit instanceof Uint8Array &&
    embeddedCommit.length > E2EE_SIZE_LIMITS.vaultLogEntryBytes
  )
    return "limits.commit";
  const authorization = decodeAncV1GenesisAuthorization(authorizationBytes, {
    expectedVaultId,
  });
  const confirmation = decodeAncV1GenesisRecoveryConfirmation(
    confirmationBytes,
    { expectedVaultId },
  );
  if (!equal(authorization.recoveryConfirmation, confirmationBytes))
    return "binding.recovery_confirmation";
  if (!equal(authorization.ceremonyId, confirmation.ceremonyId))
    return "binding.ceremony";
  if (!equal(authorization.endpointId, confirmation.endpointId))
    return "binding.endpoint";

  const endpointMap = decodeAncV1Canonical(
    authorization.endpointEnvelope,
  ) as Map<number, AncV1CanonicalValue>;
  const endpointVault = endpointMap.get(F.common.vaultId) as Uint8Array;
  const endpointId = endpointMap.get(F.endpoint.endpointId) as Uint8Array;
  const addedBy = endpointMap.get(F.endpoint.addedByEndpointId) as Uint8Array;
  const endpointSigningKey = endpointMap.get(
    F.endpoint.signingPublicKey,
  ) as Uint8Array;
  const endpointUnsigned = new Map(endpointMap);
  const endpointSignature = endpointUnsigned.get(
    F.endpoint.signature,
  ) as Uint8Array;
  endpointUnsigned.delete(F.endpoint.signature);
  if (!equal(endpointVault, expectedVaultId)) return "binding.vault";
  if (
    !equal(endpointId, authorization.endpointId) ||
    !equal(addedBy, authorization.endpointId)
  )
    return "binding.endpoint";
  if (endpointMap.get(F.endpoint.unattended) !== false) return "binding.role";
  const expectedConfirmationHash = await ancV1Hash(
    "genesis-recovery-confirmation",
    confirmationBytes,
  );
  if (
    !equal(
      endpointMap.get(F.endpoint.sasTranscriptHash) as Uint8Array,
      expectedConfirmationHash,
    )
  )
    return "binding.recovery";
  const bootstrapCategory = await bootstrapBindingOracle(
    ancV1HexToBytes(testCase.bootstrapTranscriptHex),
    authorization,
    confirmation,
    endpointMap,
  );
  if (bootstrapCategory) return bootstrapCategory;
  if (
    !(await ancV1VerifyDetached(
      "endpoint",
      encodeAncV1Canonical(endpointUnsigned),
      endpointSignature,
      endpointSigningKey,
    ))
  )
    return (await ancV1VerifyDetached(
      "genesis-authorization",
      encodeAncV1Canonical(endpointUnsigned),
      endpointSignature,
      endpointSigningKey,
    ))
      ? "crypto.domain"
      : "crypto.endpoint_signature";
  const { signature: authorizationSignature, ...authorizationUnsigned } =
    authorization;
  if (
    !(await ancV1VerifyDetached(
      "genesis-authorization",
      encodeAncV1UnsignedGenesisAuthorization(authorizationUnsigned),
      authorizationSignature,
      endpointSigningKey,
    ))
  )
    return (await ancV1VerifyDetached(
      "endpoint",
      encodeAncV1UnsignedGenesisAuthorization(authorizationUnsigned),
      authorizationSignature,
      endpointSigningKey,
    ))
      ? "crypto.domain"
      : "crypto.authorization_signature";

  const embeddedEntry = decodeSignedControlLogEntry(
    authorization.signedGenesisCommit,
  );
  const callbackEntry = decodeSignedControlLogEntry(
    ancV1HexToBytes(
      testCase.callbackSignedGenesisCommitHex ??
        ancV1BytesToHex(authorization.signedGenesisCommit),
    ),
  );
  if (
    !equal(
      encodeSignedControlLogEntry(embeddedEntry),
      encodeSignedControlLogEntry(callbackEntry),
    )
  )
    return "binding.commit";
  const { signature: commitSignatureHex, ...commitUnsigned } = embeddedEntry;
  const commitSignature = ancV1HexToBytes(commitSignatureHex);
  if (
    !(await ancV1VerifyDetached(
      "log-entry",
      encodeUnsignedControlLogEntry(commitUnsigned),
      commitSignature,
      endpointSigningKey,
    ))
  )
    return (await ancV1VerifyDetached(
      "endpoint",
      encodeUnsignedControlLogEntry(commitUnsigned),
      commitSignature,
      endpointSigningKey,
    ))
      ? "crypto.domain"
      : "crypto.commit_signature";

  const endpointTime = endpointMap.get(F.common.createdAt) as number;
  const commitTime = Date.parse(embeddedEntry.createdAt) / 1_000;
  if (authorization.createdAt < confirmation.confirmedAt) return "binding.time";
  if (
    confirmation.confirmedAt > endpointTime ||
    endpointTime > commitTime ||
    commitTime > authorization.createdAt
  )
    return "binding.order";
  if (
    embeddedEntry.sequence !== 0 ||
    embeddedEntry.previousHash !== "00".repeat(32)
  )
    return "binding.head";
  if (embeddedEntry.signerEndpointId !== ancV1BytesToHex(endpointId))
    return "binding.endpoint";
  const commit = embeddedEntry.innerEnvelope;
  if (commit.type !== "membership_commit") return "binding.commit";
  if (
    commit.vaultId !== embeddedEntry.vaultId ||
    embeddedEntry.vaultId !== ancV1BytesToHex(expectedVaultId) ||
    commit.epoch !== 1 ||
    commit.rotationCompleted ||
    commit.outstandingJobsResolved
  )
    return "binding.commit";
  if (commit.ceremonyId !== ancV1BytesToHex(authorization.ceremonyId))
    return "binding.ceremony";
  if (commit.ceremonyKind !== "first_device") return "binding.role";
  if (commit.previousMembershipHash !== null) return "binding.head";
  if (commit.removedEndpointIds.length !== 0) return "binding.member";
  if (
    commit.recoveryGeneration !== 1 ||
    commit.recoveryId !== ancV1BytesToHex(confirmation.recoveryId) ||
    commit.recoverySigningPublicKey !==
      ancV1BytesToHex(confirmation.recoverySigningPublicKey) ||
    commit.recoveryKeyAgreementPublicKey !==
      ancV1BytesToHex(confirmation.recoveryKeyAgreementPublicKey) ||
    commit.recoveryWrapHash !== ancV1BytesToHex(confirmation.recoveryWrapHash)
  )
    return "binding.recovery";
  if (commit.activeMembers.length !== 1) return "binding.member";
  const member = commit.activeMembers[0]!;
  if (
    member.endpointId !== ancV1BytesToHex(endpointId) ||
    member.role !== "endpoint" ||
    member.unattended ||
    member.signingPublicKey !== ancV1BytesToHex(endpointSigningKey) ||
    member.keyAgreementPublicKey !==
      ancV1BytesToHex(
        endpointMap.get(F.endpoint.keyAgreementPublicKey) as Uint8Array,
      ) ||
    member.enrollmentRef !== ancV1BytesToHex(authorization.envelopeId)
  )
    return "binding.member";
  return null;
}

async function provenance() {
  return {
    protocolBaseCommit: PROTOCOL_BASE_COMMIT,
    sources: await Promise.all(
      ANC_V1_NATIVE_GENESIS_AUTHORIZATION_SOURCE_PATHS.map(async (path) => ({
        path,
        sha256: createHash("sha256")
          .update(await readFile(`${ROOT}${path}`))
          .digest("hex"),
      })),
    ),
  };
}

async function corpus() {
  return corpusSchema.parse(JSON.parse(await readFile(FIXTURE, "utf8")));
}

describe("anc/v1 native genesis authorization vectors", () => {
  it("is strict, source-anchored, exhaustive, unique, and public-only", async () => {
    const fixture = await corpus();
    expect(fixture).toEqual(
      await buildAncV1NativeGenesisAuthorizationVectors(await provenance()),
    );
    expect(fixture.sourceAnchors.map(({ path }) => path)).toEqual(
      ANC_V1_NATIVE_GENESIS_AUTHORIZATION_SOURCE_PATHS,
    );
    expect(new Set(fixture.negativeCases.map(({ name }) => name)).size).toBe(
      fixture.negativeCases.length,
    );
    expect(new Set(fixture.positiveCases.map(({ name }) => name)).size).toBe(
      fixture.positiveCases.length,
    );
    expect(new Set(fixture.categoryVocabulary)).toEqual(
      new Set(ANC_V1_NATIVE_GENESIS_AUTHORIZATION_CATEGORIES),
    );
    expect(
      new Set(
        fixture.negativeCases.map(({ expectedCategory }) => expectedCategory),
      ),
    ).toEqual(new Set(ANC_V1_NATIVE_GENESIS_AUTHORIZATION_CATEGORIES));
    expect(
      /(seed|private.?key|secret.?key|raw.?secret|epoch.?key|plaintext|ciphertext)/i.test(
        JSON.stringify(fixture),
      ),
    ).toBe(false);
  });

  it("accepts every signed timestamp boundary, fractional ISO, and role boundary", async () => {
    const fixture = await corpus();
    for (const testCase of fixture.positiveCases) {
      const authorizationBytes = ancV1HexToBytes(testCase.authorizationHex);
      const authorizationMap = decodeAncV1Canonical(authorizationBytes) as Map<
        number,
        AncV1CanonicalValue
      >;
      const vaultId = authorizationMap.get(F.common.vaultId) as Uint8Array;
      const authorization = decodeAncV1GenesisAuthorization(
        authorizationBytes,
        { expectedVaultId: vaultId },
      );
      const entry = decodeSignedControlLogEntry(
        authorization.signedGenesisCommit,
      );
      expect(
        await verifyAncV1GenesisAuthorization(
          authorizationBytes,
          ancV1HexToBytes(testCase.recoveryConfirmationHex),
          {
            entry,
            commit: entry.innerEnvelope as typeof entry.innerEnvelope & {
              type: "membership_commit";
            },
          },
        ),
        testCase.name,
      ).toBe(true);
      const confirmation = decodeAncV1GenesisRecoveryConfirmation(
        ancV1HexToBytes(testCase.recoveryConfirmationHex),
        { expectedVaultId: vaultId },
      );
      const endpoint = decodeAncV1Canonical(
        authorization.endpointEnvelope,
      ) as Map<number, AncV1CanonicalValue>;
      expect(
        await bootstrapBindingOracle(
          ancV1HexToBytes(testCase.bootstrapTranscriptHex),
          authorization,
          confirmation,
          endpoint,
        ),
        testCase.name,
      ).toBeNull();
      if (testCase.name === "fractional_commit_iso_accepted")
        expect(entry.createdAt).toMatch(/\.500Z$/);
    }
    expect(fixture.positiveCases.map(({ name }) => name)).toEqual([
      "confirmation_equals_endpoint",
      "endpoint_equals_commit",
      "commit_equals_authorization",
      "all_timestamps_equal",
      "fractional_commit_iso_accepted",
      "endpoint_role_one_character_accepted",
      "endpoint_role_sixty_four_characters_accepted",
    ]);
  });

  it("pins the exact public ceremony, domains, keys, heads, and seconds", async () => {
    const fixture = await corpus();
    const exact = fixture.exact;
    const vaultId = ancV1HexToBytes(exact.parsed.vaultIdHex as string);
    const confirmationBytes = ancV1HexToBytes(exact.recoveryConfirmationHex);
    const confirmation = decodeAncV1GenesisRecoveryConfirmation(
      confirmationBytes,
      { expectedVaultId: vaultId },
    );
    expect(
      ancV1BytesToHex(encodeAncV1GenesisRecoveryConfirmation(confirmation)),
    ).toBe(exact.recoveryConfirmationHex);
    expect(
      ancV1BytesToHex(
        await hashAncV1GenesisRecoveryConfirmation(confirmationBytes, vaultId),
      ),
    ).toBe(exact.recoveryConfirmationDigestHex);

    const bootstrapBytes = ancV1HexToBytes(exact.bootstrapTranscriptHex);
    const bootstrap = decodeAncV1GenesisBootstrapTranscript(bootstrapBytes, {
      expectedVaultId: vaultId,
    });
    expect(
      ancV1BytesToHex(encodeAncV1GenesisBootstrapTranscript(bootstrap)),
    ).toBe(exact.bootstrapTranscriptHex);
    expect(
      ancV1BytesToHex(
        await hashAncV1GenesisBootstrapTranscript(bootstrapBytes, {
          expectedVaultId: vaultId,
        }),
      ),
    ).toBe(exact.bootstrapTranscriptDigestHex);

    const authorizationBytes = ancV1HexToBytes(exact.authorizationHex);
    const authorization = decodeAncV1GenesisAuthorization(authorizationBytes, {
      expectedVaultId: vaultId,
    });
    expect(
      ancV1BytesToHex(encodeAncV1GenesisAuthorization(authorization)),
    ).toBe(exact.authorizationHex);
    expect(ancV1BytesToHex(authorization.endpointEnvelope)).toBe(
      exact.endpointEnvelopeHex,
    );
    expect(ancV1BytesToHex(authorization.signedGenesisCommit)).toBe(
      exact.signedGenesisCommitHex,
    );
    expect(
      ancV1BytesToHex(
        await ancV1Hash("genesis-authorization", authorizationBytes),
      ),
    ).toBe(exact.authorizationDigestHex);
    expect(
      await verifyAncV1GenesisAuthorization(
        authorizationBytes,
        confirmationBytes,
        {
          entry: decodeSignedControlLogEntry(authorization.signedGenesisCommit),
          commit: decodeSignedControlLogEntry(authorization.signedGenesisCommit)
            .innerEnvelope as ReturnType<
            typeof decodeSignedControlLogEntry
          >["innerEnvelope"] & {
            type: "membership_commit";
          },
        },
      ),
    ).toBe(true);
    for (const key of [
      "confirmationTime",
      "endpointTime",
      "commitTime",
      "authorizationTime",
    ])
      expect(exact.parsed[key], key).toSatisfy((value: unknown) =>
        Number.isSafeInteger(value),
      );
  });

  it("classifies every malformed or misbound case with an independent oracle", async () => {
    const fixture = await corpus();
    for (const testCase of fixture.negativeCases) {
      let actual: AncV1NativeGenesisAuthorizationCategory | null;
      if (testCase.stage === "confirmation-decode") {
        actual = structuralOracle(
          ancV1HexToBytes(testCase.recoveryConfirmationHex),
          "confirmation",
          ancV1HexToBytes(testCase.expectedVaultIdHex),
        );
      } else if (testCase.stage === "authorization-decode") {
        actual = structuralOracle(
          ancV1HexToBytes(testCase.authorizationHex),
          "authorization",
          ancV1HexToBytes(testCase.expectedVaultIdHex),
        );
      } else {
        actual = await verifyOracle(testCase);
      }
      expect(actual, testCase.name).toBe(testCase.expectedCategory);

      if (testCase.stage === "confirmation-decode") {
        expect(
          () =>
            decodeAncV1GenesisRecoveryConfirmation(
              ancV1HexToBytes(testCase.recoveryConfirmationHex),
              {
                expectedVaultId: ancV1HexToBytes(testCase.expectedVaultIdHex),
              },
            ),
          testCase.name,
        ).toThrow();
      } else if (testCase.stage === "authorization-decode") {
        expect(
          () =>
            decodeAncV1GenesisAuthorization(
              ancV1HexToBytes(testCase.authorizationHex),
              {
                expectedVaultId: ancV1HexToBytes(testCase.expectedVaultIdHex),
              },
            ),
          testCase.name,
        ).toThrow();
      } else if (testCase.expectedCategory === "binding.bootstrap") {
        const altered = decodeAncV1Canonical(
          ancV1HexToBytes(testCase.bootstrapTranscriptHex),
          { maxBytes: E2EE_SIZE_LIMITS.genesisBootstrapTranscriptBytes },
        );
        const canonical = decodeAncV1Canonical(
          ancV1HexToBytes(fixture.exact.bootstrapTranscriptHex),
          { maxBytes: E2EE_SIZE_LIMITS.genesisBootstrapTranscriptBytes },
        );
        expect(encodeAncV1Canonical(altered)).not.toEqual(
          encodeAncV1Canonical(canonical),
        );
      } else if (
        testCase.expectedCategory.startsWith("wire.endpoint.") ||
        ["limits.endpoint", "limits.confirmation", "limits.commit"].includes(
          testCase.expectedCategory,
        )
      ) {
        const exactAuthorization = decodeAncV1GenesisAuthorization(
          ancV1HexToBytes(fixture.exact.authorizationHex),
          {
            expectedVaultId: ancV1HexToBytes(fixture.exact.parsed.vaultIdHex),
          },
        );
        const callbackEntry = decodeSignedControlLogEntry(
          exactAuthorization.signedGenesisCommit,
        );
        expect(
          await verifyAncV1GenesisAuthorization(
            ancV1HexToBytes(testCase.authorizationHex),
            ancV1HexToBytes(testCase.recoveryConfirmationHex),
            {
              entry: callbackEntry,
              commit:
                callbackEntry.innerEnvelope as typeof callbackEntry.innerEnvelope & {
                  type: "membership_commit";
                },
            },
          ),
          testCase.name,
        ).toBe(false);
      } else {
        const authorization = decodeAncV1GenesisAuthorization(
          ancV1HexToBytes(testCase.authorizationHex),
          { expectedVaultId: ancV1HexToBytes(testCase.expectedVaultIdHex) },
        );
        const callbackEntry = decodeSignedControlLogEntry(
          ancV1HexToBytes(
            testCase.callbackSignedGenesisCommitHex ??
              ancV1BytesToHex(authorization.signedGenesisCommit),
          ),
        );
        expect(
          await verifyAncV1GenesisAuthorization(
            ancV1HexToBytes(testCase.authorizationHex),
            ancV1HexToBytes(testCase.recoveryConfirmationHex),
            {
              entry: callbackEntry,
              commit:
                callbackEntry.innerEnvelope as typeof callbackEntry.innerEnvelope & {
                  type: "membership_commit";
                },
            },
          ),
          testCase.name,
        ).toBe(false);
      }
    }
  });

  it("binds bootstrap custody to the exact endpoint keys and authorization ref", async () => {
    const fixture = await corpus();
    const exact = fixture.exact;
    const canonical = decodeAncV1GenesisBootstrapTranscript(
      ancV1HexToBytes(exact.bootstrapTranscriptHex),
    );
    const rebuilt = await createAncV1GenesisBootstrapTranscript({
      vaultId: canonical.vaultId,
      ceremonyId: canonical.ceremonyId,
      endpointId: canonical.endpointId,
      endpointSigningPublicKey: canonical.endpointSigningPublicKey,
      endpointKeyAgreementPublicKey: canonical.endpointKeyAgreementPublicKey,
      enrollmentRef: canonical.enrollmentRef,
      recoveryConfirmation: ancV1HexToBytes(exact.recoveryConfirmationHex),
    });
    expect(encodeAncV1GenesisBootstrapTranscript(rebuilt)).toEqual(
      ancV1HexToBytes(exact.bootstrapTranscriptHex),
    );
    const bootstrapCases = fixture.negativeCases
      .filter(
        ({ expectedCategory }) => expectedCategory === "binding.bootstrap",
      )
      .map(({ name }) => name);
    expect(bootstrapCases).toEqual([
      "bootstrap_vault_substitution",
      "bootstrap_ceremony_substitution",
      "bootstrap_endpoint_substitution",
      "bootstrap_endpoint_signing_key_substitution",
      "bootstrap_endpoint_agreement_key_substitution",
      "bootstrap_enrollment_ref_substitution",
      "bootstrap_recovery_id_substitution",
      "bootstrap_recovery_signing_key_substitution",
      "bootstrap_recovery_agreement_key_substitution",
      "bootstrap_recovery_generation_substitution",
      "bootstrap_epoch_substitution",
      "bootstrap_recovery_wrap_hash_substitution",
      "bootstrap_recovery_confirmation_hash_substitution",
    ]);
  });

  it("keeps the native-only generator out of the published Core build", async () => {
    const tsconfig = await readFile(
      `${ROOT}packages/core/tsconfig.json`,
      "utf8",
    );
    const index = await readFile(
      `${ROOT}packages/core/src/e2ee/index.ts`,
      "utf8",
    );
    expect(tsconfig).toContain(
      '"src/e2ee/native-genesis-authorization-vectors.ts"',
    );
    expect(index).not.toContain("native-genesis-authorization-vectors");
  });
});
