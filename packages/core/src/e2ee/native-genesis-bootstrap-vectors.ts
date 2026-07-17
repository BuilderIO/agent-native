import {
  type AncV1CanonicalValue,
  ancV1BytesToHex,
  decodeAncV1Canonical,
  encodeAncV1Canonical,
} from "./canonical.js";
import {
  createAncV1GenesisBootstrapTranscript,
  encodeAncV1GenesisBootstrapTranscript,
  hashAncV1GenesisBootstrapTranscript,
} from "./genesis-bootstrap-transcript.js";
import { encodeAncV1GenesisRecoveryConfirmation } from "./genesis-ceremony-codecs.js";
import { ancV1Hash } from "./portable-crypto.js";
import {
  E2EE_ENVELOPE_FIELDS,
  E2EE_SUITE_ID,
  e2eeDomainSeparationPrefix,
} from "./suite.js";

export const ANC_V1_NATIVE_GENESIS_BOOTSTRAP_CORPUS_SCHEMA =
  "anc/v1-native-genesis-bootstrap-vectors@1" as const;
export const ANC_V1_NATIVE_GENESIS_BOOTSTRAP_GENERATOR =
  "buildAncV1NativeGenesisBootstrapVectors" as const;
export const ANC_V1_NATIVE_GENESIS_BOOTSTRAP_SOURCE_PATHS = [
  "packages/core/src/e2ee/native-genesis-bootstrap-vectors.ts",
  "packages/core/src/e2ee/genesis-bootstrap-transcript.ts",
  "packages/core/src/e2ee/genesis-ceremony-codecs.ts",
  "packages/core/src/e2ee/canonical.ts",
  "packages/core/src/e2ee/portable-crypto.ts",
  "packages/core/src/e2ee/suite.ts",
] as const;

export const ANC_V1_NATIVE_GENESIS_BOOTSTRAP_CATEGORIES = [
  "wire.invalid_canonical",
  "wire.missing_field",
  "wire.unknown_field",
  "wire.wrong_type",
  "wire.wrong_literal",
  "wire.length",
  "wire.range",
  "limits.transcript",
  "binding.vault",
  "binding.confirmation_vault",
  "binding.confirmation_ceremony",
  "binding.confirmation_endpoint",
  "binding.confirmation",
  "binding.confirmation_hash",
  "crypto.domain",
] as const;

export type AncV1NativeGenesisBootstrapCategory =
  (typeof ANC_V1_NATIVE_GENESIS_BOOTSTRAP_CATEGORIES)[number];
export type AncV1NativeGenesisBootstrapStage =
  | "decode"
  | "binding"
  | "confirmation"
  | "hash";

export interface AncV1NativeGenesisBootstrapProvenance {
  protocolBaseCommit: string;
  sources: readonly {
    path: (typeof ANC_V1_NATIVE_GENESIS_BOOTSTRAP_SOURCE_PATHS)[number];
    sha256: string;
  }[];
}

export interface AncV1NativeGenesisBootstrapCase {
  name: string;
  stage: AncV1NativeGenesisBootstrapStage;
  encodedHex: string;
  confirmationHex: string | null;
  expectedVaultIdHex: string | null;
  expectedDigestHex: string | null;
  expectedCategory: AncV1NativeGenesisBootstrapCategory;
}

export interface AncV1NativeGenesisBootstrapCorpus {
  schema: typeof ANC_V1_NATIVE_GENESIS_BOOTSTRAP_CORPUS_SCHEMA;
  suite: typeof E2EE_SUITE_ID;
  encoding: "hex";
  generator: typeof ANC_V1_NATIVE_GENESIS_BOOTSTRAP_GENERATOR;
  protocolBaseCommit: string;
  sourceAnchors: AncV1NativeGenesisBootstrapProvenance["sources"];
  domain: { escaped: string; utf8Hex: string };
  fieldKeys: Readonly<Record<string, number>>;
  categoryVocabulary: readonly AncV1NativeGenesisBootstrapCategory[];
  exact: {
    recoveryConfirmationHex: string;
    transcriptHex: string;
    digestHex: string;
    parsed: Readonly<Record<string, string | number>>;
  };
  negativeCases: readonly AncV1NativeGenesisBootstrapCase[];
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

function provenanceValid(value: AncV1NativeGenesisBootstrapProvenance) {
  return (
    /^[0-9a-f]{40}$/.test(value.protocolBaseCommit) &&
    value.sources.length ===
      ANC_V1_NATIVE_GENESIS_BOOTSTRAP_SOURCE_PATHS.length &&
    ANC_V1_NATIVE_GENESIS_BOOTSTRAP_SOURCE_PATHS.every(
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

export async function buildAncV1NativeGenesisBootstrapVectors(
  provenance: AncV1NativeGenesisBootstrapProvenance,
): Promise<AncV1NativeGenesisBootstrapCorpus> {
  if (!provenanceValid(provenance))
    throw new Error("Invalid fixture provenance");
  const vaultId = p(0x11, 16);
  const ceremonyId = p(0x22, 16);
  const endpointId = p(0x33, 16);
  const endpointSigningPublicKey = p(0x44, 32);
  const endpointKeyAgreementPublicKey = p(0x55, 32);
  const enrollmentRef = p(0x66, 16);
  const recoveryId = p(0x77, 16);
  const recoverySigningPublicKey = p(0x88, 32);
  const recoveryKeyAgreementPublicKey = p(0x99, 32);
  const recoveryWrapHash = p(0xaa, 32);
  const recoveryConfirmation = encodeAncV1GenesisRecoveryConfirmation({
    suite: E2EE_SUITE_ID,
    vaultId,
    type: "genesis-recovery-confirmation",
    ceremonyId,
    endpointId,
    recoveryId,
    recoverySigningPublicKey,
    recoveryKeyAgreementPublicKey,
    recoveryWrapHash,
    confirmedAt: 1_721_111_110_000,
    recoveryGeneration: 1,
  });
  const transcript = await createAncV1GenesisBootstrapTranscript({
    vaultId,
    ceremonyId,
    endpointId,
    endpointSigningPublicKey,
    endpointKeyAgreementPublicKey,
    enrollmentRef,
    recoveryConfirmation,
  });
  const encoded = encodeAncV1GenesisBootstrapTranscript(transcript);
  const digest = await hashAncV1GenesisBootstrapTranscript(encoded, {
    expectedVaultId: vaultId,
  });
  const cases: AncV1NativeGenesisBootstrapCase[] = [];
  const add = (
    name: string,
    stage: AncV1NativeGenesisBootstrapStage,
    bytes: Uint8Array,
    expectedCategory: AncV1NativeGenesisBootstrapCategory,
    options: Partial<
      Pick<
        AncV1NativeGenesisBootstrapCase,
        "confirmationHex" | "expectedVaultIdHex" | "expectedDigestHex"
      >
    > = {},
  ) =>
    cases.push({
      name,
      stage,
      encodedHex: ancV1BytesToHex(bytes),
      confirmationHex: options.confirmationHex ?? null,
      expectedVaultIdHex: options.expectedVaultIdHex ?? null,
      expectedDigestHex: options.expectedDigestHex ?? null,
      expectedCategory,
    });

  const fields = [
    ["suite", F.common.suite, E2EE_SUITE_ID, null],
    ["vault_id", F.common.vaultId, vaultId, 16],
    ["type", F.common.type, "genesis-bootstrap-transcript", null],
    ["ceremony_id", F.genesisBootstrapTranscript.ceremonyId, ceremonyId, 16],
    ["endpoint_id", F.genesisBootstrapTranscript.endpointId, endpointId, 16],
    [
      "endpoint_signing_public_key",
      F.genesisBootstrapTranscript.endpointSigningPublicKey,
      endpointSigningPublicKey,
      32,
    ],
    [
      "endpoint_key_agreement_public_key",
      F.genesisBootstrapTranscript.endpointKeyAgreementPublicKey,
      endpointKeyAgreementPublicKey,
      32,
    ],
    [
      "enrollment_ref",
      F.genesisBootstrapTranscript.enrollmentRef,
      enrollmentRef,
      16,
    ],
    ["recovery_id", F.genesisBootstrapTranscript.recoveryId, recoveryId, 16],
    [
      "recovery_signing_public_key",
      F.genesisBootstrapTranscript.recoverySigningPublicKey,
      recoverySigningPublicKey,
      32,
    ],
    [
      "recovery_key_agreement_public_key",
      F.genesisBootstrapTranscript.recoveryKeyAgreementPublicKey,
      recoveryKeyAgreementPublicKey,
      32,
    ],
    [
      "recovery_generation",
      F.genesisBootstrapTranscript.recoveryGeneration,
      1,
      null,
    ],
    ["epoch", F.genesisBootstrapTranscript.epoch, 1, null],
    [
      "recovery_wrap_hash",
      F.genesisBootstrapTranscript.recoveryWrapHash,
      recoveryWrapHash,
      32,
    ],
    [
      "recovery_confirmation_hash",
      F.genesisBootstrapTranscript.recoveryConfirmationHash,
      transcript.recoveryConfirmationHash,
      32,
    ],
  ] as const;
  for (const [name, key, value, length] of fields) {
    add(
      `missing_${name}`,
      "decode",
      mutate(encoded, (map) => map.delete(key)),
      "wire.missing_field",
    );
    add(
      `wrong_type_${name}`,
      "decode",
      mutate(encoded, (map) =>
        map.set(key, typeof value === "number" ? "1" : 7),
      ),
      "wire.wrong_type",
    );
    if (length !== null) {
      add(
        `short_${name}`,
        "decode",
        mutate(encoded, (map) => map.set(key, p(0xee, length - 1))),
        "wire.length",
      );
      add(
        `long_${name}`,
        "decode",
        mutate(encoded, (map) => map.set(key, p(0xee, length + 1))),
        "wire.length",
      );
    }
  }
  add(
    "wrong_suite_literal",
    "decode",
    mutate(encoded, (map) => map.set(F.common.suite, "anc/v2")),
    "wire.wrong_literal",
  );
  add(
    "wrong_transcript_type_literal",
    "decode",
    mutate(encoded, (map) => map.set(F.common.type, "genesis-authorization")),
    "wire.wrong_literal",
  );
  add(
    "wrong_recovery_generation",
    "decode",
    mutate(encoded, (map) =>
      map.set(F.genesisBootstrapTranscript.recoveryGeneration, 2),
    ),
    "wire.range",
  );
  add(
    "wrong_epoch",
    "decode",
    mutate(encoded, (map) => map.set(F.genesisBootstrapTranscript.epoch, 2)),
    "wire.range",
  );
  add(
    "unknown_field",
    "decode",
    mutate(encoded, (map) => map.set(399, 1)),
    "wire.unknown_field",
  );

  const pairs = mapPairs(encoded);
  add(
    "noncanonical_reversed_map_order",
    "decode",
    concat(Uint8Array.of(0xaf), ...pairs.toReversed()),
    "wire.invalid_canonical",
  );
  add(
    "noncanonical_duplicate_key",
    "decode",
    concat(Uint8Array.of(0xb0), ...pairs, pairs[0]!),
    "wire.invalid_canonical",
  );
  add(
    "noncanonical_indefinite_map",
    "decode",
    concat(Uint8Array.of(0xbf), ...pairs, Uint8Array.of(0xff)),
    "wire.invalid_canonical",
  );
  add(
    "noncanonical_nonshortest_map_length",
    "decode",
    concat(Uint8Array.of(0xb8, 0x0f), ...pairs),
    "wire.invalid_canonical",
  );
  add("transcript_over_4k_limit", "decode", p(0, 4097), "limits.transcript");
  add("vault_binding_mismatch", "binding", encoded, "binding.vault", {
    expectedVaultIdHex: ancV1BytesToHex(p(0xfe, 16)),
  });

  const confirmationMutation = (key: number, value: AncV1CanonicalValue) =>
    ancV1BytesToHex(mutate(recoveryConfirmation, (map) => map.set(key, value)));
  add(
    "confirmation_vault_mismatch",
    "confirmation",
    encoded,
    "binding.confirmation_vault",
    { confirmationHex: confirmationMutation(F.common.vaultId, p(0xfe, 16)) },
  );
  add(
    "confirmation_ceremony_mismatch",
    "confirmation",
    encoded,
    "binding.confirmation_ceremony",
    {
      confirmationHex: confirmationMutation(
        F.genesisRecoveryConfirmation.ceremonyId,
        p(0xfd, 16),
      ),
    },
  );
  add(
    "confirmation_endpoint_mismatch",
    "confirmation",
    encoded,
    "binding.confirmation_endpoint",
    {
      confirmationHex: confirmationMutation(
        F.genesisRecoveryConfirmation.endpointId,
        p(0xfc, 16),
      ),
    },
  );
  for (const [name, key] of [
    ["recovery_id", F.genesisBootstrapTranscript.recoveryId],
    [
      "recovery_signing_public_key",
      F.genesisBootstrapTranscript.recoverySigningPublicKey,
    ],
    [
      "recovery_key_agreement_public_key",
      F.genesisBootstrapTranscript.recoveryKeyAgreementPublicKey,
    ],
    ["recovery_wrap_hash", F.genesisBootstrapTranscript.recoveryWrapHash],
  ] as const)
    add(
      `confirmation_binding_${name}_substitution`,
      "confirmation",
      mutate(encoded, (map) =>
        map.set(key, p(0xfb, name === "recovery_id" ? 16 : 32)),
      ),
      "binding.confirmation",
      { confirmationHex: ancV1BytesToHex(recoveryConfirmation) },
    );
  add(
    "confirmation_hash_substitution",
    "confirmation",
    mutate(encoded, (map) =>
      map.set(
        F.genesisBootstrapTranscript.recoveryConfirmationHash,
        p(0xfa, 32),
      ),
    ),
    "binding.confirmation_hash",
    { confirmationHex: ancV1BytesToHex(recoveryConfirmation) },
  );
  add("transcript_hash_domain_substitution", "hash", encoded, "crypto.domain", {
    expectedDigestHex: ancV1BytesToHex(
      await ancV1Hash("genesis-authorization", encoded),
    ),
  });

  const prefix = e2eeDomainSeparationPrefix("genesis-bootstrap-transcript");
  return {
    schema: ANC_V1_NATIVE_GENESIS_BOOTSTRAP_CORPUS_SCHEMA,
    suite: E2EE_SUITE_ID,
    encoding: "hex",
    generator: ANC_V1_NATIVE_GENESIS_BOOTSTRAP_GENERATOR,
    protocolBaseCommit: provenance.protocolBaseCommit,
    sourceAnchors: provenance.sources,
    domain: {
      escaped: "anc/v1/genesis-bootstrap-transcript\\0",
      utf8Hex: ancV1BytesToHex(prefix),
    },
    fieldKeys: {
      suite: F.common.suite,
      vaultId: F.common.vaultId,
      type: F.common.type,
      ...F.genesisBootstrapTranscript,
    },
    categoryVocabulary: ANC_V1_NATIVE_GENESIS_BOOTSTRAP_CATEGORIES,
    exact: {
      recoveryConfirmationHex: ancV1BytesToHex(recoveryConfirmation),
      transcriptHex: ancV1BytesToHex(encoded),
      digestHex: ancV1BytesToHex(digest),
      parsed: {
        vaultIdHex: ancV1BytesToHex(vaultId),
        ceremonyIdHex: ancV1BytesToHex(ceremonyId),
        endpointIdHex: ancV1BytesToHex(endpointId),
        endpointSigningPublicKeyHex: ancV1BytesToHex(endpointSigningPublicKey),
        endpointKeyAgreementPublicKeyHex: ancV1BytesToHex(
          endpointKeyAgreementPublicKey,
        ),
        enrollmentRefHex: ancV1BytesToHex(enrollmentRef),
        recoveryIdHex: ancV1BytesToHex(recoveryId),
        recoverySigningPublicKeyHex: ancV1BytesToHex(recoverySigningPublicKey),
        recoveryKeyAgreementPublicKeyHex: ancV1BytesToHex(
          recoveryKeyAgreementPublicKey,
        ),
        recoveryGeneration: 1,
        epoch: 1,
        recoveryWrapHashHex: ancV1BytesToHex(recoveryWrapHash),
        recoveryConfirmationHashHex: ancV1BytesToHex(
          transcript.recoveryConfirmationHash,
        ),
      },
    },
    negativeCases: cases,
  };
}
