import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { table, text } from "@agent-native/core/db/schema";
import {
  ancV1BytesToHex,
  ancV1GenesisAccountAdmissionCandidateHashInput,
  ancV1GenesisAccountAdmissionChallengeAuthenticationInput,
  ancV1Hash,
  ancV1HexToBytes,
  decodeAncV1GenesisAccountAdmissionCandidate,
  decodeAncV1GenesisAccountAdmissionChallenge,
  decodeAncV1GenesisAccountAdmissionRequest,
  decodeAncV1GenesisAuthorization,
  decodeAncV1GenesisBootstrapTranscript,
  decodeAncV1GenesisRecoveryConfirmation,
  decodeSignedControlLogEntry,
  encodeAncV1GenesisAccountAdmissionChallenge,
  encodeAncV1GenesisAccountAdmissionReceipt,
  encodeAncV1GenesisBootstrapTranscript,
  createAncV1GenesisBootstrapTranscript,
  hashAncV1GenesisBootstrapTranscript,
  verifyAncV1GenesisAuthorization,
  verifyEndpointRequestProofWithIdentity,
  type AncV1GenesisAccountAdmissionChallengeUnsigned,
  type EndpointRequestProof,
} from "@agent-native/core/e2ee";
import { orgMembers } from "@agent-native/core/org";
import { putProtectedCiphertext } from "@agent-native/core/protected-ciphertext";
import { and, eq, isNull, lte, sql } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import type { PrivateVaultGenesisAccountScope } from "./private-vault-genesis-account-scope.js";

const betterAuthUsers = table("user", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
});

export const PRIVATE_VAULT_GENESIS_ADMISSION_PATH =
  "/api/private-vault/genesis/admit";
export const PRIVATE_VAULT_GENESIS_CHALLENGE_LIFETIME_MS = 5 * 60 * 1000;

export class PrivateVaultGenesisAdmissionError extends Error {
  constructor(readonly code: "invalid_request" | "conflict" | "unavailable") {
    super("Private Vault genesis admission failed");
    this.name = "PrivateVaultGenesisAdmissionError";
  }
}

export async function deleteExpiredPrivateVaultGenesisChallenges(
  now: string,
): Promise<number> {
  if (!Number.isFinite(Date.parse(now))) {
    throw new PrivateVaultGenesisAdmissionError("invalid_request");
  }
  const deleted = await getDb()
    .delete(schema.contentEncryptedVaultGenesisChallenges)
    .where(lte(schema.contentEncryptedVaultGenesisChallenges.expiresAt, now))
    .returning({
      challengeId: schema.contentEncryptedVaultGenesisChallenges.challengeId,
    });
  return deleted.length;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return Buffer.from(left).equals(Buffer.from(right));
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function challengeKey(): Buffer {
  const encoded =
    process.env.CONTENT_PRIVATE_VAULT_GENESIS_CHALLENGE_SECRET?.trim() ?? "";
  if (!/^[0-9a-f]{64}$/.test(encoded)) {
    throw new PrivateVaultGenesisAdmissionError("unavailable");
  }
  return Buffer.from(encoded, "hex");
}

function authenticateChallenge(
  unsigned: AncV1GenesisAccountAdmissionChallengeUnsigned,
): Uint8Array {
  const key = challengeKey();
  try {
    return new Uint8Array(
      createHmac("sha256", key)
        .update(
          ancV1GenesisAccountAdmissionChallengeAuthenticationInput(unsigned),
        )
        .digest(),
    );
  } finally {
    key.fill(0);
  }
}

function validChallengeTag(input: {
  challenge: ReturnType<typeof decodeAncV1GenesisAccountAdmissionChallenge>;
}): boolean {
  const { authenticationTag, ...unsigned } = input.challenge;
  const expected = authenticateChallenge(unsigned);
  return (
    authenticationTag.byteLength === expected.byteLength &&
    timingSafeEqual(Buffer.from(authenticationTag), Buffer.from(expected))
  );
}

async function verifiedCandidate(candidateBytes: Uint8Array) {
  try {
    const candidate =
      decodeAncV1GenesisAccountAdmissionCandidate(candidateBytes);
    const bootstrap = decodeAncV1GenesisBootstrapTranscript(
      candidate.bootstrapTranscript,
    );
    const authorization = decodeAncV1GenesisAuthorization(
      candidate.authorization,
      { expectedVaultId: bootstrap.vaultId },
    );
    const entry = decodeSignedControlLogEntry(
      authorization.signedGenesisCommit,
    );
    if (entry.innerEnvelope.type !== "membership_commit") {
      throw new Error("not a genesis membership commit");
    }
    const confirmation = decodeAncV1GenesisRecoveryConfirmation(
      candidate.recoveryConfirmation,
      { expectedVaultId: bootstrap.vaultId },
    );
    const rebuiltBootstrap = await createAncV1GenesisBootstrapTranscript({
      vaultId: bootstrap.vaultId,
      ceremonyId: bootstrap.ceremonyId,
      endpointId: bootstrap.endpointId,
      endpointSigningPublicKey: bootstrap.endpointSigningPublicKey,
      endpointKeyAgreementPublicKey: bootstrap.endpointKeyAgreementPublicKey,
      enrollmentRef: bootstrap.enrollmentRef,
      recoveryConfirmation: candidate.recoveryConfirmation,
    });
    const member =
      entry.innerEnvelope.activeMembers.length === 1
        ? entry.innerEnvelope.activeMembers[0]
        : undefined;
    const valid =
      equalBytes(
        encodeAncV1GenesisBootstrapTranscript(rebuiltBootstrap),
        candidate.bootstrapTranscript,
      ) &&
      equalBytes(bootstrap.ceremonyId, confirmation.ceremonyId) &&
      equalBytes(bootstrap.endpointId, confirmation.endpointId) &&
      member?.endpointId === ancV1BytesToHex(bootstrap.endpointId) &&
      member.signingPublicKey ===
        ancV1BytesToHex(bootstrap.endpointSigningPublicKey) &&
      member.keyAgreementPublicKey ===
        ancV1BytesToHex(bootstrap.endpointKeyAgreementPublicKey) &&
      member.enrollmentRef === ancV1BytesToHex(bootstrap.enrollmentRef) &&
      member.enrollmentRef === ancV1BytesToHex(authorization.envelopeId) &&
      (await verifyAncV1GenesisAuthorization(
        candidate.authorization,
        candidate.recoveryConfirmation,
        { entry, commit: entry.innerEnvelope },
      ));
    if (!valid || !member)
      throw new Error("genesis evidence did not cross-bind");

    return {
      vaultId: entry.vaultId,
      controlEntryId: entry.envelopeId,
      controlEntryHash: ancV1BytesToHex(
        await ancV1Hash("log-entry", authorization.signedGenesisCommit),
      ),
      signerEndpointId: entry.signerEndpointId,
      signingPublicKey: Uint8Array.from(
        ancV1HexToBytes(member.signingPublicKey),
      ),
      candidateHash: sha256(
        ancV1GenesisAccountAdmissionCandidateHashInput(candidateBytes),
      ),
      bootstrapTranscriptHash: ancV1BytesToHex(
        await hashAncV1GenesisBootstrapTranscript(
          candidate.bootstrapTranscript,
          { expectedVaultId: bootstrap.vaultId },
        ),
      ),
    };
  } catch (error) {
    if (error instanceof PrivateVaultGenesisAdmissionError) throw error;
    throw new PrivateVaultGenesisAdmissionError("invalid_request");
  }
}

function exactVaultRow(
  row: {
    vaultId: string;
    ownerEmail: string;
    orgId: string;
    accountId: string;
    workspaceId: string;
    vaultState: string;
  },
  expected: {
    vaultId: string;
    ownerEmail: string;
    orgId: string;
    accountId: string;
    workspaceId: string;
  },
) {
  return (
    row.vaultId === expected.vaultId &&
    row.orgId === expected.orgId &&
    row.accountId === expected.accountId &&
    row.workspaceId === expected.workspaceId &&
    row.vaultState === "active"
  );
}

function exactAdmissionRow(
  row: {
    vaultId: string;
    ownerEmail: string;
    orgId: string;
    controlEntryId: string;
    controlEntryHash: string;
    signerEndpointId: string;
    candidateHash: string;
    bootstrapTranscriptHash: string;
  },
  expected: {
    vaultId: string;
    ownerEmail: string;
    orgId: string;
    controlEntryId: string;
    controlEntryHash: string;
    signerEndpointId: string;
    candidateHash: string;
    bootstrapTranscriptHash: string;
  },
) {
  return Object.keys(expected)
    .filter((key) => key !== "ownerEmail")
    .every(
      (key) =>
        row[key as keyof typeof row] === expected[key as keyof typeof expected],
    );
}

/** Issue a short-lived challenge for one fully verified public candidate. */
export async function issuePrivateVaultGenesisChallenge(input: {
  scope: PrivateVaultGenesisAccountScope;
  candidate: Uint8Array;
  now?: Date;
}): Promise<Uint8Array> {
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    throw new PrivateVaultGenesisAdmissionError("invalid_request");
  }
  const verified = await verifiedCandidate(input.candidate);
  const unsigned = {
    suite: "anc/v1",
    version: 1,
    type: "genesis-account-admission-challenge",
    challengeId: randomBytes(16).toString("hex"),
    accountId: input.scope.accountId,
    workspaceId: input.scope.workspaceId,
    candidateHash: verified.candidateHash,
    issuedAt: now.toISOString(),
    expiresAt: new Date(
      now.getTime() + PRIVATE_VAULT_GENESIS_CHALLENGE_LIFETIME_MS,
    ).toISOString(),
  } as const;
  const challenge = encodeAncV1GenesisAccountAdmissionChallenge({
    ...unsigned,
    authenticationTag: authenticateChallenge(unsigned),
  });
  try {
    await getDb()
      .insert(schema.contentEncryptedVaultGenesisChallenges)
      .values({
        challengeId: unsigned.challengeId,
        ownerEmail: input.scope.ownerEmail,
        orgId: input.scope.orgId,
        accountId: input.scope.accountId,
        workspaceId: input.scope.workspaceId,
        vaultId: verified.vaultId,
        candidateHash: verified.candidateHash,
        challengeHash: sha256(challenge),
        expiresAt: unsigned.expiresAt,
      });
  } catch {
    throw new PrivateVaultGenesisAdmissionError("unavailable");
  }
  return challenge;
}

/**
 * Atomically binds an endpoint-approved candidate to the authenticated account.
 * The proof is verified against the signing key inside the independently
 * authenticated candidate; the challenge is the durable replay fence.
 */
export async function admitPrivateVaultGenesis(input: {
  scope: PrivateVaultGenesisAccountScope;
  body: Uint8Array;
  proof: EndpointRequestProof;
  now?: Date;
}): Promise<Uint8Array> {
  const now = input.now ?? new Date();
  let request: ReturnType<typeof decodeAncV1GenesisAccountAdmissionRequest>;
  let challenge: ReturnType<typeof decodeAncV1GenesisAccountAdmissionChallenge>;
  try {
    request = decodeAncV1GenesisAccountAdmissionRequest(input.body);
    challenge = decodeAncV1GenesisAccountAdmissionChallenge(request.challenge);
  } catch {
    throw new PrivateVaultGenesisAdmissionError("invalid_request");
  }
  const candidate = await verifiedCandidate(request.candidate);
  const issuedAt = Date.parse(challenge.issuedAt);
  const expiresAt = Date.parse(challenge.expiresAt);
  if (
    !Number.isFinite(now.getTime()) ||
    challenge.accountId !== input.scope.accountId ||
    challenge.workspaceId !== input.scope.workspaceId ||
    challenge.candidateHash !== candidate.candidateHash ||
    issuedAt > now.getTime() + 30_000 ||
    now.getTime() >= expiresAt ||
    !validChallengeTag({ challenge })
  ) {
    throw new PrivateVaultGenesisAdmissionError("invalid_request");
  }

  try {
    await verifyEndpointRequestProofWithIdentity({
      proof: input.proof,
      expectedMethod: "POST",
      expectedPath: PRIVATE_VAULT_GENESIS_ADMISSION_PATH,
      body: input.body,
      now,
      resolveAuthorizedEndpoint: async ({ vaultId, endpointId }) =>
        vaultId === candidate.vaultId &&
        endpointId === candidate.signerEndpointId
          ? {
              vaultId,
              endpointId,
              state: "active" as const,
              signingPublicKey: candidate.signingPublicKey,
            }
          : null,
      // The account-bound, one-use challenge is claimed in the same transaction
      // as the immutable admission. Exact lost-response retries remain safe.
      claimNonce: async () => true,
    });
  } catch {
    throw new PrivateVaultGenesisAdmissionError("invalid_request");
  }

  const vaultValues = {
    vaultId: candidate.vaultId,
    ownerEmail: input.scope.ownerEmail,
    orgId: input.scope.orgId,
    accountId: input.scope.accountId,
    workspaceId: input.scope.workspaceId,
    vaultState: "active",
  } as const;
  const admissionValues = {
    vaultId: candidate.vaultId,
    ownerEmail: input.scope.ownerEmail,
    orgId: input.scope.orgId,
    controlEntryId: candidate.controlEntryId,
    controlEntryHash: candidate.controlEntryHash,
    signerEndpointId: candidate.signerEndpointId,
    candidateHash: candidate.candidateHash,
    bootstrapTranscriptHash: candidate.bootstrapTranscriptHash,
  } as const;
  const evidenceCoordinate = {
    kind: "control-evidence" as const,
    vaultId: candidate.vaultId,
    evidenceKind: "genesis" as const,
    evidenceHash: candidate.candidateHash,
  };

  try {
    await putProtectedCiphertext({
      coordinate: evidenceCoordinate,
      ciphertext: request.candidate,
      expectedByteLength: request.candidate.byteLength,
    });
  } catch {
    throw new PrivateVaultGenesisAdmissionError("unavailable");
  }

  try {
    await getDb().transaction(async (tx) => {
      const [liveAuthority] = await tx
        .select({ role: orgMembers.role })
        .from(betterAuthUsers)
        .innerJoin(
          orgMembers,
          sql`LOWER(${orgMembers.email}) = LOWER(${betterAuthUsers.email})`,
        )
        .where(
          and(
            eq(betterAuthUsers.id, input.scope.subjectId),
            sql`LOWER(${betterAuthUsers.email}) = ${input.scope.ownerEmail}`,
            eq(orgMembers.orgId, input.scope.orgId),
          ),
        )
        .limit(1);
      if (
        liveAuthority?.role !== "owner" &&
        liveAuthority?.role !== "admin" &&
        liveAuthority?.role !== "member"
      ) {
        throw new PrivateVaultGenesisAdmissionError("conflict");
      }

      const [storedChallenge] = await tx
        .select()
        .from(schema.contentEncryptedVaultGenesisChallenges)
        .where(
          eq(
            schema.contentEncryptedVaultGenesisChallenges.challengeId,
            challenge.challengeId,
          ),
        )
        .limit(1);
      if (
        !storedChallenge ||
        storedChallenge.accountId !== input.scope.accountId ||
        storedChallenge.workspaceId !== input.scope.workspaceId ||
        storedChallenge.vaultId !== candidate.vaultId ||
        storedChallenge.candidateHash !== candidate.candidateHash ||
        storedChallenge.challengeHash !== sha256(request.challenge) ||
        storedChallenge.expiresAt !== challenge.expiresAt
      ) {
        throw new PrivateVaultGenesisAdmissionError("conflict");
      }
      if (storedChallenge.consumedAt === null) {
        const consumed = await tx
          .update(schema.contentEncryptedVaultGenesisChallenges)
          .set({ consumedAt: now.toISOString() })
          .where(
            and(
              eq(
                schema.contentEncryptedVaultGenesisChallenges.challengeId,
                challenge.challengeId,
              ),
              isNull(schema.contentEncryptedVaultGenesisChallenges.consumedAt),
            ),
          )
          .returning({
            challengeId:
              schema.contentEncryptedVaultGenesisChallenges.challengeId,
          });
        if (consumed.length !== 1) {
          const [concurrentClaim] = await tx
            .select({
              consumedAt:
                schema.contentEncryptedVaultGenesisChallenges.consumedAt,
            })
            .from(schema.contentEncryptedVaultGenesisChallenges)
            .where(
              eq(
                schema.contentEncryptedVaultGenesisChallenges.challengeId,
                challenge.challengeId,
              ),
            )
            .limit(1);
          if (!concurrentClaim?.consumedAt) {
            throw new PrivateVaultGenesisAdmissionError("conflict");
          }
        }
      }

      await tx
        .insert(schema.contentEncryptedVaults)
        .values(vaultValues)
        .onConflictDoNothing();
      const [vault] = await tx
        .select()
        .from(schema.contentEncryptedVaults)
        .where(eq(schema.contentEncryptedVaults.vaultId, candidate.vaultId))
        .limit(1);
      if (!vault || !exactVaultRow(vault, vaultValues)) {
        throw new PrivateVaultGenesisAdmissionError("conflict");
      }

      await tx
        .insert(schema.contentEncryptedVaultGenesisAdmissions)
        .values(admissionValues)
        .onConflictDoNothing();
      const [admission] = await tx
        .select()
        .from(schema.contentEncryptedVaultGenesisAdmissions)
        .where(
          eq(
            schema.contentEncryptedVaultGenesisAdmissions.vaultId,
            candidate.vaultId,
          ),
        )
        .limit(1);
      if (!admission || !exactAdmissionRow(admission, admissionValues)) {
        throw new PrivateVaultGenesisAdmissionError("conflict");
      }

      const evidenceValues = {
        bindingId: createHash("sha256")
          .update(
            `${candidate.vaultId}\0${candidate.controlEntryId}\0genesis\0${candidate.candidateHash}`,
          )
          .digest("hex"),
        ownerEmail: vault.ownerEmail,
        orgId: vault.orgId,
        vaultId: candidate.vaultId,
        controlEntryId: candidate.controlEntryId,
        evidenceKind: "genesis",
        evidenceHash: candidate.candidateHash,
        evidenceByteLength: request.candidate.byteLength,
      } as const;
      await tx
        .insert(schema.contentEncryptedVaultControlEvidence)
        .values(evidenceValues)
        .onConflictDoNothing();
      const [evidence] = await tx
        .select()
        .from(schema.contentEncryptedVaultControlEvidence)
        .where(
          and(
            eq(
              schema.contentEncryptedVaultControlEvidence.vaultId,
              candidate.vaultId,
            ),
            eq(
              schema.contentEncryptedVaultControlEvidence.controlEntryId,
              candidate.controlEntryId,
            ),
          ),
        )
        .limit(1);
      if (
        !evidence ||
        evidence.ownerEmail !== evidenceValues.ownerEmail ||
        evidence.orgId !== evidenceValues.orgId ||
        evidence.evidenceKind !== evidenceValues.evidenceKind ||
        evidence.evidenceHash !== evidenceValues.evidenceHash ||
        evidence.evidenceByteLength !== evidenceValues.evidenceByteLength
      ) {
        throw new PrivateVaultGenesisAdmissionError("conflict");
      }
    });
  } catch (error) {
    if (error instanceof PrivateVaultGenesisAdmissionError) throw error;
    throw new PrivateVaultGenesisAdmissionError("unavailable");
  }

  return encodeAncV1GenesisAccountAdmissionReceipt({
    suite: "anc/v1",
    version: 1,
    type: "genesis-account-admission-receipt",
    accountId: input.scope.accountId,
    workspaceId: input.scope.workspaceId,
    vaultId: candidate.vaultId,
    controlEntryId: candidate.controlEntryId,
    controlEntryHash: candidate.controlEntryHash,
    signerEndpointId: candidate.signerEndpointId,
    candidateHash: candidate.candidateHash,
    bootstrapTranscriptHash: candidate.bootstrapTranscriptHash,
  });
}
