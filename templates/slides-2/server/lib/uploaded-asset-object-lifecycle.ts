import { createHash, randomUUID } from "node:crypto";

import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";

type SlidesDatabase = ReturnType<typeof getDb>;
export type SlidesTransaction = Parameters<
  Parameters<SlidesDatabase["transaction"]>[0]
>[0];

export interface UploadedAssetObjectIdentity {
  url: string;
  provider: string | null;
  providerObjectId: string | null;
}

export interface UploadedAssetObjectCleanupLease {
  assetId: string;
  ownerEmail: string;
  orgId: string | null;
  token: string;
}

interface UploadedAssetObjectDeletionClaim {
  token: string;
  expiresAt: string;
}

// Expired claims can replay the provider delete after a crash; deletes are true when already missing.
const OBJECT_DELETION_CLAIM_LEASE_MS = 5 * 60 * 1_000;

export type UploadedAssetObjectDeletionResult =
  | { status: "deleted" | "already-deleted" | "shared" | "stale" }
  | { status: "failed"; error: unknown };

type DeletionTransactionCallback = (
  transaction: SlidesTransaction,
) => Promise<void>;

function identityKeys(identity: UploadedAssetObjectIdentity): string[] {
  if (typeof identity.url !== "string" || identity.url.trim().length === 0) {
    throw new Error("Uploaded asset storage URL is required.");
  }

  // Keep URL and provider identifiers byte-exact: signed URLs and object IDs can be case-sensitive.
  const aliases = [JSON.stringify(["url", identity.url])];
  if (identity.provider && identity.providerObjectId) {
    aliases.push(
      JSON.stringify([
        "provider",
        identity.provider,
        identity.providerObjectId,
      ]),
    );
  }

  return [
    ...new Set(
      aliases.map((alias) => createHash("sha256").update(alias).digest("hex")),
    ),
  ].sort();
}

function storedObjectWhere(identity: UploadedAssetObjectIdentity) {
  const urlMatch = eq(schema.uploadedAssets.url, identity.url);
  const providerObjectMatch =
    identity.provider && identity.providerObjectId
      ? and(
          eq(schema.uploadedAssets.provider, identity.provider),
          eq(schema.uploadedAssets.providerObjectId, identity.providerObjectId),
        )
      : undefined;
  return providerObjectMatch ? or(urlMatch, providerObjectMatch) : urlMatch;
}

async function lockIdentityKeys(
  transaction: SlidesTransaction,
  keys: string[],
): Promise<void> {
  for (const key of keys) {
    await transaction.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`slides-uploaded-asset:${key}`}, 0::bigint))`,
    );
  }
}

export async function lockUploadedAssetObjectIdentities(
  transaction: SlidesTransaction,
  identities: readonly UploadedAssetObjectIdentity[],
): Promise<string[]> {
  const keys = [...new Set(identities.flatMap(identityKeys))].sort();
  await lockIdentityKeys(transaction, keys);
  return keys;
}

async function lifecycleRows(transaction: SlidesTransaction, keys: string[]) {
  if (keys.length === 0) return [];
  return transaction
    .select({
      identityKey: schema.uploadedAssetObjectLifecycle.identityKey,
      state: schema.uploadedAssetObjectLifecycle.state,
      deletionLeaseToken:
        schema.uploadedAssetObjectLifecycle.deletionLeaseToken,
      deletionLeaseExpiresAt:
        schema.uploadedAssetObjectLifecycle.deletionLeaseExpiresAt,
    })
    .from(schema.uploadedAssetObjectLifecycle)
    .where(inArray(schema.uploadedAssetObjectLifecycle.identityKey, keys))
    .for("update");
}

async function writeLifecycleState(
  transaction: SlidesTransaction,
  keys: string[],
  state: "active" | "deleting" | "deleted",
  deletionClaim?: UploadedAssetObjectDeletionClaim,
): Promise<void> {
  if (keys.length === 0) return;
  if (state === "deleting" && !deletionClaim) {
    throw new Error("A deletion claim is required for the deleting state.");
  }

  const now = new Date().toISOString();
  const claimFields = deletionClaim
    ? {
        deletionLeaseToken: deletionClaim.token,
        deletionLeaseExpiresAt: deletionClaim.expiresAt,
      }
    : { deletionLeaseToken: null, deletionLeaseExpiresAt: null };

  const rows = await lifecycleRows(transaction, keys);
  const existingKeys = new Set(rows.map((row) => row.identityKey));
  const missingKeys = keys.filter((key) => !existingKeys.has(key));
  if (missingKeys.length > 0) {
    await transaction
      .insert(schema.uploadedAssetObjectLifecycle)
      .values(
        missingKeys.map((identityKey) => ({
          identityKey,
          state,
          updatedAt: now,
          ...claimFields,
        })),
      )
      .onConflictDoNothing({
        target: schema.uploadedAssetObjectLifecycle.identityKey,
      });
  }

  await transaction
    .update(schema.uploadedAssetObjectLifecycle)
    .set({ state, updatedAt: now, ...claimFields })
    .where(inArray(schema.uploadedAssetObjectLifecycle.identityKey, keys));
}

async function expireDeletionClaim(
  transaction: SlidesTransaction,
  keys: string[],
  token: string,
): Promise<boolean> {
  const rows = await lifecycleRows(transaction, keys);
  if (
    rows.length !== keys.length ||
    rows.some(
      (row) => row.state !== "deleting" || row.deletionLeaseToken !== token,
    )
  ) {
    return false;
  }

  await transaction
    .update(schema.uploadedAssetObjectLifecycle)
    .set({
      deletionLeaseExpiresAt: new Date(Date.now() - 1).toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        inArray(schema.uploadedAssetObjectLifecycle.identityKey, keys),
        eq(schema.uploadedAssetObjectLifecycle.state, "deleting"),
        eq(schema.uploadedAssetObjectLifecycle.deletionLeaseToken, token),
      ),
    );
  return true;
}

export async function registerUploadedAssetObjectIdentities(
  transaction: SlidesTransaction,
  identities: readonly UploadedAssetObjectIdentity[],
): Promise<void> {
  const keys = await lockUploadedAssetObjectIdentities(transaction, identities);
  const rows = await lifecycleRows(transaction, keys);
  if (rows.some((row) => row.state !== "active")) {
    throw Object.assign(
      new Error("This stored asset is being deleted or was already deleted."),
      { statusCode: 409, errorCode: "uploaded_asset_object_unavailable" },
    );
  }
  await writeLifecycleState(transaction, keys, "active");
}

async function isCurrentCleanupLease(
  transaction: SlidesTransaction,
  lease: UploadedAssetObjectCleanupLease,
): Promise<boolean> {
  const rows = await transaction
    .select({
      state: schema.uploadedAssetCleanupOutbox.state,
      leaseToken: schema.uploadedAssetCleanupOutbox.leaseToken,
      leaseExpiresAt: schema.uploadedAssetCleanupOutbox.leaseExpiresAt,
    })
    .from(schema.uploadedAssetCleanupOutbox)
    .where(
      and(
        eq(schema.uploadedAssetCleanupOutbox.id, lease.assetId),
        eq(schema.uploadedAssetCleanupOutbox.ownerEmail, lease.ownerEmail),
        lease.orgId
          ? eq(schema.uploadedAssetCleanupOutbox.orgId, lease.orgId)
          : isNull(schema.uploadedAssetCleanupOutbox.orgId),
        eq(schema.uploadedAssetCleanupOutbox.leaseToken, lease.token),
        or(
          eq(schema.uploadedAssetCleanupOutbox.state, "deleting"),
          eq(schema.uploadedAssetCleanupOutbox.state, "claimed"),
        ),
      ),
    )
    .for("update");
  const row = rows[0];
  return Boolean(
    row?.leaseExpiresAt && Date.parse(row.leaseExpiresAt) > Date.now(),
  );
}

export async function deleteUploadedAssetObject(args: {
  identity: UploadedAssetObjectIdentity;
  excludeAssetId?: string;
  lease?: UploadedAssetObjectCleanupLease;
  deleteObject: () => Promise<boolean>;
  onShared?: DeletionTransactionCallback;
  onAlreadyDeleted?: DeletionTransactionCallback;
  onDeleted?: DeletionTransactionCallback;
}): Promise<UploadedAssetObjectDeletionResult> {
  const db = getDb();
  const keys = identityKeys(args.identity);

  const preparation = await db.transaction(async (transaction) => {
    await lockIdentityKeys(transaction, keys);
    if (args.lease && !(await isCurrentCleanupLease(transaction, args.lease))) {
      return { status: "stale" } as const;
    }

    const otherAssetScope = args.excludeAssetId
      ? and(
          ne(schema.uploadedAssets.id, args.excludeAssetId),
          storedObjectWhere(args.identity),
        )
      : storedObjectWhere(args.identity);
    const [otherAsset] = await transaction
      .select({ id: schema.uploadedAssets.id })
      .from(schema.uploadedAssets)
      .where(otherAssetScope)
      .limit(1);
    const states = await lifecycleRows(transaction, keys);

    if (otherAsset) {
      if (states.some((row) => row.state !== "active")) {
        throw new Error("A stored asset alias exists for a terminal object.");
      }
      await writeLifecycleState(transaction, keys, "active");
      await args.onShared?.(transaction);
      return { status: "shared" } as const;
    }

    if (states.some((row) => row.state === "deleted")) {
      await args.onAlreadyDeleted?.(transaction);
      return { status: "already-deleted" } as const;
    }

    if (
      states.some((row) => row.state !== "active" && row.state !== "deleting")
    ) {
      throw new Error("Stored asset deletion state changed unexpectedly.");
    }

    const now = Date.now();
    const activeDeletionClaim = states.some(
      (row) =>
        row.state === "deleting" &&
        row.deletionLeaseToken &&
        row.deletionLeaseExpiresAt &&
        Date.parse(row.deletionLeaseExpiresAt) > now,
    );
    if (activeDeletionClaim) {
      return {
        status: "failed",
        error: new Error("Stored asset deletion is already in progress."),
      } as const;
    }

    const deletionClaim = {
      token: randomUUID(),
      expiresAt: new Date(now + OBJECT_DELETION_CLAIM_LEASE_MS).toISOString(),
    };
    await writeLifecycleState(transaction, keys, "deleting", deletionClaim);
    return { deletionClaim } as const;
  });

  if ("status" in preparation) {
    return preparation;
  }

  const deletionClaim = preparation.deletionClaim;
  const retryableFailure = async (
    error: unknown,
  ): Promise<UploadedAssetObjectDeletionResult> => {
    await db.transaction(async (transaction) => {
      await lockIdentityKeys(transaction, keys);
      await expireDeletionClaim(transaction, keys, deletionClaim.token);
    });
    return { status: "failed", error };
  };

  let deleted: boolean;
  try {
    deleted = await args.deleteObject();
  } catch (error) {
    return retryableFailure(error);
  }
  if (!deleted) {
    return retryableFailure(
      new Error("The storage provider did not confirm deletion."),
    );
  }

  const claimLost = (): UploadedAssetObjectDeletionResult =>
    args.lease
      ? { status: "stale" }
      : {
          status: "failed",
          error: new Error(
            "Stored asset deletion claim changed during deletion.",
          ),
        };

  const deletion = await db.transaction(async (transaction) => {
    await lockIdentityKeys(transaction, keys);
    if (args.lease && !(await isCurrentCleanupLease(transaction, args.lease))) {
      await expireDeletionClaim(transaction, keys, deletionClaim.token);
      return { status: "stale" } as const;
    }

    const states = await lifecycleRows(transaction, keys);
    if (states.some((row) => row.state === "deleted")) {
      await args.onAlreadyDeleted?.(transaction);
      return { status: "already-deleted" } as const;
    }
    if (
      states.length !== keys.length ||
      states.some(
        (row) =>
          row.state !== "deleting" ||
          row.deletionLeaseToken !== deletionClaim.token,
      )
    ) {
      return claimLost();
    }

    await writeLifecycleState(transaction, keys, "deleted");
    return { status: "deleted" } as const;
  });

  const onDeleted = args.onDeleted;
  if (deletion.status !== "deleted" || !onDeleted) return deletion;

  try {
    return await db.transaction(async (transaction) => {
      await lockIdentityKeys(transaction, keys);
      if (
        args.lease &&
        !(await isCurrentCleanupLease(transaction, args.lease))
      ) {
        return { status: "stale" } as const;
      }

      const states = await lifecycleRows(transaction, keys);
      if (
        states.length !== keys.length ||
        states.some((row) => row.state !== "deleted")
      ) {
        throw new Error("Stored asset deletion state changed unexpectedly.");
      }

      await onDeleted(transaction);
      return deletion;
    });
  } catch (error) {
    return { status: "failed", error };
  }
}
