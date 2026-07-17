import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import sodium from "libsodium-wrappers-sumo";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  type AncV1CanonicalValue,
  ancV1BytesToHex,
  ancV1HexToBytes,
  decodeAncV1Canonical,
  encodeAncV1Canonical,
} from "./canonical.js";
import { controlLogMemberSchema } from "./control-log.js";
import {
  ANC_V1_NATIVE_AUTHORITY_STORE_CORPUS_SCHEMA,
  ANC_V1_NATIVE_AUTHORITY_STORE_GENERATOR,
  ANC_V1_NATIVE_AUTHORITY_STORE_SOURCE_PATHS,
  buildAncV1NativeAuthorityStoreVectors,
} from "./native-authority-store-vectors.js";

const PROTOCOL_BASE_COMMIT = "de5291f47275dcc96d285bb92623496aedb5394e";
const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const FIXTURE = new URL(
  "./fixtures/anc-v1-native-authority-store-vectors.json",
  import.meta.url,
);
const hex = z.string().regex(/^(?:[0-9a-f]{2})+$/);
const hex32 = z.string().regex(/^[0-9a-f]{64}$/);
const protocolTimestamp = z.string().datetime({ offset: true });
const sourceSchema = z
  .object({
    path: z.enum(ANC_V1_NATIVE_AUTHORITY_STORE_SOURCE_PATHS),
    sha256: hex32,
  })
  .strict();
const snapshotSchema = z
  .object({
    version: z.literal(1),
    vaultId: z.string(),
    targetCustodyGeneration: z.number().int().positive(),
    previousCustodyGeneration: z.number().int().nonnegative(),
    previousSequence: z.number().int().nonnegative().nullable(),
    previousHeadHex: hex32.nullable(),
    verifiedAtMs: z.number().int().positive(),
    sequence: z.number().int().nonnegative(),
    headHex: hex32,
    membershipHex: hex32,
    signedAt: z.string(),
    activeMembers: z.array(controlLogMemberSchema).min(1).max(64),
    removedEndpointIds: z.array(z.string()).max(4096),
    epoch: z.number().int().positive(),
    recoveryGeneration: z.number().int().positive(),
    recoveryId: z.string(),
    recoverySigningPublicKeyHex: hex32,
    recoveryKeyAgreementPublicKeyHex: hex32,
    recoveryWrapHashHex: hex32,
    freshnessMode: z.enum(["endpoint_witnessed", "eventual_fork_detection"]),
  })
  .strict();
const corpusSchema = z
  .object({
    schema: z.literal(ANC_V1_NATIVE_AUTHORITY_STORE_CORPUS_SCHEMA),
    suite: z.literal("anc/v1"),
    encoding: z.literal("hex"),
    generator: z.literal(ANC_V1_NATIVE_AUTHORITY_STORE_GENERATOR),
    protocolBaseCommit: z.string().regex(/^[0-9a-f]{40}$/),
    sourceAnchors: z
      .array(sourceSchema)
      .length(ANC_V1_NATIVE_AUTHORITY_STORE_SOURCE_PATHS.length),
    domains: z.record(
      z.string(),
      z.object({ escaped: z.string(), utf8Hex: hex }).strict(),
    ),
    syntheticDerivation: z
      .object({
        warning: z.string(),
        labels: z.record(z.string(), z.string()),
        commitments: z.record(z.string(), hex32),
      })
      .strict(),
    custodyLayout: z
      .object({
        bytes: z.literal(1088),
        versionOffset: z.literal(4),
        flagsOffset: z.literal(13),
        anchorPresentBit: z.literal(0),
        expectedEdgePresentBit: z.literal(1),
        checksumOffset: z.literal(1056),
      })
      .strict(),
    custodyCases: z.array(
      z
        .object({
          name: z.string(),
          recordTemplateHex: hex,
          recordCommitmentHex: hex32,
          secretSlots: z.array(
            z
              .object({
                offset: z.number().int().nonnegative(),
                length: z.number().int().positive(),
                label: z.string().nullable(),
              })
              .strict(),
          ),
          checksumXor: z.number().int().min(0).max(255),
          expectedStatus: z.enum(["accept", "reject"]),
          expectedError: z.string().nullable(),
          expectedPresence: z
            .object({ anchor: z.boolean(), expectedEdge: z.boolean() })
            .strict()
            .nullable(),
        })
        .strict(),
    ),
    snapshotCases: z.array(
      z
        .object({
          name: z.string(),
          snapshot: snapshotSchema.nullable(),
          canonicalHex: hex,
          canonicalBlake2b256Hex: hex32.nullable(),
          expectedStatus: z.enum(["accept", "reject"]),
          expectedError: z.string().nullable(),
        })
        .strict(),
    ),
    frameVector: z
      .object({
        localStateKeyLabel: z.string(),
        localStateKeyCommitmentHex: hex32,
        vaultId: z.string(),
        custodyGeneration: z.number().int().positive(),
        nonceHex: z.string().regex(/^[0-9a-f]{48}$/),
        derivedKeyCommitmentHex: hex32,
        vaultDigestHex: hex32,
        plaintextCommitmentHex: hex32,
        headerHex: hex,
        aadHex: hex,
        ciphertextHex: hex,
        frameHex: hex,
        frameDigestHex: hex32,
      })
      .strict(),
    frameMutations: z.array(
      z
        .object({
          name: z.string(),
          frameHex: hex,
          frameDigestHex: hex32,
          localStateKeyLabel: z.string(),
          vaultId: z.string(),
          custodyGeneration: z.number().int().positive(),
          expectedStatus: z.literal("reject"),
          expectedError: z.string(),
        })
        .strict(),
    ),
  })
  .strict();

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
const domain = (value: string) => concat(text(value), Uint8Array.of(0));
const u16 = (value: number) => Uint8Array.of(value >>> 8, value);
const u32 = (value: number) =>
  Uint8Array.of(value >>> 24, value >>> 16, value >>> 8, value);
const u64 = (value: number) => {
  const output = new Uint8Array(8);
  let remaining = BigInt(value);
  for (let index = 7; index >= 0; index -= 1) {
    output[index] = Number(remaining & 255n);
    remaining >>= 8n;
  }
  return output;
};
const readU16 = (bytes: Uint8Array, offset: number) =>
  (bytes[offset]! << 8) | bytes[offset + 1]!;
const readU32 = (bytes: Uint8Array, offset: number) =>
  bytes[offset]! * 0x1000000 +
  (bytes[offset + 1]! << 16) +
  (bytes[offset + 2]! << 8) +
  bytes[offset + 3]!;
const readU64 = (bytes: Uint8Array, offset: number) => {
  let value = 0n;
  for (let index = 0; index < 8; index += 1)
    value = (value << 8n) | BigInt(bytes[offset + index]!);
  return Number(value);
};
const isZero = (bytes: Uint8Array) => bytes.every((byte) => byte === 0);
const hash = async (bytes: Uint8Array, key?: Uint8Array) => {
  await sodium.ready;
  return sodium.crypto_generichash(32, bytes, key ?? null);
};

async function deriveSynthetic(label: string) {
  return hash(
    concat(
      domain("anc/v1/private-vault/authority-store/test-derivation"),
      text(label),
    ),
  );
}

async function syntheticCommitment(value: Uint8Array) {
  return hash(
    concat(
      domain("anc/v1/private-vault/authority-store/test-commitment"),
      value,
    ),
  );
}

async function reconstructCustody(testCase: {
  recordTemplateHex: string;
  recordCommitmentHex: string;
  secretSlots: readonly {
    offset: number;
    length: number;
    label: string | null;
  }[];
  checksumXor: number;
}) {
  const record = ancV1HexToBytes(testCase.recordTemplateHex);
  const secrets: Uint8Array[] = [];
  for (const slot of testCase.secretSlots) {
    if (slot.label === null) continue;
    const secret = await deriveSynthetic(slot.label);
    if (secret.length !== slot.length)
      throw new Error("Synthetic custody slot length mismatch");
    record.set(secret, slot.offset);
    secrets.push(secret);
  }
  const checksum = await hash(
    concat(
      domain("agent-native/private-vault/custody-record/checksum/anc-v1"),
      record.slice(0, 1056),
    ),
  );
  checksum[0] ^= testCase.checksumXor;
  record.set(checksum, 1056);
  checksum.fill(0);
  expect(ancV1BytesToHex(await syntheticCommitment(record))).toBe(
    testCase.recordCommitmentHex,
  );
  return { record, secrets };
}

async function provenance() {
  return {
    protocolBaseCommit: PROTOCOL_BASE_COMMIT,
    sources: await Promise.all(
      ANC_V1_NATIVE_AUTHORITY_STORE_SOURCE_PATHS.map(async (path) => ({
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

async function custodyStatus(record: Uint8Array) {
  if (record.length !== 1088) return { ok: false, error: "length" };
  const expected = await hash(
    concat(
      domain("agent-native/private-vault/custody-record/checksum/anc-v1"),
      record.slice(0, 1056),
    ),
  );
  if (!sodium.memcmp(expected, record.slice(1056)))
    return { ok: false, error: "checksum_failed" };
  const version = readU16(record, 4);
  const flags = record[13]!;
  if (version !== 1 && version !== 2)
    return { ok: false, error: "unknown_version" };
  if (version === 1 && flags !== 0) return { ok: false, error: "v1_flags" };
  if (version === 2 && (flags & 0xfc) !== 0)
    return { ok: false, error: "unknown_flags" };
  const sequence = readU64(record, 752);
  const head = record.slice(760, 792);
  const membership = record.slice(792, 824);
  const signedAt = readU64(record, 824);
  const digest = record.slice(832, 864);
  const freshness = readU64(record, 864);
  const next = readU64(record, 872);
  const previous = record.slice(880, 912);
  const transcript = record.slice(912, 944);
  const anchor = version === 2 ? (flags & 1) !== 0 : sequence !== 0;
  const edge = version === 2 ? (flags & 2) !== 0 : next !== 0;
  const anchorFieldsNonzero =
    !isZero(head) &&
    !isZero(membership) &&
    signedAt > 0 &&
    !isZero(digest) &&
    freshness > 0;
  if (
    (!anchor &&
      (sequence !== 0 ||
        !isZero(head) ||
        !isZero(membership) ||
        signedAt !== 0 ||
        !isZero(digest) ||
        freshness !== 0)) ||
    (anchor && !anchorFieldsNonzero)
  )
    return {
      ok: false,
      error:
        version === 1
          ? "v1_sequence_zero_anchor"
          : anchor
            ? "present_anchor_incomplete"
            : "absent_anchor_nonzero",
    };
  if (!edge && (next !== 0 || !isZero(previous) || !isZero(transcript)))
    return { ok: false, error: "absent_edge_nonzero" };
  if (edge) {
    if (isZero(transcript)) return { ok: false, error: "descendant_edge" };
    if (sequence === 0) {
      if (next !== 0 || !isZero(previous))
        return { ok: false, error: "genesis_previous_head" };
    } else if (next !== sequence + 1 || !sodium.memcmp(previous, head)) {
      return { ok: false, error: "descendant_edge" };
    }
  }
  return { ok: true, presence: { anchor, expectedEdge: edge } };
}

function snapshotStatus(
  bytes: Uint8Array,
): { ok: true; error: null } | { ok: false; error: string } {
  const opaqueId = (value: unknown) =>
    typeof value === "string" &&
    value.length >= 8 &&
    value.length <= 160 &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
  if (bytes.length > 1024 * 1024) return { ok: false, error: "size" };
  if (bytes.length > 32 && bytes.slice(0, 33).every((byte) => byte === 0x81))
    return { ok: false, error: "depth" };
  let decoded: AncV1CanonicalValue;
  try {
    decoded = decodeAncV1Canonical(bytes, { maxBytes: 1024 * 1024 });
  } catch {
    return {
      ok: false,
      error:
        bytes.length >= 5 &&
        bytes[0] === 0xa2 &&
        bytes[1] === 0x01 &&
        bytes[3] === 0x01
          ? "duplicate_key"
          : "non_canonical",
    };
  }
  try {
    if (!(decoded instanceof Map)) return { ok: false, error: "wrong_type" };
    const keys = [
      1, 2, 3, 500, 501, 502, 503, 504, 505, 510, 511, 512, 513, 514, 515, 516,
      517, 518, 519, 520, 521, 522,
    ];
    if ([...decoded.keys()].some((key) => !keys.includes(key)))
      return { ok: false, error: "unknown_field" };
    if (decoded.size !== keys.length || keys.some((key) => !decoded.has(key)))
      return { ok: false, error: "missing_field" };
    if (
      decoded.get(1) !== "anc/v1" ||
      typeof decoded.get(2) !== "string" ||
      decoded.get(3) !== "authority-snapshot" ||
      decoded.get(500) !== 1
    )
      return { ok: false, error: "wrong_type" };
    if (!opaqueId(decoded.get(2))) return { ok: false, error: "invalid_id" };
    const verifiedAt = decoded.get(505);
    if (!Number.isSafeInteger(verifiedAt))
      return { ok: false, error: "wrong_type" };
    if ((verifiedAt as number) < 1)
      return { ok: false, error: "verified_at_range" };
    for (const [key, minimum] of [
      [501, 1],
      [502, 0],
      [510, 0],
      [516, 1],
      [517, 1],
    ] as const) {
      const value = decoded.get(key);
      if (!Number.isSafeInteger(value) || (value as number) < minimum)
        return { ok: false, error: "wrong_type" };
    }
    const previousSequence = decoded.get(503);
    const previousHead = decoded.get(504);
    if (
      !(
        (previousSequence === null && previousHead === null) ||
        (Number.isSafeInteger(previousSequence) &&
          (previousSequence as number) >= 0 &&
          previousHead instanceof Uint8Array &&
          previousHead.length === 32)
      )
    )
      return { ok: false, error: "wrong_type" };
    for (const key of [511, 512, 519, 520, 521]) {
      const value = decoded.get(key);
      if (!(value instanceof Uint8Array))
        return { ok: false, error: "wrong_type" };
      if (value.length !== 32) return { ok: false, error: "key_length" };
    }
    const members = decoded.get(514);
    const removed = decoded.get(515);
    if (
      !Array.isArray(members) ||
      members.length < 1 ||
      members.length > 64 ||
      !Array.isArray(removed)
    )
      return { ok: false, error: "wrong_type" };
    if (removed.length > 4096) return { ok: false, error: "removed_limit" };
    const memberIds: string[] = [];
    let brokerCount = 0;
    for (const member of members) {
      if (
        !Array.isArray(member) ||
        member.length !== 6 ||
        typeof member[0] !== "string" ||
        (member[1] !== "endpoint" && member[1] !== "broker") ||
        typeof member[2] !== "boolean" ||
        !(member[3] instanceof Uint8Array) ||
        member[3].length !== 32 ||
        !(member[4] instanceof Uint8Array) ||
        member[4].length !== 32 ||
        typeof member[5] !== "string"
      )
        return { ok: false, error: "wrong_type" };
      if (!opaqueId(member[0]) || !opaqueId(member[5]))
        return { ok: false, error: "invalid_id" };
      if (member[2] !== (member[1] === "broker"))
        return { ok: false, error: "member_unattended_role" };
      if (member[1] === "broker") brokerCount += 1;
      memberIds.push(member[0]);
    }
    if (brokerCount > 1) return { ok: false, error: "multiple_active_brokers" };
    if (memberIds.some((id, index) => index > 0 && memberIds[index - 1]! >= id))
      return { ok: false, error: "member_order" };
    if (removed.some((id) => typeof id !== "string"))
      return { ok: false, error: "wrong_type" };
    if (removed.some((id) => !opaqueId(id)))
      return { ok: false, error: "invalid_id" };
    for (let index = 1; index < removed.length; index += 1) {
      if ((removed[index - 1] as string) === removed[index])
        return { ok: false, error: "removed_duplicates" };
      if ((removed[index - 1] as string) > (removed[index] as string))
        return { ok: false, error: "wrong_type" };
    }
    if (removed.some((id) => memberIds.includes(id as string)))
      return { ok: false, error: "removed_active_overlap" };
    const signedAt = decoded.get(513);
    if (typeof signedAt !== "string") return { ok: false, error: "wrong_type" };
    if (!protocolTimestamp.safeParse(signedAt).success)
      return { ok: false, error: "invalid_timestamp" };
    if (Date.parse(signedAt) > (verifiedAt as number) + 30_000)
      return { ok: false, error: "future_timestamp" };
    if (
      typeof decoded.get(518) !== "string" ||
      (decoded.get(522) !== "endpoint_witnessed" &&
        decoded.get(522) !== "eventual_fork_detection")
    )
      return { ok: false, error: "wrong_type" };
    if (!opaqueId(decoded.get(518))) return { ok: false, error: "invalid_id" };
    const target = decoded.get(501) as number;
    const previousGeneration = decoded.get(502) as number;
    const sequence = decoded.get(510) as number;
    if (
      target !== previousGeneration + 1 ||
      (sequence === 0
        ? previousSequence !== null || previousHead !== null
        : previousSequence !== sequence - 1 || previousHead === null)
    )
      return { ok: false, error: "wrong_type" };
    if (
      ancV1BytesToHex(encodeAncV1Canonical(decoded)) !== ancV1BytesToHex(bytes)
    )
      return { ok: false, error: "non_canonical" };
    return { ok: true, error: null };
  } catch {
    return { ok: false, error: "wrong_type" };
  }
}

async function openFrame(input: {
  frameHex: string;
  frameDigestHex: string;
  localStateKeyLabel: string;
  vaultId: string;
  custodyGeneration: number;
}): Promise<
  { ok: true; plaintextCommitmentHex: string } | { ok: false; error: string }
> {
  const frame = ancV1HexToBytes(input.frameHex);
  const suppliedDigest = ancV1HexToBytes(input.frameDigestHex);
  const actualDigest = await hash(
    concat(domain("anc/v1/private-vault/authority-store/frame-digest"), frame),
  );
  try {
    if (!sodium.memcmp(actualDigest, suppliedDigest))
      return { ok: false, error: "frame_digest_mismatch" };
    if (
      frame.length < 100 ||
      new TextDecoder().decode(frame.slice(0, 8)) !== "ANPVAU01" ||
      readU16(frame, 8) !== 1 ||
      readU16(frame, 10) !== 0
    )
      return { ok: false, error: "invalid_header" };
    const generation = readU64(frame, 12);
    if (generation !== input.custodyGeneration)
      return { ok: false, error: "wrong_generation" };
    const plainLength = readU32(frame, 20);
    const cipherLength = readU32(frame, 24);
    if (
      plainLength < 1 ||
      plainLength > 1024 * 1024 ||
      cipherLength !== plainLength + 16 ||
      frame.length !== 84 + cipherLength
    )
      return { ok: false, error: "invalid_length" };
    const vaultBytes = text(input.vaultId);
    const vaultDigest = await hash(
      concat(
        domain("anc/v1/private-vault/authority-store/vault-id"),
        u32(vaultBytes.length),
        vaultBytes,
      ),
    );
    if (!sodium.memcmp(vaultDigest, frame.slice(28, 60)))
      return { ok: false, error: "wrong_vault" };
    const localStateKey = await deriveSynthetic(input.localStateKeyLabel);
    const key = await hash(
      concat(
        domain("anc/v1/private-vault/authority-store/key"),
        vaultDigest,
        u64(generation),
      ),
      localStateKey,
    );
    try {
      const plaintext = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
        null,
        frame.slice(84),
        concat(
          domain("anc/v1/private-vault/authority-store/aad"),
          frame.slice(0, 84),
        ),
        frame.slice(60, 84),
        key,
      );
      try {
        return {
          ok: true,
          plaintextCommitmentHex: ancV1BytesToHex(
            await syntheticCommitment(plaintext),
          ),
        };
      } finally {
        plaintext.fill(0);
      }
    } catch {
      return { ok: false, error: "authentication_failed" };
    } finally {
      key.fill(0);
      localStateKey.fill(0);
    }
  } finally {
    actualDigest.fill(0);
    suppliedDigest.fill(0);
  }
}

describe("anc/v1 native AuthorityStore vectors", () => {
  it("is strict, source-anchored, and generated", async () => {
    const fixture = await corpus();
    const source = await provenance();
    expect(fixture.protocolBaseCommit).toBe(source.protocolBaseCommit);
    expect(fixture.sourceAnchors).toEqual(source.sources);
    expect(fixture).toEqual(
      await buildAncV1NativeAuthorityStoreVectors(source),
    );
    expect(corpusSchema.safeParse({ ...fixture, unknown: true }).success).toBe(
      false,
    );
  });

  it("maps v2 presence bits and v1 compatibility exactly", async () => {
    const fixture = await corpus();
    for (const testCase of fixture.custodyCases) {
      const { record, secrets } = await reconstructCustody(testCase);
      try {
        const status = await custodyStatus(record);
        expect(status.ok, testCase.name).toBe(
          testCase.expectedStatus === "accept",
        );
        if (status.ok)
          expect(status.presence).toEqual(testCase.expectedPresence);
        else expect(status.error).toBe(testCase.expectedError);
      } finally {
        record.fill(0);
        for (const secret of secrets) secret.fill(0);
      }
    }
  });

  it("pins canonical authority snapshots and diagnostic hashes", async () => {
    const fixture = await corpus();
    for (const testCase of fixture.snapshotCases) {
      const bytes = ancV1HexToBytes(testCase.canonicalHex);
      const status = snapshotStatus(bytes);
      expect(status.ok, testCase.name).toBe(
        testCase.expectedStatus === "accept",
      );
      expect(status.error, testCase.name).toBe(testCase.expectedError);
      if (testCase.expectedStatus === "accept") {
        expect(ancV1BytesToHex(await hash(bytes))).toBe(
          testCase.canonicalBlake2b256Hex,
        );
        const decoded = decodeAncV1Canonical(bytes);
        expect(decoded).toBeInstanceOf(Map);
        if (decoded instanceof Map && testCase.snapshot) {
          expect(decoded.get(513), testCase.name).toBe(
            testCase.snapshot.signedAt,
          );
          expect(protocolTimestamp.safeParse(decoded.get(513)).success).toBe(
            true,
          );
          expect(Date.parse(decoded.get(513) as string), testCase.name).toBe(
            Date.parse(testCase.snapshot.signedAt),
          );
          expect(
            Date.parse(decoded.get(513) as string),
            testCase.name,
          ).toBeLessThanOrEqual(testCase.snapshot.verifiedAtMs + 30_000);
        }
      }
    }
  });

  it("pins key derivation, the 84-byte header, AEAD, and every mutation", async () => {
    const fixture = await corpus();
    expect(fixture.frameVector.headerHex.length / 2).toBe(84);
    const localStateKey = await deriveSynthetic(
      fixture.frameVector.localStateKeyLabel,
    );
    const vaultBytes = text(fixture.frameVector.vaultId);
    const vaultDigest = await hash(
      concat(
        domain("anc/v1/private-vault/authority-store/vault-id"),
        u32(vaultBytes.length),
        vaultBytes,
      ),
    );
    const derivedKey = await hash(
      concat(
        domain("anc/v1/private-vault/authority-store/key"),
        vaultDigest,
        u64(fixture.frameVector.custodyGeneration),
      ),
      localStateKey,
    );
    const descendant = fixture.snapshotCases.find(
      (entry) => entry.name === "descendant",
    )!;
    const plaintext = ancV1HexToBytes(descendant.canonicalHex);
    const nonce = new Uint8Array(24).fill(0xa5);
    const header = concat(
      text("ANPVAU01"),
      u16(1),
      u16(0),
      u64(fixture.frameVector.custodyGeneration),
      u32(plaintext.length),
      u32(plaintext.length + 16),
      vaultDigest,
      nonce,
    );
    const aad = concat(
      domain("anc/v1/private-vault/authority-store/aad"),
      header,
    );
    const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
      plaintext,
      aad,
      null,
      nonce,
      derivedKey,
    );
    const frame = concat(header, ciphertext);
    const frameDigest = await hash(
      concat(
        domain("anc/v1/private-vault/authority-store/frame-digest"),
        frame,
      ),
    );
    try {
      expect(ancV1BytesToHex(await syntheticCommitment(localStateKey))).toBe(
        fixture.frameVector.localStateKeyCommitmentHex,
      );
      expect(ancV1BytesToHex(await syntheticCommitment(derivedKey))).toBe(
        fixture.frameVector.derivedKeyCommitmentHex,
      );
      expect(ancV1BytesToHex(await syntheticCommitment(plaintext))).toBe(
        fixture.frameVector.plaintextCommitmentHex,
      );
      expect(ancV1BytesToHex(vaultDigest)).toBe(
        fixture.frameVector.vaultDigestHex,
      );
      expect(ancV1BytesToHex(nonce)).toBe(fixture.frameVector.nonceHex);
      expect(ancV1BytesToHex(header)).toBe(fixture.frameVector.headerHex);
      expect(ancV1BytesToHex(aad)).toBe(fixture.frameVector.aadHex);
      expect(ancV1BytesToHex(ciphertext)).toBe(
        fixture.frameVector.ciphertextHex,
      );
      expect(ancV1BytesToHex(frame)).toBe(fixture.frameVector.frameHex);
      expect(ancV1BytesToHex(frameDigest)).toBe(
        fixture.frameVector.frameDigestHex,
      );
      expect(ancV1BytesToHex(frame.slice(0, 84))).toBe(
        fixture.frameVector.headerHex,
      );
      expect(ancV1BytesToHex(frame.slice(60, 84))).toBe(
        fixture.frameVector.nonceHex,
      );
      expect(ancV1BytesToHex(frame.slice(84))).toBe(
        fixture.frameVector.ciphertextHex,
      );
    } finally {
      localStateKey.fill(0);
      derivedKey.fill(0);
      plaintext.fill(0);
      frameDigest.fill(0);
    }
    const opened = await openFrame({
      frameHex: fixture.frameVector.frameHex,
      frameDigestHex: fixture.frameVector.frameDigestHex,
      localStateKeyLabel: fixture.frameVector.localStateKeyLabel,
      vaultId: fixture.frameVector.vaultId,
      custodyGeneration: fixture.frameVector.custodyGeneration,
    });
    expect(opened.ok).toBe(true);
    if (opened.ok)
      expect(opened.plaintextCommitmentHex).toBe(
        fixture.frameVector.plaintextCommitmentHex,
      );
    for (const mutation of fixture.frameMutations) {
      const result = await openFrame(mutation);
      expect(result).toEqual({ ok: false, error: mutation.expectedError });
    }
  });
});
