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
  createAncV1GenesisBootstrapTranscript,
  decodeAncV1GenesisBootstrapTranscript,
  encodeAncV1GenesisBootstrapTranscript,
  hashAncV1GenesisBootstrapTranscript,
} from "./genesis-bootstrap-transcript.js";
import { hashAncV1GenesisRecoveryConfirmation } from "./genesis-ceremony-codecs.js";
import {
  ANC_V1_NATIVE_GENESIS_BOOTSTRAP_CATEGORIES,
  ANC_V1_NATIVE_GENESIS_BOOTSTRAP_CORPUS_SCHEMA,
  ANC_V1_NATIVE_GENESIS_BOOTSTRAP_GENERATOR,
  ANC_V1_NATIVE_GENESIS_BOOTSTRAP_SOURCE_PATHS,
  type AncV1NativeGenesisBootstrapCase,
  type AncV1NativeGenesisBootstrapCategory,
  buildAncV1NativeGenesisBootstrapVectors,
} from "./native-genesis-bootstrap-vectors.js";
import { E2EE_ENVELOPE_FIELDS } from "./suite.js";

const PROTOCOL_BASE_COMMIT = "fd8c9800abbda048b21796a0953f449d1cc100ce";
const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const FIXTURE = new URL(
  "./fixtures/anc-v1-native-genesis-bootstrap-vectors.json",
  import.meta.url,
);
const hex = z.string().regex(/^(?:[0-9a-f]{2})+$/);
const hex16 = z.string().regex(/^[0-9a-f]{32}$/);
const hex32 = z.string().regex(/^[0-9a-f]{64}$/);
const category = z.enum(ANC_V1_NATIVE_GENESIS_BOOTSTRAP_CATEGORIES);
const source = <
  T extends (typeof ANC_V1_NATIVE_GENESIS_BOOTSTRAP_SOURCE_PATHS)[number],
>(
  path: T,
) => z.object({ path: z.literal(path), sha256: hex32 }).strict();
const caseSchema = z
  .object({
    name: z.string().min(1),
    stage: z.enum(["decode", "binding", "confirmation", "hash"]),
    encodedHex: hex,
    confirmationHex: hex.nullable(),
    expectedVaultIdHex: hex16.nullable(),
    expectedDigestHex: hex32.nullable(),
    expectedCategory: category,
  })
  .strict();
const fieldKeysSchema = z
  .object({
    suite: z.literal(1),
    vaultId: z.literal(2),
    type: z.literal(3),
    ceremonyId: z.literal(380),
    endpointId: z.literal(381),
    endpointSigningPublicKey: z.literal(382),
    endpointKeyAgreementPublicKey: z.literal(383),
    enrollmentRef: z.literal(384),
    recoveryId: z.literal(385),
    recoverySigningPublicKey: z.literal(386),
    recoveryKeyAgreementPublicKey: z.literal(387),
    recoveryGeneration: z.literal(388),
    epoch: z.literal(389),
    recoveryWrapHash: z.literal(390),
    recoveryConfirmationHash: z.literal(391),
  })
  .strict();
const corpusSchema = z
  .object({
    schema: z.literal(ANC_V1_NATIVE_GENESIS_BOOTSTRAP_CORPUS_SCHEMA),
    suite: z.literal("anc/v1"),
    encoding: z.literal("hex"),
    generator: z.literal(ANC_V1_NATIVE_GENESIS_BOOTSTRAP_GENERATOR),
    protocolBaseCommit: z.literal(PROTOCOL_BASE_COMMIT),
    sourceAnchors: z.tuple(
      ANC_V1_NATIVE_GENESIS_BOOTSTRAP_SOURCE_PATHS.map(source) as [
        ReturnType<typeof source>,
        ReturnType<typeof source>,
        ReturnType<typeof source>,
        ReturnType<typeof source>,
        ReturnType<typeof source>,
        ReturnType<typeof source>,
      ],
    ),
    domain: z
      .object({
        escaped: z.literal("anc/v1/genesis-bootstrap-transcript\\0"),
        utf8Hex: z.literal(
          "616e632f76312f67656e657369732d626f6f7473747261702d7472616e73637269707400",
        ),
      })
      .strict(),
    fieldKeys: fieldKeysSchema,
    categoryVocabulary: z.tuple(
      ANC_V1_NATIVE_GENESIS_BOOTSTRAP_CATEGORIES.map((value) =>
        z.literal(value),
      ) as [
        z.ZodLiteral<AncV1NativeGenesisBootstrapCategory>,
        ...z.ZodLiteral<AncV1NativeGenesisBootstrapCategory>[],
      ],
    ),
    exact: z
      .object({
        recoveryConfirmationHex: hex,
        transcriptHex: hex,
        digestHex: hex32,
        parsed: z
          .object({
            vaultIdHex: hex16,
            ceremonyIdHex: hex16,
            endpointIdHex: hex16,
            endpointSigningPublicKeyHex: hex32,
            endpointKeyAgreementPublicKeyHex: hex32,
            enrollmentRefHex: hex16,
            recoveryIdHex: hex16,
            recoverySigningPublicKeyHex: hex32,
            recoveryKeyAgreementPublicKeyHex: hex32,
            recoveryGeneration: z.literal(1),
            epoch: z.literal(1),
            recoveryWrapHashHex: hex32,
            recoveryConfirmationHashHex: hex32,
          })
          .strict(),
      })
      .strict(),
    negativeCases: z.array(caseSchema).min(50),
  })
  .strict();

const F = E2EE_ENVELOPE_FIELDS;
const transcriptKeys = [
  F.common.suite,
  F.common.vaultId,
  F.common.type,
  ...Object.values(F.genesisBootstrapTranscript),
];
const byteFields = new Map<number, number>([
  [F.common.vaultId, 16],
  [F.genesisBootstrapTranscript.ceremonyId, 16],
  [F.genesisBootstrapTranscript.endpointId, 16],
  [F.genesisBootstrapTranscript.endpointSigningPublicKey, 32],
  [F.genesisBootstrapTranscript.endpointKeyAgreementPublicKey, 32],
  [F.genesisBootstrapTranscript.enrollmentRef, 16],
  [F.genesisBootstrapTranscript.recoveryId, 16],
  [F.genesisBootstrapTranscript.recoverySigningPublicKey, 32],
  [F.genesisBootstrapTranscript.recoveryKeyAgreementPublicKey, 32],
  [F.genesisBootstrapTranscript.recoveryWrapHash, 32],
  [F.genesisBootstrapTranscript.recoveryConfirmationHash, 32],
]);
const equal = (left: Uint8Array, right: Uint8Array) =>
  left.length === right.length &&
  left.every((value, index) => value === right[index]);

function decodeOracle(
  bytes: Uint8Array,
  expectedVaultId?: Uint8Array,
): AncV1NativeGenesisBootstrapCategory | null {
  if (bytes.length > 4096) return "limits.transcript";
  let value: AncV1CanonicalValue;
  try {
    value = decodeAncV1Canonical(bytes, { maxBytes: 4096 });
  } catch {
    return "wire.invalid_canonical";
  }
  if (!(value instanceof Map)) return "wire.wrong_type";
  if ([...value.keys()].some((key) => !transcriptKeys.includes(key)))
    return "wire.unknown_field";
  if (
    value.size !== transcriptKeys.length ||
    transcriptKeys.some((key) => !value.has(key))
  )
    return "wire.missing_field";
  if (
    typeof value.get(F.common.suite) !== "string" ||
    typeof value.get(F.common.type) !== "string"
  )
    return "wire.wrong_type";
  for (const [key, length] of byteFields) {
    const field = value.get(key);
    if (!(field instanceof Uint8Array)) return "wire.wrong_type";
    if (field.length !== length) return "wire.length";
  }
  for (const key of [
    F.genesisBootstrapTranscript.recoveryGeneration,
    F.genesisBootstrapTranscript.epoch,
  ])
    if (typeof value.get(key) !== "number") return "wire.wrong_type";
  if (
    value.get(F.common.suite) !== "anc/v1" ||
    value.get(F.common.type) !== "genesis-bootstrap-transcript"
  )
    return "wire.wrong_literal";
  if (
    value.get(F.genesisBootstrapTranscript.recoveryGeneration) !== 1 ||
    value.get(F.genesisBootstrapTranscript.epoch) !== 1
  )
    return "wire.range";
  if (
    expectedVaultId &&
    !equal(value.get(F.common.vaultId) as Uint8Array, expectedVaultId)
  )
    return "binding.vault";
  return null;
}

async function confirmationOracle(testCase: AncV1NativeGenesisBootstrapCase) {
  const encoded = ancV1HexToBytes(testCase.encodedHex);
  const transcript = decodeAncV1GenesisBootstrapTranscript(encoded);
  const confirmationBytes = ancV1HexToBytes(testCase.confirmationHex!);
  const raw = decodeAncV1Canonical(confirmationBytes) as Map<
    number,
    AncV1CanonicalValue
  >;
  const confirmationVault = raw.get(F.common.vaultId) as Uint8Array;
  if (!equal(confirmationVault, transcript.vaultId))
    return "binding.confirmation_vault" as const;
  if (
    !equal(
      raw.get(F.genesisRecoveryConfirmation.ceremonyId) as Uint8Array,
      transcript.ceremonyId,
    )
  )
    return "binding.confirmation_ceremony" as const;
  if (
    !equal(
      raw.get(F.genesisRecoveryConfirmation.endpointId) as Uint8Array,
      transcript.endpointId,
    )
  )
    return "binding.confirmation_endpoint" as const;
  const expected = await createAncV1GenesisBootstrapTranscript({
    vaultId: transcript.vaultId,
    ceremonyId: transcript.ceremonyId,
    endpointId: transcript.endpointId,
    endpointSigningPublicKey: transcript.endpointSigningPublicKey,
    endpointKeyAgreementPublicKey: transcript.endpointKeyAgreementPublicKey,
    enrollmentRef: transcript.enrollmentRef,
    recoveryConfirmation: confirmationBytes,
  });
  for (const key of [
    "recoveryId",
    "recoverySigningPublicKey",
    "recoveryKeyAgreementPublicKey",
    "recoveryWrapHash",
  ] as const)
    if (!equal(transcript[key], expected[key]))
      return "binding.confirmation" as const;
  if (
    !equal(
      transcript.recoveryConfirmationHash,
      expected.recoveryConfirmationHash,
    )
  )
    return "binding.confirmation_hash" as const;
  return null;
}

async function provenance() {
  return {
    protocolBaseCommit: PROTOCOL_BASE_COMMIT,
    sources: await Promise.all(
      ANC_V1_NATIVE_GENESIS_BOOTSTRAP_SOURCE_PATHS.map(async (path) => ({
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

describe("anc/v1 native genesis bootstrap transcript vectors", () => {
  it("is strict, ordered, source-anchored, unique, and public-only", async () => {
    const fixture = await corpus();
    expect(fixture).toEqual(
      await buildAncV1NativeGenesisBootstrapVectors(await provenance()),
    );
    expect(fixture.sourceAnchors.map(({ path }) => path)).toEqual(
      ANC_V1_NATIVE_GENESIS_BOOTSTRAP_SOURCE_PATHS,
    );
    expect(new Set(fixture.negativeCases.map(({ name }) => name)).size).toBe(
      fixture.negativeCases.length,
    );
    expect(new Set(fixture.categoryVocabulary)).toEqual(
      new Set(ANC_V1_NATIVE_GENESIS_BOOTSTRAP_CATEGORIES),
    );
    expect(new Set(fixture.categoryVocabulary).size).toBe(
      fixture.categoryVocabulary.length,
    );
    expect(
      new Set(
        fixture.negativeCases.map(({ expectedCategory }) => expectedCategory),
      ),
    ).toEqual(new Set(ANC_V1_NATIVE_GENESIS_BOOTSTRAP_CATEGORIES));
    expect(
      /(seed|private.?key|epoch.?key|ciphertext|plaintext)/i.test(
        JSON.stringify(fixture),
      ),
    ).toBe(false);
  });

  it("pins the exact transcript, confirmation, and correct domains", async () => {
    const fixture = await corpus();
    const encoded = ancV1HexToBytes(fixture.exact.transcriptHex);
    const vaultId = ancV1HexToBytes(fixture.exact.parsed.vaultIdHex);
    expect(decodeOracle(encoded, vaultId)).toBeNull();
    const decoded = decodeAncV1GenesisBootstrapTranscript(encoded, {
      expectedVaultId: vaultId,
    });
    expect(
      ancV1BytesToHex(encodeAncV1GenesisBootstrapTranscript(decoded)),
    ).toBe(fixture.exact.transcriptHex);
    expect(
      ancV1BytesToHex(
        await hashAncV1GenesisBootstrapTranscript(encoded, {
          expectedVaultId: vaultId,
        }),
      ),
    ).toBe(fixture.exact.digestHex);
    expect(
      ancV1BytesToHex(
        await hashAncV1GenesisRecoveryConfirmation(
          ancV1HexToBytes(fixture.exact.recoveryConfirmationHex),
          vaultId,
        ),
      ),
    ).toBe(fixture.exact.parsed.recoveryConfirmationHashHex);
  });

  it("classifies every negative independently and proves Core fails closed", async () => {
    const fixture = await corpus();
    for (const testCase of fixture.negativeCases) {
      const encoded = ancV1HexToBytes(testCase.encodedHex);
      if (testCase.stage === "decode" || testCase.stage === "binding") {
        const expectedVault = testCase.expectedVaultIdHex
          ? ancV1HexToBytes(testCase.expectedVaultIdHex)
          : undefined;
        expect(decodeOracle(encoded, expectedVault), testCase.name).toBe(
          testCase.expectedCategory,
        );
        expect(
          () =>
            decodeAncV1GenesisBootstrapTranscript(
              encoded,
              expectedVault ? { expectedVaultId: expectedVault } : undefined,
            ),
          testCase.name,
        ).toThrow();
      } else if (testCase.stage === "confirmation") {
        expect(await confirmationOracle(testCase), testCase.name).toBe(
          testCase.expectedCategory,
        );
      } else {
        const actual = ancV1BytesToHex(
          await hashAncV1GenesisBootstrapTranscript(encoded),
        );
        expect(actual, testCase.name).not.toBe(testCase.expectedDigestHex);
        expect(testCase.expectedCategory).toBe("crypto.domain");
      }
    }
  });

  it("snapshots hostile getters and mutable shared aliases exactly once", async () => {
    const fixture = await corpus();
    const encoded = ancV1HexToBytes(fixture.exact.transcriptHex);
    const confirmationA = ancV1HexToBytes(
      fixture.exact.recoveryConfirmationHex,
    );
    const confirmationMap = decodeAncV1Canonical(confirmationA);
    expect(confirmationMap).toBeInstanceOf(Map);
    const confirmationBMap = new Map(
      confirmationMap as Map<number, AncV1CanonicalValue>,
    );
    confirmationBMap.set(
      F.genesisRecoveryConfirmation.recoveryId,
      new Uint8Array(16).fill(0xbc),
    );
    confirmationBMap.set(
      F.genesisRecoveryConfirmation.recoveryWrapHash,
      new Uint8Array(32).fill(0xbd),
    );
    const confirmationB = encodeAncV1Canonical(confirmationBMap);
    const parsed = fixture.exact.parsed;
    let confirmationReads = 0;
    const alternatingInput = {
      vaultId: ancV1HexToBytes(parsed.vaultIdHex),
      ceremonyId: ancV1HexToBytes(parsed.ceremonyIdHex),
      endpointId: ancV1HexToBytes(parsed.endpointIdHex),
      endpointSigningPublicKey: ancV1HexToBytes(
        parsed.endpointSigningPublicKeyHex,
      ),
      endpointKeyAgreementPublicKey: ancV1HexToBytes(
        parsed.endpointKeyAgreementPublicKeyHex,
      ),
      enrollmentRef: ancV1HexToBytes(parsed.enrollmentRefHex),
      get recoveryConfirmation() {
        confirmationReads += 1;
        return confirmationReads === 1 ? confirmationA : confirmationB;
      },
    };
    const fromAlternatingConfirmation =
      await createAncV1GenesisBootstrapTranscript(alternatingInput);
    expect(confirmationReads).toBe(1);
    expect(ancV1BytesToHex(fromAlternatingConfirmation.recoveryId)).toBe(
      parsed.recoveryIdHex,
    );
    expect(
      ancV1BytesToHex(fromAlternatingConfirmation.recoveryConfirmationHash),
    ).toBe(parsed.recoveryConfirmationHashHex);

    const decoded = decodeAncV1GenesisBootstrapTranscript(encoded);
    const reads = new Map<PropertyKey, number>();
    const hostileTranscript = new Proxy(decoded, {
      get(target, property, receiver) {
        const count = (reads.get(property) ?? 0) + 1;
        reads.set(property, count);
        const first = Reflect.get(target, property, receiver) as unknown;
        if (count === 1) return first;
        return first instanceof Uint8Array
          ? new Uint8Array(first.length).fill(0xee)
          : property === "recoveryGeneration" || property === "epoch"
            ? 2
            : "hostile-second-read";
      },
    });
    expect(
      ancV1BytesToHex(encodeAncV1GenesisBootstrapTranscript(hostileTranscript)),
    ).toBe(fixture.exact.transcriptHex);
    for (const fieldName of Object.keys(decoded))
      expect(reads.get(fieldName), fieldName).toBe(1);

    const shared = (bytes: Uint8Array) => {
      const value = new Uint8Array(new SharedArrayBuffer(bytes.length));
      value.set(bytes);
      return value;
    };
    const sharedInput = {
      vaultId: shared(ancV1HexToBytes(parsed.vaultIdHex)),
      ceremonyId: shared(ancV1HexToBytes(parsed.ceremonyIdHex)),
      endpointId: shared(ancV1HexToBytes(parsed.endpointIdHex)),
      endpointSigningPublicKey: shared(
        ancV1HexToBytes(parsed.endpointSigningPublicKeyHex),
      ),
      endpointKeyAgreementPublicKey: shared(
        ancV1HexToBytes(parsed.endpointKeyAgreementPublicKeyHex),
      ),
      enrollmentRef: shared(ancV1HexToBytes(parsed.enrollmentRefHex)),
      recoveryConfirmation: shared(confirmationA),
    };
    const createPromise = createAncV1GenesisBootstrapTranscript(sharedInput);
    for (const value of Object.values(sharedInput)) value.fill(0xff);
    expect(
      ancV1BytesToHex(
        encodeAncV1GenesisBootstrapTranscript(await createPromise),
      ),
    ).toBe(fixture.exact.transcriptHex);

    const sharedEncoded = shared(encoded);
    const hashPromise = hashAncV1GenesisBootstrapTranscript(sharedEncoded);
    sharedEncoded.fill(0xff);
    expect(ancV1BytesToHex(await hashPromise)).toBe(fixture.exact.digestHex);

    const sharedTranscript = {
      ...decoded,
      vaultId: shared(decoded.vaultId),
      ceremonyId: shared(decoded.ceremonyId),
      endpointId: shared(decoded.endpointId),
      endpointSigningPublicKey: shared(decoded.endpointSigningPublicKey),
      endpointKeyAgreementPublicKey: shared(
        decoded.endpointKeyAgreementPublicKey,
      ),
      enrollmentRef: shared(decoded.enrollmentRef),
      recoveryId: shared(decoded.recoveryId),
      recoverySigningPublicKey: shared(decoded.recoverySigningPublicKey),
      recoveryKeyAgreementPublicKey: shared(
        decoded.recoveryKeyAgreementPublicKey,
      ),
      recoveryWrapHash: shared(decoded.recoveryWrapHash),
      recoveryConfirmationHash: shared(decoded.recoveryConfirmationHash),
    };
    const encodedSnapshot =
      encodeAncV1GenesisBootstrapTranscript(sharedTranscript);
    for (const value of Object.values(sharedTranscript))
      if (value instanceof Uint8Array) value.fill(0xff);
    expect(ancV1BytesToHex(encodedSnapshot)).toBe(fixture.exact.transcriptHex);

    const sharedDecodeInput = shared(encoded);
    const decodedSnapshot =
      decodeAncV1GenesisBootstrapTranscript(sharedDecodeInput);
    sharedDecodeInput.fill(0xff);
    expect(
      ancV1BytesToHex(encodeAncV1GenesisBootstrapTranscript(decodedSnapshot)),
    ).toBe(fixture.exact.transcriptHex);
  });
});
