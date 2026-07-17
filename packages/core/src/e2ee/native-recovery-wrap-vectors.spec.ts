import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  ancV1BytesToHex,
  ancV1HexToBytes,
  decodeAncV1Canonical,
} from "./canonical.js";
import {
  controlLogStateSchema,
  controlMembershipCommitSchema,
  signedControlLogEntrySchema,
} from "./control-log.js";
import {
  ANC_V1_NATIVE_RECOVERY_WRAP_CATEGORIES,
  ANC_V1_NATIVE_RECOVERY_WRAP_CORPUS_SCHEMA,
  ANC_V1_NATIVE_RECOVERY_WRAP_GENERATOR,
  ANC_V1_NATIVE_RECOVERY_WRAP_SOURCE_PATHS,
  type AncV1NativeRecoveryWrapCase,
  buildAncV1NativeRecoveryWrapVectors,
} from "./native-recovery-wrap-vectors.js";
import {
  ancV1BoxEncrypt,
  ancV1BoxKeypairFromSeed,
  ancV1Hash,
  ancV1SignDetached,
  ancV1SigningKeypairFromSeed,
} from "./portable-crypto.js";
import {
  decodeAncV1RecoveryWrap,
  encodeAncV1RecoveryWrap,
  encodeAncV1UnsignedRecoveryWrap,
  hashAncV1RecoveryWrap,
  unsealAncV1RecoveryWrap,
  verifyAncV1RecoveryWrap,
  verifyAncV1RecoveryWrapRotation,
} from "./recovery-ceremony-codecs.js";

const PROTOCOL_BASE_COMMIT = "fd8c9800abbda048b21796a0953f449d1cc100ce";
const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const FIXTURE = new URL(
  "./fixtures/anc-v1-native-recovery-wrap-vectors.json",
  import.meta.url,
);
const hex = z.string().regex(/^(?:[0-9a-f]{2})+$/);
const hex16 = z.string().regex(/^[0-9a-f]{32}$/);
const hex24 = z.string().regex(/^[0-9a-f]{48}$/);
const hex32 = z.string().regex(/^[0-9a-f]{64}$/);
const hex64 = z.string().regex(/^[0-9a-f]{128}$/);
const category = z.enum(ANC_V1_NATIVE_RECOVERY_WRAP_CATEGORIES);
const overrides = z
  .object({
    expectedVaultIdHex: hex16.optional(),
    issuerSigningPublicKeyHex: hex32.optional(),
    issuerKeyAgreementPublicKeyHex: hex32.optional(),
    recoveryKeyAgreementPrivateKeyLabel: z.string().min(1).optional(),
    now: z.number().int().positive().optional(),
    // Negative vectors intentionally carry schema-invalid control values so the
    // verifier can prove it fails closed at the declared stage.
    state: z.custom<import("./control-log.js").ControlLogState>().optional(),
    commit: z
      .custom<import("./control-log.js").ControlMembershipCommit>()
      .optional(),
    entry: z
      .custom<import("./control-log.js").SignedControlLogEntry>()
      .optional(),
  })
  .strict();
const caseSchema = z
  .object({
    name: z.string().min(1),
    stage: z.enum([
      "decode",
      "verify",
      "hash",
      "rotation",
      "current",
      "unseal",
    ]),
    expectedStatus: z.enum(["accept", "reject"]),
    expectedCategory: category.nullable(),
    encodedHex: hex,
    expectedCoreErrorIncludes: z.string().nullable(),
    expectedOutputZeroed: z.boolean(),
    expectedCreatedAt: z.number().int().positive().nullable(),
    overrides,
  })
  .strict();
const corpusSchema = z
  .object({
    schema: z.literal(ANC_V1_NATIVE_RECOVERY_WRAP_CORPUS_SCHEMA),
    suite: z.literal("anc/v1"),
    encoding: z.literal("hex"),
    generator: z.literal(ANC_V1_NATIVE_RECOVERY_WRAP_GENERATOR),
    protocolBaseCommit: z.string().regex(/^[0-9a-f]{40}$/),
    sourceAnchors: z.array(
      z
        .object({
          path: z.enum(ANC_V1_NATIVE_RECOVERY_WRAP_SOURCE_PATHS),
          sha256: hex32,
        })
        .strict(),
    ),
    domains: z.array(
      z
        .object({
          operation: z.enum(["signature", "artifact_hash", "box_plaintext"]),
          tag: z.enum(["recovery-wrap", "eek-wrap"]),
          escaped: z.string(),
          utf8Hex: hex,
        })
        .strict(),
    ),
    fieldKeys: z
      .object({
        suite: z.literal(1),
        vaultId: z.literal(2),
        type: z.literal(3),
        createdAt: z.literal(4),
        envelopeId: z.literal(5),
        ceremonyId: z.literal(400),
        recoveryGeneration: z.literal(401),
        recoveryId: z.literal(402),
        recoveryKeyAgreementPublicKey: z.literal(403),
        epoch: z.literal(404),
        issuerEndpointId: z.literal(405),
        activationControlSequence: z.literal(406),
        activationPreviousHead: z.literal(407),
        activationPreviousMembershipHash: z.literal(408),
        nonce: z.literal(409),
        ciphertext: z.literal(410),
        signature: z.literal(411),
      })
      .strict(),
    categoryVocabulary: z.array(category),
    syntheticDerivation: z
      .object({
        warning: z.string().includes("Synthetic"),
        algorithm: z.literal("blake2b-256"),
        domainEscaped: z.string(),
        labels: z
          .object({
            eek: z.string(),
            issuerSigningSeed: z.string(),
            issuerAgreementSeed: z.string(),
            recoveryAgreementSeed: z.string(),
            wrongSigningSeed: z.string(),
            wrongAgreementSeed: z.string(),
          })
          .strict(),
        commitments: z.record(z.string(), hex32),
      })
      .strict(),
    exact: z
      .object({
        unsignedHex: hex,
        signedHex: hex,
        signatureHex: hex64,
        artifactHashHex: hex32,
        boxPlaintextCommitmentHex: hex32,
        ciphertextHex: hex64,
        unsealedEekCommitmentHex: hex32,
        parsed: z
          .object({
            vaultIdHex: hex16,
            envelopeIdHex: hex16,
            ceremonyIdHex: hex16,
            recoveryGeneration: z.number().int().positive(),
            recoveryIdHex: hex16,
            recoveryKeyAgreementPublicKeyHex: hex32,
            epoch: z.number().int().positive(),
            issuerEndpointIdHex: hex16,
            activationControlSequence: z.number().int().nonnegative(),
            activationPreviousHeadHex: hex32,
            activationPreviousMembershipHashHex: hex32,
            nonceHex: hex24,
            createdAt: z.number().int().positive(),
          })
          .strict(),
        issuerSigningPublicKeyHex: hex32,
        issuerAgreementPublicKeyHex: hex32,
        recoveryAgreementPublicKeyHex: hex32,
      })
      .strict(),
    baseControl: z
      .object({
        state: controlLogStateSchema,
        commit: controlMembershipCommitSchema,
        entry: signedControlLogEntrySchema,
      })
      .strict(),
    positiveCases: z.array(caseSchema).min(6),
    negativeCases: z.array(caseSchema).min(90),
  })
  .strict();

async function provenance() {
  return {
    protocolBaseCommit: PROTOCOL_BASE_COMMIT,
    sources: await Promise.all(
      ANC_V1_NATIVE_RECOVERY_WRAP_SOURCE_PATHS.map(async (path) => ({
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

function b(value: string | undefined, name: string) {
  if (!value) throw new Error(`Missing fixture override: ${name}`);
  return ancV1HexToBytes(value);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

const text = (value: string) => new TextEncoder().encode(value);
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

async function deriveSynthetic(label: string) {
  return ancV1Hash(
    "recovery-wrap",
    concat(
      text("native-recovery-wrap/test-derivation"),
      Uint8Array.of(0),
      text(label),
    ),
  );
}

async function syntheticCommitment(value: Uint8Array) {
  return ancV1Hash(
    "recovery-wrap",
    concat(
      text("native-recovery-wrap/test-commitment"),
      Uint8Array.of(0),
      value,
    ),
  );
}

const RECOVERY_WRAP_KEYS = [
  1, 2, 3, 4, 5, 400, 401, 402, 403, 404, 405, 406, 407, 408, 409, 410, 411,
] as const;
const BYTE_LENGTHS = new Map([
  [2, 16],
  [5, 16],
  [400, 16],
  [402, 16],
  [403, 32],
  [405, 16],
  [407, 32],
  [408, 32],
  [409, 24],
  [410, 64],
  [411, 64],
]);
const INTEGER_MINIMUMS = new Map([
  [4, 1],
  [401, 1],
  [404, 1],
  [406, 0],
]);

function classifyWireFailure(
  encoded: Uint8Array,
):
  | "wire.invalid_canonical"
  | "wire.missing_field"
  | "wire.unknown_field"
  | "wire.wrong_type"
  | "wire.length"
  | "wire.range"
  | "limits.envelope" {
  if (encoded.length > 1024 * 1024) return "limits.envelope";
  let value: unknown;
  try {
    value = decodeAncV1Canonical(encoded);
  } catch {
    return "wire.invalid_canonical";
  }
  if (!(value instanceof Map)) return "wire.wrong_type";
  const keys = [...value.keys()];
  if (
    keys.some(
      (key) =>
        typeof key !== "number" ||
        !(RECOVERY_WRAP_KEYS as readonly number[]).includes(key),
    )
  )
    return "wire.unknown_field";
  if (RECOVERY_WRAP_KEYS.some((key) => !value.has(key)))
    return "wire.missing_field";
  if (
    typeof value.get(1) !== "string" ||
    typeof value.get(3) !== "string" ||
    value.get(1) !== "anc/v1" ||
    value.get(3) !== "recovery-wrap"
  )
    return "wire.wrong_type";
  for (const [key, length] of BYTE_LENGTHS) {
    const field = value.get(key);
    if (!(field instanceof Uint8Array)) return "wire.wrong_type";
    if (field.length !== length) return "wire.length";
  }
  for (const [key, minimum] of INTEGER_MINIMUMS) {
    const field = value.get(key);
    if (!Number.isSafeInteger(field)) return "wire.wrong_type";
    if ((field as number) < minimum) return "wire.range";
  }
  return "wire.invalid_canonical";
}

function rotationBindingCategory(
  testCase: AncV1NativeRecoveryWrapCase,
):
  | "binding.control"
  | "binding.authority"
  | "binding.issuer"
  | "binding.activation" {
  const { state, commit, entry } = testCase.overrides;
  if (!state || !commit || !entry) return "binding.control";
  const wrap = decodeAncV1RecoveryWrap(ancV1HexToBytes(testCase.encodedHex), {
    expectedVaultId: ancV1HexToBytes(state.vaultId),
  });
  const issuerId = ancV1BytesToHex(wrap.issuerEndpointId);
  const issuer = state.activeMembers.find(
    (member) => member.endpointId === issuerId && member.role === "endpoint",
  );
  if (!issuer || issuerId !== entry.signerEndpointId) return "binding.issuer";
  if (
    wrap.epoch !== commit.epoch ||
    wrap.activationControlSequence !== entry.sequence ||
    ancV1BytesToHex(wrap.activationPreviousHead) !== state.headHash ||
    ancV1BytesToHex(wrap.activationPreviousMembershipHash) !==
      state.membershipHash
  )
    return "binding.activation";
  if (
    wrap.recoveryGeneration !== state.recoveryGeneration ||
    ancV1BytesToHex(wrap.recoveryId) !== state.recoveryId ||
    ancV1BytesToHex(wrap.recoveryKeyAgreementPublicKey) !==
      state.recoveryKeyAgreementPublicKey ||
    commit.recoveryGeneration !== state.recoveryGeneration ||
    commit.recoveryId !== state.recoveryId ||
    commit.recoverySigningPublicKey !== state.recoverySigningPublicKey ||
    commit.recoveryKeyAgreementPublicKey !== state.recoveryKeyAgreementPublicKey
  )
    return "binding.authority";
  return "binding.control";
}

async function verifyCurrent(
  testCase: AncV1NativeRecoveryWrapCase,
): Promise<null | (typeof ANC_V1_NATIVE_RECOVERY_WRAP_CATEGORIES)[number]> {
  const { state, now } = testCase.overrides;
  if (!state || now === undefined) throw new Error("Incomplete current case");
  const encoded = ancV1HexToBytes(testCase.encodedHex);
  const vault = ancV1HexToBytes(state.vaultId);
  let wrap;
  try {
    wrap = decodeAncV1RecoveryWrap(encoded, { expectedVaultId: vault });
  } catch {
    return "binding.control";
  }
  const actualHash = ancV1BytesToHex(
    await hashAncV1RecoveryWrap(encoded, vault),
  );
  if (actualHash !== state.recoveryWrapHash) return "crypto.hash";
  if (
    wrap.recoveryGeneration !== state.recoveryGeneration ||
    ancV1BytesToHex(wrap.recoveryId) !== state.recoveryId ||
    ancV1BytesToHex(wrap.recoveryKeyAgreementPublicKey) !==
      state.recoveryKeyAgreementPublicKey ||
    wrap.epoch !== state.epoch
  )
    return "binding.authority";
  if (wrap.activationControlSequence > state.sequence)
    return "binding.activation";
  const stateTime = Date.parse(state.signedAt) / 1000;
  if (
    !Number.isFinite(stateTime) ||
    wrap.createdAt > stateTime ||
    wrap.createdAt > now
  )
    return "time.current";
  const issuer = state.activeMembers.find(
    (member) =>
      member.endpointId === ancV1BytesToHex(wrap.issuerEndpointId) &&
      member.role === "endpoint",
  );
  if (!issuer) return "binding.issuer";
  try {
    await verifyAncV1RecoveryWrap(encoded, {
      expectedVaultId: vault,
      issuerSigningPublicKey: ancV1HexToBytes(issuer.signingPublicKey),
    });
  } catch {
    return "crypto.signature";
  }
  return null;
}

async function runCase(testCase: AncV1NativeRecoveryWrapCase): Promise<{
  accepted: boolean;
  category: (typeof ANC_V1_NATIVE_RECOVERY_WRAP_CATEGORIES)[number] | null;
  message: string | null;
  outputHex: string | null;
}> {
  const encoded = ancV1HexToBytes(testCase.encodedHex);
  try {
    if (testCase.stage === "decode") {
      decodeAncV1RecoveryWrap(encoded, {
        expectedVaultId:
          testCase.overrides.expectedVaultIdHex === undefined
            ? ancV1HexToBytes("01".repeat(16))
            : ancV1HexToBytes(testCase.overrides.expectedVaultIdHex),
      });
      return { accepted: true, category: null, message: null, outputHex: null };
    }
    if (testCase.stage === "verify") {
      await verifyAncV1RecoveryWrap(encoded, {
        expectedVaultId: b(
          testCase.overrides.expectedVaultIdHex,
          "expectedVaultIdHex",
        ),
        issuerSigningPublicKey: b(
          testCase.overrides.issuerSigningPublicKeyHex,
          "issuerSigningPublicKeyHex",
        ),
      });
      return { accepted: true, category: null, message: null, outputHex: null };
    }
    if (testCase.stage === "hash") {
      await hashAncV1RecoveryWrap(
        encoded,
        b(testCase.overrides.expectedVaultIdHex, "expectedVaultIdHex"),
      );
      return { accepted: true, category: null, message: null, outputHex: null };
    }
    if (testCase.stage === "rotation") {
      const { state, commit, entry } = testCase.overrides;
      if (!state || !commit || !entry)
        throw new Error("Incomplete rotation fixture");
      try {
        await verifyAncV1RecoveryWrapRotation(encoded, {
          current: state,
          commit,
          entry,
        });
        return {
          accepted: true,
          category: null,
          message: null,
          outputHex: null,
        };
      } catch (error) {
        const message = errorMessage(error);
        const lower = message.toLowerCase();
        const category = lower.includes("hash")
          ? "crypto.hash"
          : lower.includes("timestamp") ||
              lower.includes("datetime") ||
              lower.includes("date")
            ? "time.rotation"
            : lower.includes("ordinary")
              ? "binding.control"
              : rotationBindingCategory(testCase);
        return { accepted: false, category, message, outputHex: null };
      }
    }
    if (testCase.stage === "current") {
      const category = await verifyCurrent(testCase);
      return {
        accepted: category === null,
        category,
        message: null,
        outputHex: null,
      };
    }
    const privateKeyLabel =
      testCase.overrides.recoveryKeyAgreementPrivateKeyLabel;
    if (!privateKeyLabel)
      throw new Error("Missing recovery private-key derivation label");
    const privateSeed = await deriveSynthetic(privateKeyLabel);
    const privatePair = await ancV1BoxKeypairFromSeed(privateSeed);
    try {
      const output = await unsealAncV1RecoveryWrap(encoded, {
        expectedVaultId: b(
          testCase.overrides.expectedVaultIdHex,
          "expectedVaultIdHex",
        ),
        issuerSigningPublicKey: b(
          testCase.overrides.issuerSigningPublicKeyHex,
          "issuerSigningPublicKeyHex",
        ),
        issuerKeyAgreementPublicKey: b(
          testCase.overrides.issuerKeyAgreementPublicKeyHex,
          "issuerKeyAgreementPublicKeyHex",
        ),
        recoveryKeyAgreementPrivateKey: privatePair.privateKey,
      });
      const commitment = ancV1BytesToHex(await syntheticCommitment(output));
      output.fill(0);
      return {
        accepted: true,
        category: null,
        message: null,
        outputHex: commitment,
      };
    } catch (error) {
      const message = errorMessage(error);
      return {
        accepted: false,
        category: message.toLowerCase().includes("domain")
          ? "unseal.domain"
          : "unseal.authentication",
        message,
        outputHex: null,
      };
    } finally {
      privateSeed.fill(0);
      privatePair.privateKey.fill(0);
    }
  } catch (error) {
    const message = errorMessage(error);
    let category:
      | (typeof ANC_V1_NATIVE_RECOVERY_WRAP_CATEGORIES)[number]
      | null = null;
    if (testCase.stage === "decode") category = classifyWireFailure(encoded);
    else if (testCase.stage === "verify")
      category = message.toLowerCase().includes("vault")
        ? "binding.control"
        : "crypto.signature";
    return {
      accepted: false,
      category,
      message,
      outputHex: null,
    };
  }
}

describe("anc/v1 native signed recovery-wrap vectors", () => {
  it("is strict, source anchored, and exactly reproducible", async () => {
    const fixture = await corpus();
    const source = await provenance();
    expect(fixture.protocolBaseCommit).toBe(source.protocolBaseCommit);
    expect(fixture.sourceAnchors).toEqual(source.sources);
    expect(fixture).toEqual(await buildAncV1NativeRecoveryWrapVectors(source));
    expect(fixture.categoryVocabulary).toEqual(
      ANC_V1_NATIVE_RECOVERY_WRAP_CATEGORIES,
    );
    expect(
      corpusSchema.safeParse({ ...fixture, unexpected: true }).success,
    ).toBe(false);
  });

  it("pins exact unsigned, signed, signature, hash, box and parsed values", async () => {
    const fixture = await corpus();
    const parsed = decodeAncV1RecoveryWrap(
      ancV1HexToBytes(fixture.exact.signedHex),
      { expectedVaultId: ancV1HexToBytes(fixture.exact.parsed.vaultIdHex) },
    );
    const { signature, ...unsigned } = parsed;
    expect(ancV1BytesToHex(encodeAncV1UnsignedRecoveryWrap(unsigned))).toBe(
      fixture.exact.unsignedHex,
    );
    expect(ancV1BytesToHex(encodeAncV1RecoveryWrap(parsed))).toBe(
      fixture.exact.signedHex,
    );
    expect(ancV1BytesToHex(signature)).toBe(fixture.exact.signatureHex);
    expect(
      ancV1BytesToHex(
        await hashAncV1RecoveryWrap(
          ancV1HexToBytes(fixture.exact.signedHex),
          ancV1HexToBytes(fixture.exact.parsed.vaultIdHex),
        ),
      ),
    ).toBe(fixture.exact.artifactHashHex);
    expect(ancV1BytesToHex(parsed.ciphertext)).toBe(
      fixture.exact.ciphertextHex,
    );
    expect(ancV1BytesToHex(parsed.nonce)).toBe(fixture.exact.parsed.nonceHex);
    expect(parsed.createdAt).toBe(fixture.exact.parsed.createdAt);
    expect(parsed.suite).toBe("anc/v1");
    expect(parsed.type).toBe("recovery-wrap");
    expect(ancV1BytesToHex(parsed.vaultId)).toBe(
      fixture.exact.parsed.vaultIdHex,
    );
    expect(ancV1BytesToHex(parsed.envelopeId)).toBe(
      fixture.exact.parsed.envelopeIdHex,
    );
    expect(ancV1BytesToHex(parsed.ceremonyId)).toBe(
      fixture.exact.parsed.ceremonyIdHex,
    );
    expect(parsed.recoveryGeneration).toBe(
      fixture.exact.parsed.recoveryGeneration,
    );
    expect(ancV1BytesToHex(parsed.recoveryId)).toBe(
      fixture.exact.parsed.recoveryIdHex,
    );
    expect(ancV1BytesToHex(parsed.recoveryKeyAgreementPublicKey)).toBe(
      fixture.exact.parsed.recoveryKeyAgreementPublicKeyHex,
    );
    expect(parsed.epoch).toBe(fixture.exact.parsed.epoch);
    expect(ancV1BytesToHex(parsed.issuerEndpointId)).toBe(
      fixture.exact.parsed.issuerEndpointIdHex,
    );
    expect(parsed.activationControlSequence).toBe(
      fixture.exact.parsed.activationControlSequence,
    );
    expect(ancV1BytesToHex(parsed.activationPreviousHead)).toBe(
      fixture.exact.parsed.activationPreviousHeadHex,
    );
    expect(ancV1BytesToHex(parsed.activationPreviousMembershipHash)).toBe(
      fixture.exact.parsed.activationPreviousMembershipHashHex,
    );
    expect(
      decodeAncV1Canonical(ancV1HexToBytes(fixture.exact.signedHex)),
    ).toBeInstanceOf(Map);
  });

  it("derives the declared synthetic public keys and unseals the fixed EEK", async () => {
    const fixture = await corpus();
    const signingSeed = await deriveSynthetic(
      fixture.syntheticDerivation.labels.issuerSigningSeed,
    );
    const issuerAgreementSeed = await deriveSynthetic(
      fixture.syntheticDerivation.labels.issuerAgreementSeed,
    );
    const recoveryAgreementSeed = await deriveSynthetic(
      fixture.syntheticDerivation.labels.recoveryAgreementSeed,
    );
    const eek = await deriveSynthetic(fixture.syntheticDerivation.labels.eek);
    const wrongSigningSeed = await deriveSynthetic(
      fixture.syntheticDerivation.labels.wrongSigningSeed,
    );
    const wrongAgreementSeed = await deriveSynthetic(
      fixture.syntheticDerivation.labels.wrongAgreementSeed,
    );
    for (const [name, value] of Object.entries({
      eek,
      issuerSigningSeed: signingSeed,
      issuerAgreementSeed,
      recoveryAgreementSeed,
      wrongSigningSeed,
      wrongAgreementSeed,
    }))
      expect(ancV1BytesToHex(await syntheticCommitment(value)), name).toBe(
        fixture.syntheticDerivation.commitments[name],
      );
    expect(
      ancV1BytesToHex(
        await syntheticCommitment(
          concat(text("anc/v1/eek-wrap"), Uint8Array.of(0), eek),
        ),
      ),
    ).toBe(fixture.exact.boxPlaintextCommitmentHex);
    const signing = await ancV1SigningKeypairFromSeed(signingSeed);
    const issuerAgreement = await ancV1BoxKeypairFromSeed(issuerAgreementSeed);
    const recoveryAgreement = await ancV1BoxKeypairFromSeed(
      recoveryAgreementSeed,
    );
    expect(ancV1BytesToHex(signing.publicKey)).toBe(
      fixture.exact.issuerSigningPublicKeyHex,
    );
    expect(ancV1BytesToHex(issuerAgreement.publicKey)).toBe(
      fixture.exact.issuerAgreementPublicKeyHex,
    );
    expect(ancV1BytesToHex(recoveryAgreement.publicKey)).toBe(
      fixture.exact.recoveryAgreementPublicKeyHex,
    );
    const parsed = decodeAncV1RecoveryWrap(
      ancV1HexToBytes(fixture.exact.signedHex),
      { expectedVaultId: ancV1HexToBytes(fixture.exact.parsed.vaultIdHex) },
    );
    const { signature: _fixtureSignature, ...unsigned } = parsed;
    expect(
      ancV1BytesToHex(
        await ancV1SignDetached(
          "recovery-wrap",
          encodeAncV1UnsignedRecoveryWrap(unsigned),
          signing.privateKey,
        ),
      ),
    ).toBe(fixture.exact.signatureHex);
    expect(
      ancV1BytesToHex(
        await ancV1BoxEncrypt(
          "eek-wrap",
          eek,
          parsed.nonce,
          recoveryAgreement.publicKey,
          issuerAgreement.privateKey,
        ),
      ),
    ).toBe(fixture.exact.ciphertextHex);
    const unsealed = await unsealAncV1RecoveryWrap(
      ancV1HexToBytes(fixture.exact.signedHex),
      {
        expectedVaultId: ancV1HexToBytes(fixture.exact.parsed.vaultIdHex),
        issuerSigningPublicKey: signing.publicKey,
        issuerKeyAgreementPublicKey: issuerAgreement.publicKey,
        recoveryKeyAgreementPrivateKey: recoveryAgreement.privateKey,
      },
    );
    expect(ancV1BytesToHex(await syntheticCommitment(unsealed))).toBe(
      fixture.exact.unsealedEekCommitmentHex,
    );
    expect(unsealed).toEqual(eek);
    for (const secret of [
      unsealed,
      eek,
      signingSeed,
      issuerAgreementSeed,
      recoveryAgreementSeed,
      wrongSigningSeed,
      wrongAgreementSeed,
      signing.privateKey,
      issuerAgreement.privateKey,
      recoveryAgreement.privateKey,
    ])
      secret.fill(0);
  });

  it("reaches every declared acceptance or typed fixture-local failure stage", async () => {
    const fixture = await corpus();
    for (const testCase of [
      ...fixture.positiveCases,
      ...fixture.negativeCases,
    ]) {
      const result = await runCase(testCase);
      expect(result.accepted, testCase.name).toBe(
        testCase.expectedStatus === "accept",
      );
      expect(result.category, testCase.name).toBe(testCase.expectedCategory);
      if (testCase.expectedCoreErrorIncludes)
        expect(result.message?.toLowerCase(), testCase.name).toContain(
          testCase.expectedCoreErrorIncludes.toLowerCase(),
        );
      if (testCase.expectedOutputZeroed)
        expect(result.outputHex, testCase.name).toBeNull();
      if (testCase.expectedCreatedAt !== null) {
        const decoded = decodeAncV1RecoveryWrap(
          ancV1HexToBytes(testCase.encodedHex),
          {
            expectedVaultId: ancV1HexToBytes(fixture.exact.parsed.vaultIdHex),
          },
        );
        expect(decoded.createdAt, testCase.name).toBe(
          testCase.expectedCreatedAt,
        );
      }
      if (testCase.expectedStatus === "accept" && testCase.stage === "unseal")
        expect(result.outputHex, testCase.name).toBe(
          fixture.exact.unsealedEekCommitmentHex,
        );
    }
  });
});
