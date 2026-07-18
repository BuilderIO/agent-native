import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { ancV1BytesToHex, ancV1HexToBytes } from "./canonical.js";
import {
  ControlLogVerificationError,
  type ControlLogState,
  controlLogMemberSchema,
  controlLogStateSchema,
  decodeSignedControlLogEntry,
  encodeControlLogInnerEnvelope,
  encodeSignedControlLogEntry,
  encodeUnsignedControlLogEntry,
  verifyAndReduceControlLogEntry,
} from "./control-log.js";
import {
  ANC_V1_NATIVE_CONTROL_LOG_CORPUS_SCHEMA,
  ANC_V1_NATIVE_CONTROL_LOG_GENERATOR,
  ANC_V1_NATIVE_CONTROL_LOG_SOURCE_PATHS,
  buildAncV1NativeControlLogVectors,
} from "./native-control-log-vectors.js";
import { ancV1Hash, ancV1VerifyDetached } from "./portable-crypto.js";
import { e2eeDomainSeparationPrefix } from "./suite.js";

const CORE_COMMIT = "fd8c9800abbda048b21796a0953f449d1cc100ce";
const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const FIXTURE_URL = new URL(
  "./fixtures/anc-v1-native-control-log-vectors.json",
  import.meta.url,
);
const hex = z.string().regex(/^(?:[0-9a-f]{2})+$/);
const hashHex = z.string().regex(/^[0-9a-f]{64}$/);

const sourceAnchorSchema = z
  .object({
    path: z.enum(ANC_V1_NATIVE_CONTROL_LOG_SOURCE_PATHS),
    sha256: hashHex,
  })
  .strict();
const domainSchema = z
  .object({
    operation: z.enum(["signature", "entry_hash", "membership_hash"]),
    tag: z.literal("log-entry"),
    escaped: z.literal("anc/v1/log-entry\\u0000"),
    utf8Hex: hex,
  })
  .strict();
const stepSchema = z
  .object({
    name: z.enum([
      "genesis",
      "add_device",
      "add_broker",
      "broker_continuity",
      "remove_broker",
      "add_broker_replacement_candidate",
      "broker_replacement",
      "remove_device",
      "recovery",
      "continuity",
      "ceremony_abort",
      "grant_revocation",
    ]),
    expected: z.literal("accept"),
    sequence: z.number().int().nonnegative(),
    innerType: z.enum([
      "membership_commit",
      "continuity_checkpoint",
      "ceremony_abort",
      "grant_revocation",
    ]),
    ceremonyKind: z.string().nullable(),
    signerEndpointId: z.string(),
    signerPublicKeyHex: hashHex,
    innerHex: hex,
    unsignedHex: hex,
    signatureHex: z.string().regex(/^[0-9a-f]{128}$/),
    outerHex: hex,
    entryHashHex: hashHex,
    membershipHashHex: hashHex,
    expectedState: controlLogStateSchema,
  })
  .strict();
const errorSchema = z.enum([
  "invalid_entry",
  "invalid_signature",
  "invalid_genesis",
  "invalid_transition",
  "unauthorized_signer",
  "candidate_self_enrollment",
  "rollback",
  "gap",
  "fork",
  "stale_head",
  "future_head",
  "genesis_authorization_required",
  "recovery_authorization_required",
  "recovery_wrap_rotation_required",
  "ceremony_abort_authorization_required",
  "grant_revocation_authorization_required",
]);
const authorizationSchema = z
  .object({
    genesis: z.boolean(),
    recovery: z.boolean(),
    recoveryWrapRotation: z.boolean(),
    ceremonyAbort: z.boolean(),
    grantRevocation: z.boolean(),
  })
  .strict();
const stateVectorSchema = z
  .object({ ref: z.string().min(1), state: controlLogStateSchema.nullable() })
  .strict();
const caseSchema = z
  .object({
    name: z.string().min(1),
    matrix: z.enum([
      "stateful",
      "boundary",
      "authorization",
      "transition",
      "wire",
    ]),
    priorStateRef: z.string().min(1),
    entryHex: hex,
    expectedStatus: z.enum(["reject", "accept", "idempotent"]),
    expectedError: errorSchema.nullable(),
    expectedState: controlLogStateSchema.nullable(),
    expectedEntryHashHex: hashHex.nullable(),
    authorization: authorizationSchema,
    canonicalErrorCategory: z.string().min(1).nullable(),
  })
  .strict();
const corpusSchema = z
  .object({
    schema: z.literal(ANC_V1_NATIVE_CONTROL_LOG_CORPUS_SCHEMA),
    suite: z.literal("anc/v1"),
    encoding: z.literal("hex"),
    generator: z.literal(ANC_V1_NATIVE_CONTROL_LOG_GENERATOR),
    protocolBaseCommit: z.string().regex(/^[0-9a-f]{40}$/),
    sourceAnchors: z
      .array(sourceAnchorSchema)
      .length(ANC_V1_NATIVE_CONTROL_LOG_SOURCE_PATHS.length),
    domains: z.array(domainSchema).length(3),
    identities: z
      .object({
        owner: controlLogMemberSchema,
        device: controlLogMemberSchema,
        broker: controlLogMemberSchema,
        brokerReplacementCandidate: controlLogMemberSchema,
        brokerReplacement: controlLogMemberSchema,
        recovered: controlLogMemberSchema,
      })
      .strict(),
    states: z.array(stateVectorSchema).min(12),
    steps: z.array(stepSchema).length(12),
    cases: z.array(caseSchema).min(101),
  })
  .strict();

async function sourceProvenance() {
  return {
    protocolBaseCommit: CORE_COMMIT,
    sources: await Promise.all(
      ANC_V1_NATIVE_CONTROL_LOG_SOURCE_PATHS.map(async (path) => ({
        path,
        sha256: createHash("sha256")
          .update(await readFile(`${REPO_ROOT}${path}`))
          .digest("hex"),
      })),
    ),
  };
}

async function readCorpus() {
  return corpusSchema.parse(JSON.parse(await readFile(FIXTURE_URL, "utf8")));
}

describe("anc/v1 native control-log parity corpus", () => {
  it("is a strict, generated artifact anchored to the frozen Core sources", async () => {
    const corpus = await readCorpus();
    const provenance = await sourceProvenance();
    expect(corpus.protocolBaseCommit).toBe(provenance.protocolBaseCommit);
    expect(corpus.sourceAnchors).toEqual(provenance.sources);
    expect(corpus).toEqual(await buildAncV1NativeControlLogVectors(provenance));
    expect(corpusSchema.safeParse({ ...corpus, unknown: true }).success).toBe(
      false,
    );
    expect(
      corpusSchema.safeParse({
        ...corpus,
        steps: [
          { ...corpus.steps[0], unknown: true },
          ...corpus.steps.slice(1),
        ],
      }).success,
    ).toBe(false);
  });

  it("makes every domain separator and NUL byte unambiguous", async () => {
    const corpus = await readCorpus();
    const expectedHex = ancV1BytesToHex(
      e2eeDomainSeparationPrefix("log-entry"),
    );
    expect(corpus.domains.map((domain) => domain.operation)).toEqual([
      "signature",
      "entry_hash",
      "membership_hash",
    ]);
    for (const domain of corpus.domains) {
      expect(domain.escaped).toBe("anc/v1/log-entry\\u0000");
      expect(domain.escaped).not.toContain("\0");
      expect(domain.utf8Hex).toBe(expectedHex);
      expect(new TextDecoder().decode(ancV1HexToBytes(domain.utf8Hex))).toBe(
        "anc/v1/log-entry\0",
      );
    }
  });

  it("replays every exact byte, detached signature, hash, and full state", async () => {
    const corpus = await readCorpus();
    let state: ControlLogState | null = null;
    for (const step of corpus.steps) {
      const outer = ancV1HexToBytes(step.outerHex);
      const entry = decodeSignedControlLogEntry(outer);
      const { signature, ...unsigned } = entry;
      expect(entry.sequence).toBe(step.sequence);
      expect(entry.signerEndpointId).toBe(step.signerEndpointId);
      expect(ancV1BytesToHex(encodeSignedControlLogEntry(entry))).toBe(
        step.outerHex,
      );
      expect(ancV1BytesToHex(encodeUnsignedControlLogEntry(unsigned))).toBe(
        step.unsignedHex,
      );
      expect(
        ancV1BytesToHex(encodeControlLogInnerEnvelope(entry.innerEnvelope)),
      ).toBe(step.innerHex);
      expect(signature).toBe(step.signatureHex);
      expect(
        await ancV1VerifyDetached(
          "log-entry",
          ancV1HexToBytes(step.unsignedHex),
          ancV1HexToBytes(step.signatureHex),
          ancV1HexToBytes(step.signerPublicKeyHex),
        ),
      ).toBe(true);
      expect(ancV1BytesToHex(await ancV1Hash("log-entry", outer))).toBe(
        step.entryHashHex,
      );

      const reduced = await verifyAndReduceControlLogEntry({
        current: state,
        entry: outer,
        verifyGenesisAuthorization: async () => true,
        verifyRecoveryAuthorization: async () => true,
        verifyRecoveryWrapRotation: async () => true,
        verifyCeremonyAbortAuthorization: async () => true,
        verifyGrantRevocationAuthorization: async () => true,
      });
      expect(reduced.entryHash).toBe(step.entryHashHex);
      expect(reduced.state.membershipHash).toBe(step.membershipHashHex);
      expect(reduced.state).toEqual(step.expectedState);
      if (entry.innerEnvelope.type === "membership_commit") {
        expect(
          ancV1BytesToHex(
            await ancV1Hash(
              "log-entry",
              encodeControlLogInnerEnvelope(entry.innerEnvelope),
            ),
          ),
        ).toBe(step.membershipHashHex);
      } else {
        expect(step.membershipHashHex).toBe(state!.membershipHash);
      }
      state = reduced.state;
    }
  });

  it("replays every referenced-state case with its typed status and error", async () => {
    const corpus = await readCorpus();
    const states = new Map(
      corpus.states.map((vector) => [vector.ref, vector.state]),
    );
    expect(states.size).toBe(corpus.states.length);
    expect(states.get("none")).toBeNull();
    expect(
      new Set(corpus.cases.map((fixtureCase) => fixtureCase.name)).size,
    ).toBe(corpus.cases.length);

    for (const fixtureCase of corpus.cases) {
      expect(states.has(fixtureCase.priorStateRef)).toBe(true);
      const replay = verifyAndReduceControlLogEntry({
        current: states.get(fixtureCase.priorStateRef) ?? null,
        entry: ancV1HexToBytes(fixtureCase.entryHex),
        verifyGenesisAuthorization: fixtureCase.authorization.genesis
          ? async () => true
          : undefined,
        verifyRecoveryAuthorization: fixtureCase.authorization.recovery
          ? async () => true
          : undefined,
        verifyRecoveryWrapRotation: fixtureCase.authorization
          .recoveryWrapRotation
          ? async () => true
          : undefined,
        verifyCeremonyAbortAuthorization: fixtureCase.authorization
          .ceremonyAbort
          ? async () => true
          : undefined,
        verifyGrantRevocationAuthorization: fixtureCase.authorization
          .grantRevocation
          ? async () => true
          : undefined,
      });
      if (fixtureCase.expectedStatus === "reject") {
        expect(fixtureCase.expectedState).toBeNull();
        expect(fixtureCase.expectedEntryHashHex).toBeNull();
        try {
          await replay;
          throw new Error(`${fixtureCase.name} unexpectedly verified`);
        } catch (error) {
          expect(error).toBeInstanceOf(ControlLogVerificationError);
          expect((error as ControlLogVerificationError).code).toBe(
            fixtureCase.expectedError,
          );
        }
      } else {
        expect(fixtureCase.expectedError).toBeNull();
        const reduced = await replay;
        expect(reduced.idempotent).toBe(
          fixtureCase.expectedStatus === "idempotent",
        );
        expect(reduced.state).toEqual(fixtureCase.expectedState);
        expect(reduced.entryHash).toBe(fixtureCase.expectedEntryHashHex);
      }
    }
  });

  it("covers every frozen red-team matrix and boundary", async () => {
    const corpus = await readCorpus();
    const byMatrix = Object.fromEntries(
      ["stateful", "boundary", "authorization", "transition", "wire"].map(
        (matrix) => [
          matrix,
          corpus.cases.filter((fixtureCase) => fixtureCase.matrix === matrix)
            .length,
        ],
      ),
    );
    expect(byMatrix).toEqual({
      stateful: 8,
      boundary: 12,
      authorization: 9,
      transition: 32,
      wire: 40,
    });
    expect(corpus.steps.map((step) => step.name)).toEqual([
      "genesis",
      "add_device",
      "add_broker",
      "broker_continuity",
      "remove_broker",
      "add_broker_replacement_candidate",
      "broker_replacement",
      "remove_device",
      "recovery",
      "continuity",
      "ceremony_abort",
      "grant_revocation",
    ]);
    expect(
      corpus.steps.find((step) => step.name === "broker_continuity")!
        .expectedState.freshnessMode,
    ).toBe("eventual_fork_detection");
  });
});
