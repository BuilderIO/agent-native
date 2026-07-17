import {
  E2EE_ENDPOINT_REQUEST_MAX_FUTURE_SKEW_SECONDS,
  E2EE_ENDPOINT_REQUEST_NONCE_RETENTION_SECONDS,
  opaqueIdSchema,
  protocolTimestampSchema,
} from "@agent-native/core/e2ee";
import { and, asc, eq, gt, inArray, lte, notExists, sql } from "drizzle-orm";
import { z } from "zod";

import { privateVaultReplayFenceRecordSchema } from "../../shared/private-vault-replay-fence.js";
import { getDb, schema } from "../db/index.js";

const MINUTE_MS = 60_000;
const LEGACY_BRIDGE_BATCH_SIZE = 50;

const endpointRequestNonceClaimSchema = z
  .object({
    ownerEmail: z.string().email().max(320),
    orgId: z.string().max(160),
    vaultId: opaqueIdSchema,
    endpointId: opaqueIdSchema,
    nonce: z
      .string()
      .min(32)
      .max(128)
      .regex(/^[0-9a-f]+$/),
    expiresAt: protocolTimestampSchema,
  })
  .strict();

export type PrivateVaultEndpointRequestNonceClaim = z.infer<
  typeof endpointRequestNonceClaimSchema
>;

export interface PrivateVaultEndpointRequestNonceStore {
  claim(input: PrivateVaultEndpointRequestNonceClaim): Promise<boolean>;
  /**
   * Claims a nonce only after the caller has authenticated the exact endpoint
   * against signed control authority. Unlike broker claims, this deliberately
   * does not consult the mutable endpoint-directory projection.
   */
  claimAuthorizedControlRequest(
    input: PrivateVaultEndpointRequestNonceClaim,
  ): Promise<boolean>;
  bridgeLegacyClaims(now: string): Promise<number>;
  deleteExpired(now: string, limit?: number): Promise<number>;
}

interface PrivateVaultEndpointRequestNonceStoreOptions {
  readonly now?: () => Date;
}

function bucketDown(value: number): number {
  return Math.floor(value / MINUTE_MS) * MINUTE_MS;
}

function bucketUp(value: number): number {
  return Math.ceil(value / MINUTE_MS) * MINUTE_MS;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function replayFenceValues(input: {
  ownerEmail: string;
  orgId: string;
  vaultId: string;
  endpointId: string;
  nonce: string;
  claimedAtMs: number;
  expiresAtMs: number;
}) {
  const [id, nonceDigest] = await Promise.all([
    sha256Hex(`${input.vaultId}\0${input.endpointId}\0${input.nonce}`),
    sha256Hex(input.nonce),
  ]);
  const logicalRecord = privateVaultReplayFenceRecordSchema.parse({
    version: 1,
    vaultId: input.vaultId,
    endpointId: input.endpointId,
    nonceDigest,
    claimedAtBucket: bucketDown(input.claimedAtMs),
    expiresAtBucket: bucketUp(input.expiresAtMs),
  });
  return {
    id,
    ownerEmail: input.ownerEmail,
    orgId: input.orgId,
    ...logicalRecord,
  };
}

async function legacyClaimsByExpiry() {
  const legacy = schema.contentEncryptedVaultEndpointRequestNoncesLegacy;
  const rows = await getDb().select().from(legacy);
  return rows.map((row) => ({
    ...row,
    claimedAtMs: Date.parse(protocolTimestampSchema.parse(row.claimedAt)),
    expiresAtMs: Date.parse(protocolTimestampSchema.parse(row.expiresAt)),
  }));
}

async function deleteExpiredBatch(nowMs: number, limit: number) {
  const claims = schema.contentEncryptedVaultEndpointRequestNonces;
  const legacy = schema.contentEncryptedVaultEndpointRequestNoncesLegacy;
  const expiredLegacyIds = (await legacyClaimsByExpiry())
    .filter((row) => row.expiresAtMs <= nowMs)
    .sort(
      (left, right) =>
        left.expiresAtMs - right.expiresAtMs || left.id.localeCompare(right.id),
    )
    .slice(0, limit)
    .map((row) => row.id);
  const legacyDeleted =
    expiredLegacyIds.length === 0
      ? []
      : await getDb()
          .delete(legacy)
          .where(inArray(legacy.id, expiredLegacyIds))
          .returning({ id: legacy.id });
  const remaining = limit - legacyDeleted.length;
  if (remaining === 0) return legacyDeleted.length;
  const expired = getDb()
    .select({ id: claims.id })
    .from(claims)
    .where(lte(claims.expiresAtBucket, nowMs))
    .orderBy(asc(claims.expiresAtBucket), asc(claims.id))
    .limit(remaining);
  const deleted = await getDb()
    .delete(claims)
    .where(inArray(claims.id, expired))
    .returning({ id: claims.id });
  return legacyDeleted.length + deleted.length;
}

async function deleteAllExpired(nowMs: number) {
  const claims = schema.contentEncryptedVaultEndpointRequestNonces;
  const legacy = schema.contentEncryptedVaultEndpointRequestNoncesLegacy;
  const expiredLegacyIds = (await legacyClaimsByExpiry())
    .filter((row) => row.expiresAtMs <= nowMs)
    .map((row) => row.id);
  const [legacyDeleted, deleted] = await Promise.all([
    expiredLegacyIds.length === 0
      ? Promise.resolve([])
      : getDb()
          .delete(legacy)
          .where(inArray(legacy.id, expiredLegacyIds))
          .returning({ id: legacy.id }),
    getDb()
      .delete(claims)
      .where(lte(claims.expiresAtBucket, nowMs))
      .returning({ id: claims.id }),
  ]);
  return legacyDeleted.length + deleted.length;
}

export function createPrivateVaultEndpointRequestNonceStore(
  options: PrivateVaultEndpointRequestNonceStoreOptions = {},
): PrivateVaultEndpointRequestNonceStore {
  const now = options.now ?? (() => new Date());

  async function parseClaim(input: PrivateVaultEndpointRequestNonceClaim) {
    const parsed = endpointRequestNonceClaimSchema.parse({
      ...input,
      ownerEmail: input.ownerEmail.trim().toLowerCase(),
      orgId: input.orgId.trim(),
    });
    const claimedAtMs = now().getTime();
    const expiresAtMs = Date.parse(parsed.expiresAt);
    if (
      !Number.isFinite(claimedAtMs) ||
      expiresAtMs <= claimedAtMs ||
      expiresAtMs - claimedAtMs >
        (E2EE_ENDPOINT_REQUEST_NONCE_RETENTION_SECONDS +
          E2EE_ENDPOINT_REQUEST_MAX_FUTURE_SKEW_SECONDS) *
          1000
    ) {
      return null;
    }
    return {
      parsed,
      claimedAtMs,
      expiresAtMs,
      record: await replayFenceValues({
        ...parsed,
        claimedAtMs,
        expiresAtMs,
      }),
    };
  }

  function unexpiredLegacyReplay(input: {
    vaultId: string;
    endpointId: string;
    ownerEmail: string;
    orgId: string;
    nonce: string;
    claimedAt: string;
  }) {
    const legacy = schema.contentEncryptedVaultEndpointRequestNoncesLegacy;
    return getDb()
      .select({ id: legacy.id })
      .from(legacy)
      .where(
        and(
          eq(legacy.vaultId, input.vaultId),
          eq(legacy.endpointId, input.endpointId),
          eq(legacy.ownerEmail, input.ownerEmail),
          eq(legacy.orgId, input.orgId),
          eq(legacy.nonce, input.nonce),
          gt(legacy.expiresAt, input.claimedAt),
        ),
      );
  }

  async function finishClaimHygiene(claimedAtMs: number, inserted: unknown[]) {
    // This is opportunistic bounded hygiene, not part of authorization.
    // Failure preserves the replay fence and never turns cleanup into an oracle.
    await deleteExpiredBatch(claimedAtMs, 64).catch(() => 0);
    return inserted.length === 1;
  }

  return {
    claim: async (input) => {
      const claim = await parseClaim(input);
      if (!claim) return false;
      const { parsed, claimedAtMs, record } = claim;
      const endpoint = schema.contentEncryptedVaultEndpoints;
      const claims = schema.contentEncryptedVaultEndpointRequestNonces;
      const claimedAt = new Date(claimedAtMs).toISOString();
      const legacyReplay = unexpiredLegacyReplay({
        ...parsed,
        claimedAt,
      });
      const eligibleEndpoint = getDb()
        .select({
          id: sql<string>`${record.id}`.as("id"),
          vaultId: endpoint.vaultId,
          endpointId: endpoint.endpointId,
          ownerEmail: endpoint.ownerEmail,
          orgId: endpoint.orgId,
          version: sql<number>`${record.version}`.as("version"),
          nonceDigest: sql<string>`${record.nonceDigest}`.as("nonce_digest"),
          claimedAtBucket: sql<number>`${record.claimedAtBucket}`.as(
            "claimed_at_bucket",
          ),
          expiresAtBucket: sql<number>`${record.expiresAtBucket}`.as(
            "expires_at_bucket",
          ),
        })
        .from(endpoint)
        .where(
          and(
            eq(endpoint.endpointId, parsed.endpointId),
            eq(endpoint.vaultId, parsed.vaultId),
            eq(endpoint.ownerEmail, parsed.ownerEmail),
            eq(endpoint.orgId, parsed.orgId),
            eq(endpoint.endpointState, "online"),
            notExists(legacyReplay),
          ),
        );
      const inserted = await getDb()
        .insert(claims)
        .select(eligibleEndpoint)
        .onConflictDoNothing()
        .returning({ id: claims.id });

      return finishClaimHygiene(claimedAtMs, inserted);
    },
    claimAuthorizedControlRequest: async (input) => {
      const claim = await parseClaim(input);
      if (!claim) return false;
      const { parsed, claimedAtMs, record } = claim;
      const vault = schema.contentEncryptedVaults;
      const claims = schema.contentEncryptedVaultEndpointRequestNonces;
      const claimedAt = new Date(claimedAtMs).toISOString();
      const legacyReplay = unexpiredLegacyReplay({
        ...parsed,
        claimedAt,
      });
      const eligibleVault = getDb()
        .select({
          id: sql<string>`${record.id}`.as("id"),
          vaultId: vault.vaultId,
          endpointId: sql<string>`${parsed.endpointId}`.as("endpoint_id"),
          ownerEmail: vault.ownerEmail,
          orgId: vault.orgId,
          version: sql<number>`${record.version}`.as("version"),
          nonceDigest: sql<string>`${record.nonceDigest}`.as("nonce_digest"),
          claimedAtBucket: sql<number>`${record.claimedAtBucket}`.as(
            "claimed_at_bucket",
          ),
          expiresAtBucket: sql<number>`${record.expiresAtBucket}`.as(
            "expires_at_bucket",
          ),
        })
        .from(vault)
        .where(
          and(
            eq(vault.vaultId, parsed.vaultId),
            eq(vault.ownerEmail, parsed.ownerEmail),
            eq(vault.orgId, parsed.orgId),
            eq(vault.vaultState, "active"),
            notExists(legacyReplay),
          ),
        );
      const inserted = await getDb()
        .insert(claims)
        .select(eligibleVault)
        .onConflictDoNothing()
        .returning({ id: claims.id });
      return finishClaimHygiene(claimedAtMs, inserted);
    },
    bridgeLegacyClaims: async (value) => {
      const nowMs = Date.parse(protocolTimestampSchema.parse(value));
      const legacyRows = (await legacyClaimsByExpiry()).filter(
        (row) => row.expiresAtMs > nowMs,
      );
      if (legacyRows.length === 0) return 0;
      const records = await Promise.all(
        legacyRows.map((row) =>
          replayFenceValues({
            ownerEmail: row.ownerEmail,
            orgId: row.orgId,
            vaultId: row.vaultId,
            endpointId: row.endpointId,
            nonce: row.nonce,
            claimedAtMs: row.claimedAtMs,
            expiresAtMs: row.expiresAtMs,
          }),
        ),
      );
      let insertedCount = 0;
      for (
        let offset = 0;
        offset < records.length;
        offset += LEGACY_BRIDGE_BATCH_SIZE
      ) {
        const inserted = await getDb()
          .insert(schema.contentEncryptedVaultEndpointRequestNonces)
          .values(records.slice(offset, offset + LEGACY_BRIDGE_BATCH_SIZE))
          .onConflictDoNothing()
          .returning({
            id: schema.contentEncryptedVaultEndpointRequestNonces.id,
          });
        insertedCount += inserted.length;
      }
      return insertedCount;
    },
    deleteExpired: async (value, limit) => {
      const nowMs = Date.parse(protocolTimestampSchema.parse(value));
      if (limit === undefined) return deleteAllExpired(nowMs);
      if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 1_000) {
        throw new Error("Invalid replay-fence cleanup limit");
      }
      return deleteExpiredBatch(nowMs, limit);
    },
  };
}

export const sqlPrivateVaultEndpointRequestNonceStore =
  createPrivateVaultEndpointRequestNonceStore();
