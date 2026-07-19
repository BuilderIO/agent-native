import {
  ancV1BytesToHex,
  ancV1EnrollmentChallengeConsumptionKey,
  ancV1Hash,
  ancV1LifecycleIdToHex,
  decodeAncV1EndpointEnrollmentOffer,
  decodeAncV1EnrollmentAuthorization,
  decodeAncV1EnrollmentChallenge,
  encodeAncV1EnrollmentSasDecision,
  decodeSignedControlLogEntry,
  encodeAncV1EndpointEnrollmentOffer,
  encodeAncV1EnrollmentAuthorization,
  encodeAncV1EnrollmentChallenge,
  hashAncV1EndpointEnrollmentOffer,
  verifyAncV1EnrollmentAuthorization,
  verifyAncV1EnrollmentChallenge,
  verifyAncV1EnrollmentSasDecision,
  verifyAncV1EnrollmentSasDecisionSignature,
  type ControlLogState,
} from "@agent-native/core/e2ee";
import { and, eq } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import { privateVaultControlLogService } from "./private-vault-control-log-runtime.js";
import type { PrivateVaultControlLogScope } from "./private-vault-control-log.js";

const OFFER_MAX_BYTES = 64 * 1024;
const CHALLENGE_MAX_BYTES = 64 * 1024;
const SAS_DECISION_MAX_BYTES = 2 * 1024;
const AUTHORIZATION_MAX_BYTES = 256 * 1024;

type EnrollmentPhase =
  | "offer"
  | "challenge"
  | "confirmed"
  | "rejected"
  | "committed";

export class PrivateVaultEnrollmentError extends Error {
  constructor(
    readonly code:
      | "invalid_request"
      | "not_found"
      | "conflict"
      | "expired"
      | "unavailable",
  ) {
    super("Private Vault enrollment unavailable");
    this.name = "PrivateVaultEnrollmentError";
  }
}

type EnrollmentRow =
  typeof schema.contentEncryptedVaultEnrollmentCeremonies.$inferSelect;

export interface PrivateVaultEnrollmentStatus {
  phase: EnrollmentPhase;
  offer: Uint8Array;
  challenge: Uint8Array | null;
  sasDecision: Uint8Array | null;
  authorization: Uint8Array | null;
  controlEntryId: string | null;
  controlEntryHash: string | null;
  expiresAt: string;
}

function bounded(value: Uint8Array, maximum: number): Uint8Array {
  if (
    !(value instanceof Uint8Array) ||
    value.byteLength < 1 ||
    value.byteLength > maximum
  ) {
    throw new PrivateVaultEnrollmentError("invalid_request");
  }
  return value.slice();
}

function encode(value: Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

function decode(value: string | null, maximum: number): Uint8Array | null {
  if (value === null || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const bytes = Uint8Array.from(Buffer.from(value, "base64url"));
  if (bytes.byteLength < 1 || bytes.byteLength > maximum) return null;
  if (Buffer.from(bytes).toString("base64url") !== value) return null;
  return bytes;
}

function exact(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength &&
    left.every((byte, index) => byte === right[index])
  );
}

function scoped(scope: PrivateVaultControlLogScope, offerHash: string) {
  const table = schema.contentEncryptedVaultEnrollmentCeremonies;
  return and(
    eq(table.offerHash, offerHash),
    eq(table.ownerEmail, scope.ownerEmail.trim().toLowerCase()),
    eq(table.orgId, scope.orgId.trim()),
    eq(table.vaultId, scope.vaultId),
  );
}

async function parseRow(
  row: EnrollmentRow,
): Promise<PrivateVaultEnrollmentStatus> {
  const offer = decode(row.offerBytesBase64url, OFFER_MAX_BYTES);
  const challenge = decode(row.challengeBytesBase64url, CHALLENGE_MAX_BYTES);
  const sasDecision = decode(
    row.sasDecisionBytesBase64url,
    SAS_DECISION_MAX_BYTES,
  );
  const authorization = decode(
    row.authorizationBytesBase64url,
    AUTHORIZATION_MAX_BYTES,
  );
  if (
    !offer ||
    !(
      ["offer", "challenge", "confirmed", "rejected", "committed"] as const
    ).includes(row.phase as EnrollmentPhase) ||
    (row.phase === "offer" &&
      (challenge !== null ||
        sasDecision !== null ||
        authorization !== null ||
        row.controlEntryId !== null ||
        row.controlEntryHash !== null ||
        row.consumedAt !== null)) ||
    (row.phase === "challenge" &&
      (challenge === null ||
        sasDecision !== null ||
        authorization !== null ||
        row.controlEntryId !== null ||
        row.controlEntryHash !== null ||
        row.consumedAt !== null)) ||
    ((row.phase === "confirmed" || row.phase === "rejected") &&
      (challenge === null ||
        sasDecision === null ||
        authorization !== null ||
        row.controlEntryId !== null ||
        row.controlEntryHash !== null ||
        row.consumedAt !== null)) ||
    (row.phase === "committed" &&
      (challenge === null ||
        sasDecision === null ||
        authorization === null ||
        row.controlEntryId === null ||
        row.controlEntryHash === null ||
        row.consumedAt === null))
  ) {
    throw new PrivateVaultEnrollmentError("unavailable");
  }
  try {
    const vaultId = Uint8Array.from(Buffer.from(row.vaultId, "hex"));
    if (vaultId.byteLength !== 16) throw new Error();
    const decodedOffer = decodeAncV1EndpointEnrollmentOffer(offer, {
      expectedVaultId: vaultId,
    });
    if (
      !exact(encodeAncV1EndpointEnrollmentOffer(decodedOffer), offer) ||
      ancV1BytesToHex(
        await hashAncV1EndpointEnrollmentOffer(offer, {
          expectedVaultId: vaultId,
        }),
      ) !== row.offerHash ||
      ancV1LifecycleIdToHex(decodedOffer.endpointId) !==
        row.candidateEndpointId ||
      ancV1LifecycleIdToHex(decodedOffer.ceremonyId) !== row.ceremonyId ||
      decodedOffer.membershipRole !== row.targetRole ||
      new Date(decodedOffer.expiresAt * 1000).toISOString() !== row.expiresAt
    ) {
      throw new Error();
    }
    let decodedChallenge = null;
    if (challenge !== null) {
      decodedChallenge = decodeAncV1EnrollmentChallenge(challenge, {
        expectedVaultId: vaultId,
      });
      if (
        !exact(encodeAncV1EnrollmentChallenge(decodedChallenge), challenge) ||
        ancV1EnrollmentChallengeConsumptionKey(
          decodedChallenge.envelopeId,
          decodedChallenge.challengeNonce,
        ) !== row.challengeKey
      ) {
        throw new Error();
      }
    }
    if (sasDecision !== null) {
      if (decodedChallenge === null) throw new Error();
      const decodedDecision = await verifyAncV1EnrollmentSasDecisionSignature(
        sasDecision,
        {
          expectedVaultId: vaultId,
          candidateSigningPublicKey: decodedOffer.signingPublicKey,
        },
      );
      if (
        !exact(
          encodeAncV1EnrollmentSasDecision(decodedDecision),
          sasDecision,
        ) ||
        ancV1BytesToHex(decodedDecision.offerHash) !== row.offerHash ||
        !exact(
          decodedDecision.challengeHash,
          await ancV1Hash("enrollment-challenge", challenge!),
        ) ||
        !exact(
          decodedDecision.sasTranscriptHash,
          decodedChallenge.sasTranscriptHash,
        ) ||
        ancV1LifecycleIdToHex(decodedDecision.candidateEndpointId) !==
          row.candidateEndpointId ||
        ancV1LifecycleIdToHex(decodedDecision.ceremonyId) !== row.ceremonyId ||
        ancV1LifecycleIdToHex(decodedDecision.envelopeId) !==
          row.sasDecisionId ||
        ancV1BytesToHex(
          await ancV1Hash("enrollment-sas-decision", sasDecision),
        ) !== row.sasDecisionHash ||
        (row.phase === "rejected") !== (decodedDecision.decision === "mismatch")
      ) {
        throw new Error();
      }
    }
    if (authorization !== null) {
      const decodedAuthorization = decodeAncV1EnrollmentAuthorization(
        authorization,
        { expectedVaultId: vaultId },
      );
      const signedCommit = decodeSignedControlLogEntry(
        decodedAuthorization.signedMembershipCommit,
      );
      if (
        !exact(
          encodeAncV1EnrollmentAuthorization(decodedAuthorization),
          authorization,
        ) ||
        ancV1LifecycleIdToHex(decodedAuthorization.envelopeId) !==
          row.authorizationId ||
        signedCommit.envelopeId !== row.controlEntryId ||
        ancV1BytesToHex(
          await ancV1Hash(
            "log-entry",
            decodedAuthorization.signedMembershipCommit,
          ),
        ) !== row.controlEntryHash
      ) {
        throw new Error();
      }
    }
  } catch {
    throw new PrivateVaultEnrollmentError("unavailable");
  }
  return {
    phase: row.phase as EnrollmentPhase,
    offer,
    challenge,
    sasDecision,
    authorization,
    controlEntryId: row.controlEntryId,
    controlEntryHash: row.controlEntryHash,
    expiresAt: row.expiresAt,
  };
}

async function currentState(
  scope: PrivateVaultControlLogScope,
): Promise<ControlLogState> {
  const state = await privateVaultControlLogService.loadVerifiedState(scope);
  if (!state) throw new PrivateVaultEnrollmentError("not_found");
  return state;
}

export async function publishPrivateVaultEnrollmentOffer(input: {
  scope: PrivateVaultControlLogScope;
  offer: Uint8Array;
  now?: Date;
}): Promise<PrivateVaultEnrollmentStatus> {
  const now = input.now ?? new Date();
  const offerBytes = bounded(input.offer, OFFER_MAX_BYTES);
  const vaultId = Uint8Array.from(Buffer.from(input.scope.vaultId, "hex"));
  if (vaultId.byteLength !== 16) {
    throw new PrivateVaultEnrollmentError("invalid_request");
  }
  let offer;
  try {
    offer = decodeAncV1EndpointEnrollmentOffer(offerBytes, {
      expectedVaultId: vaultId,
    });
    if (
      !exact(encodeAncV1EndpointEnrollmentOffer(offer), offerBytes) ||
      offer.createdAt > now.getTime() / 1000 ||
      offer.expiresAt <= now.getTime() / 1000
    ) {
      throw new Error();
    }
  } catch {
    throw new PrivateVaultEnrollmentError("invalid_request");
  }
  const state = await currentState(input.scope);
  const candidateEndpointId = ancV1LifecycleIdToHex(offer.endpointId);
  if (
    state.activeMembers.some(
      (member) => member.endpointId === candidateEndpointId,
    ) ||
    state.removedEndpointIds.includes(candidateEndpointId) ||
    (offer.membershipRole === "broker" &&
      state.activeMembers.some((member) => member.role === "broker"))
  ) {
    throw new PrivateVaultEnrollmentError("conflict");
  }
  const offerHash = ancV1BytesToHex(
    await hashAncV1EndpointEnrollmentOffer(offerBytes, {
      expectedVaultId: vaultId,
    }),
  );
  const row = {
    offerHash,
    ownerEmail: input.scope.ownerEmail.trim().toLowerCase(),
    orgId: input.scope.orgId.trim(),
    vaultId: input.scope.vaultId,
    version: 1,
    candidateEndpointId,
    targetRole: offer.membershipRole,
    ceremonyId: ancV1LifecycleIdToHex(offer.ceremonyId),
    phase: "offer",
    offerBytesBase64url: encode(offerBytes),
    expiresAt: new Date(offer.expiresAt * 1000).toISOString(),
    updatedAt: now.toISOString(),
  } as const;
  try {
    await getDb()
      .insert(schema.contentEncryptedVaultEnrollmentCeremonies)
      .values(row)
      .onConflictDoNothing();
    const [stored] = await getDb()
      .select()
      .from(schema.contentEncryptedVaultEnrollmentCeremonies)
      .where(scoped(input.scope, offerHash))
      .limit(1);
    if (!stored || stored.offerBytesBase64url !== row.offerBytesBase64url) {
      throw new PrivateVaultEnrollmentError("conflict");
    }
    return await parseRow(stored);
  } catch (error) {
    if (error instanceof PrivateVaultEnrollmentError) throw error;
    throw new PrivateVaultEnrollmentError("conflict");
  }
}

export async function publishPrivateVaultEnrollmentChallenge(input: {
  scope: PrivateVaultControlLogScope;
  offerHash: string;
  challenge: Uint8Array;
  now?: Date;
}): Promise<PrivateVaultEnrollmentStatus> {
  const now = input.now ?? new Date();
  const challengeBytes = bounded(input.challenge, CHALLENGE_MAX_BYTES);
  const [row] = await getDb()
    .select()
    .from(schema.contentEncryptedVaultEnrollmentCeremonies)
    .where(scoped(input.scope, input.offerHash))
    .limit(1);
  if (!row) throw new PrivateVaultEnrollmentError("not_found");
  const status = await parseRow(row);
  if (status.phase !== "offer") {
    if (status.challenge && exact(status.challenge, challengeBytes))
      return status;
    throw new PrivateVaultEnrollmentError("conflict");
  }
  if (Date.parse(row.expiresAt) <= now.getTime()) {
    throw new PrivateVaultEnrollmentError("expired");
  }
  const state = await currentState(input.scope);
  let challenge;
  try {
    const verified = await verifyAncV1EnrollmentChallenge(challengeBytes, {
      encodedOffer: status.offer,
      verifiedControlState: state,
      now: Math.floor(now.getTime() / 1000),
    });
    challenge = verified.challenge;
    if (!exact(encodeAncV1EnrollmentChallenge(challenge), challengeBytes)) {
      throw new Error();
    }
  } catch {
    throw new PrivateVaultEnrollmentError("invalid_request");
  }
  const challengeKey = ancV1EnrollmentChallengeConsumptionKey(
    challenge.envelopeId,
    challenge.challengeNonce,
  );
  const [updated] = await getDb()
    .update(schema.contentEncryptedVaultEnrollmentCeremonies)
    .set({
      phase: "challenge",
      challengeKey,
      challengeBytesBase64url: encode(challengeBytes),
      updatedAt: now.toISOString(),
    })
    .where(
      and(
        scoped(input.scope, input.offerHash),
        eq(schema.contentEncryptedVaultEnrollmentCeremonies.phase, "offer"),
      ),
    )
    .returning();
  if (!updated) throw new PrivateVaultEnrollmentError("conflict");
  return parseRow(updated);
}

export async function commitPrivateVaultEnrollmentAuthorization(input: {
  scope: PrivateVaultControlLogScope;
  offerHash: string;
  authorization: Uint8Array;
  now?: Date;
}): Promise<PrivateVaultEnrollmentStatus> {
  const now = input.now ?? new Date();
  const authorizationBytes = bounded(
    input.authorization,
    AUTHORIZATION_MAX_BYTES,
  );
  const [row] = await getDb()
    .select()
    .from(schema.contentEncryptedVaultEnrollmentCeremonies)
    .where(scoped(input.scope, input.offerHash))
    .limit(1);
  if (!row) throw new PrivateVaultEnrollmentError("not_found");
  const status = await parseRow(row);
  if (status.phase === "committed") {
    if (
      status.authorization &&
      exact(status.authorization, authorizationBytes)
    ) {
      return status;
    }
    throw new PrivateVaultEnrollmentError("conflict");
  }
  if (
    status.phase !== "confirmed" ||
    !status.challenge ||
    !status.sasDecision ||
    Date.parse(row.expiresAt) <= now.getTime()
  ) {
    throw new PrivateVaultEnrollmentError("expired");
  }
  const state = await currentState(input.scope);
  let verified;
  try {
    verified = await verifyAncV1EnrollmentAuthorization(authorizationBytes, {
      encodedOffer: status.offer,
      encodedChallenge: status.challenge,
      verifiedControlState: state,
      now: Math.floor(now.getTime() / 1000),
    });
    if (
      !exact(
        encodeAncV1EnrollmentAuthorization(verified.authorization),
        authorizationBytes,
      )
    ) {
      throw new Error();
    }
  } catch {
    throw new PrivateVaultEnrollmentError("invalid_request");
  }
  const signedCommit = verified.authorization.signedMembershipCommit;
  const authorizationId = ancV1LifecycleIdToHex(
    verified.authorization.envelopeId,
  );
  try {
    await privateVaultControlLogService.append(input.scope, {
      entryBytes: signedCommit,
      expectedHead: {
        sequence: verified.authorization.previousControlSequence,
        hash: ancV1BytesToHex(verified.authorization.previousControlHeadHash),
      },
      onVerifiedAppend: async (append) => {
        const [updated] = await append.tx
          .update(schema.contentEncryptedVaultEnrollmentCeremonies)
          .set({
            phase: "committed",
            authorizationId,
            authorizationBytesBase64url: encode(authorizationBytes),
            controlEntryId: append.entry.envelopeId,
            controlEntryHash: append.entryHash,
            consumedAt: append.serverReceivedAt,
            updatedAt: append.serverReceivedAt,
          })
          .where(
            and(
              scoped(input.scope, input.offerHash),
              eq(
                schema.contentEncryptedVaultEnrollmentCeremonies.phase,
                "confirmed",
              ),
            ),
          )
          .returning({
            offerHash:
              schema.contentEncryptedVaultEnrollmentCeremonies.offerHash,
          });
        if (!updated) throw new PrivateVaultEnrollmentError("conflict");
      },
    });
  } catch (error) {
    if (error instanceof PrivateVaultEnrollmentError) throw error;
    throw new PrivateVaultEnrollmentError("conflict");
  }
  return readPrivateVaultEnrollmentStatus({
    scope: input.scope,
    offerHash: input.offerHash,
  });
}

export async function publishPrivateVaultEnrollmentSasDecision(input: {
  scope: PrivateVaultControlLogScope;
  offerHash: string;
  sasDecision: Uint8Array;
  now?: Date;
}): Promise<PrivateVaultEnrollmentStatus> {
  const now = input.now ?? new Date();
  const decisionBytes = bounded(input.sasDecision, SAS_DECISION_MAX_BYTES);
  const [row] = await getDb()
    .select()
    .from(schema.contentEncryptedVaultEnrollmentCeremonies)
    .where(scoped(input.scope, input.offerHash))
    .limit(1);
  if (!row) throw new PrivateVaultEnrollmentError("not_found");
  const status = await parseRow(row);
  if (status.phase === "confirmed" || status.phase === "rejected") {
    if (status.sasDecision && exact(status.sasDecision, decisionBytes)) {
      return status;
    }
    throw new PrivateVaultEnrollmentError("conflict");
  }
  if (
    status.phase !== "challenge" ||
    !status.challenge ||
    Date.parse(row.expiresAt) <= now.getTime()
  ) {
    throw new PrivateVaultEnrollmentError("expired");
  }
  const state = await currentState(input.scope);
  let verified;
  try {
    verified = await verifyAncV1EnrollmentSasDecision(decisionBytes, {
      encodedOffer: status.offer,
      encodedChallenge: status.challenge,
      verifiedControlState: state,
      now: Math.floor(now.getTime() / 1000),
    });
    if (
      !exact(encodeAncV1EnrollmentSasDecision(verified.receipt), decisionBytes)
    ) {
      throw new Error();
    }
  } catch {
    throw new PrivateVaultEnrollmentError("invalid_request");
  }
  const sasDecisionId = ancV1LifecycleIdToHex(verified.receipt.envelopeId);
  const sasDecisionHash = ancV1BytesToHex(
    await ancV1Hash("enrollment-sas-decision", decisionBytes),
  );
  const phase =
    verified.receipt.decision === "confirmed" ? "confirmed" : "rejected";
  const [updated] = await getDb()
    .update(schema.contentEncryptedVaultEnrollmentCeremonies)
    .set({
      phase,
      sasDecisionId,
      sasDecisionBytesBase64url: encode(decisionBytes),
      sasDecisionHash,
      updatedAt: now.toISOString(),
    })
    .where(
      and(
        scoped(input.scope, input.offerHash),
        eq(schema.contentEncryptedVaultEnrollmentCeremonies.phase, "challenge"),
      ),
    )
    .returning();
  if (!updated) throw new PrivateVaultEnrollmentError("conflict");
  return parseRow(updated);
}

export async function readPrivateVaultEnrollmentStatus(input: {
  scope: PrivateVaultControlLogScope;
  offerHash: string;
}): Promise<PrivateVaultEnrollmentStatus> {
  if (!/^[0-9a-f]{64}$/.test(input.offerHash)) {
    throw new PrivateVaultEnrollmentError("not_found");
  }
  const [row] = await getDb()
    .select()
    .from(schema.contentEncryptedVaultEnrollmentCeremonies)
    .where(scoped(input.scope, input.offerHash))
    .limit(1);
  if (!row) throw new PrivateVaultEnrollmentError("not_found");
  return parseRow(row);
}

export const privateVaultEnrollmentLimits = Object.freeze({
  offerBytes: OFFER_MAX_BYTES,
  challengeBytes: CHALLENGE_MAX_BYTES,
  sasDecisionBytes: SAS_DECISION_MAX_BYTES,
  authorizationBytes: AUTHORIZATION_MAX_BYTES,
});
