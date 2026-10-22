import { and, asc, eq, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "../db/index.js";

export type SlidesTransaction = Parameters<
  Parameters<ReturnType<typeof getDb>["transaction"]>[0]
>[0];

export type UploadedAssetCleanupIntent = "registration" | "delete";
export type UploadedAssetCleanupState =
  | "registering"
  | "registered"
  | "unresolved"
  | "deleting"
  | "pending"
  | "claimed";

export interface UploadedAssetCleanupScope {
  assetId: string;
  ownerEmail: string;
  orgId: string | null;
}

export interface UploadedAssetCleanupOutboxInput extends UploadedAssetCleanupScope {
  intent: UploadedAssetCleanupIntent;
  provider: string;
  providerObjectId: string | null;
  url: string;
}

export type UploadedAssetCleanupOutboxRow =
  typeof schema.uploadedAssetCleanupOutbox.$inferSelect;

export const UPLOADED_ASSET_CLEANUP_LEASE_MS = 5 * 60 * 1_000;

function scopeWhere(
  row: Pick<
    UploadedAssetCleanupOutboxInput,
    "assetId" | "ownerEmail" | "orgId"
  >,
) {
  return and(
    eq(schema.uploadedAssetCleanupOutbox.id, row.assetId),
    eq(schema.uploadedAssetCleanupOutbox.ownerEmail, row.ownerEmail),
    row.orgId
      ? eq(schema.uploadedAssetCleanupOutbox.orgId, row.orgId)
      : isNull(schema.uploadedAssetCleanupOutbox.orgId),
  );
}

export async function reserveUploadedAssetRegistration(
  input: UploadedAssetCleanupScope,
): Promise<string> {
  const token = nanoid();
  const now = Date.now();
  const [reservation] = await getDb()
    .insert(schema.uploadedAssetCleanupOutbox)
    .values({
      id: input.assetId,
      ownerEmail: input.ownerEmail,
      orgId: input.orgId,
      provider: null,
      providerObjectId: null,
      url: null,
      intent: "registration",
      state: "registering",
      leaseToken: token,
      leaseExpiresAt: new Date(
        now + UPLOADED_ASSET_CLEANUP_LEASE_MS,
      ).toISOString(),
      nextAttemptAt: null,
      attemptCount: 0,
      createdAt: new Date(now).toISOString(),
    })
    .onConflictDoNothing({
      target: schema.uploadedAssetCleanupOutbox.id,
    })
    .returning({ id: schema.uploadedAssetCleanupOutbox.id });

  if (!reservation) {
    throw new Error("Uploaded asset cleanup reservation already exists.");
  }
  return token;
}

export async function recordUploadedAssetCleanupObject(
  input: UploadedAssetCleanupOutboxInput,
  token: string,
): Promise<boolean> {
  const recorded = await getDb()
    .update(schema.uploadedAssetCleanupOutbox)
    .set({
      provider: input.provider,
      providerObjectId: input.providerObjectId,
      url: input.url,
      leaseExpiresAt: new Date(
        Date.now() + UPLOADED_ASSET_CLEANUP_LEASE_MS,
      ).toISOString(),
    })
    .where(
      and(
        scopeWhere(input),
        eq(schema.uploadedAssetCleanupOutbox.intent, "registration"),
        eq(schema.uploadedAssetCleanupOutbox.state, "registering"),
        eq(schema.uploadedAssetCleanupOutbox.leaseToken, token),
      ),
    )
    .returning({ id: schema.uploadedAssetCleanupOutbox.id });
  return recorded.length > 0;
}

export async function cancelUploadedAssetRegistration(
  input: UploadedAssetCleanupScope,
  token: string,
): Promise<boolean> {
  const removed = await getDb()
    .delete(schema.uploadedAssetCleanupOutbox)
    .where(
      and(
        scopeWhere(input),
        eq(schema.uploadedAssetCleanupOutbox.intent, "registration"),
        eq(schema.uploadedAssetCleanupOutbox.state, "registering"),
        eq(schema.uploadedAssetCleanupOutbox.leaseToken, token),
      ),
    )
    .returning({ id: schema.uploadedAssetCleanupOutbox.id });
  return removed.length > 0;
}

export async function parkUnresolvedUploadedAssetRegistration(
  input: UploadedAssetCleanupScope,
  token: string,
): Promise<boolean> {
  const parked = await getDb()
    .update(schema.uploadedAssetCleanupOutbox)
    .set({
      state: "unresolved",
      leaseToken: null,
      leaseExpiresAt: null,
      nextAttemptAt: null,
    })
    .where(
      and(
        scopeWhere(input),
        eq(schema.uploadedAssetCleanupOutbox.intent, "registration"),
        eq(schema.uploadedAssetCleanupOutbox.state, "registering"),
        eq(schema.uploadedAssetCleanupOutbox.leaseToken, token),
      ),
    )
    .returning({ id: schema.uploadedAssetCleanupOutbox.id });
  return parked.length > 0;
}

export async function completeUploadedAssetRegistration(
  transaction: SlidesTransaction,
  input: UploadedAssetCleanupOutboxInput,
  token: string,
): Promise<void> {
  const [completed] = await transaction
    .update(schema.uploadedAssetCleanupOutbox)
    .set({
      provider: input.provider,
      providerObjectId: input.providerObjectId,
      url: input.url,
      state: "registered",
      leaseExpiresAt: null,
      nextAttemptAt: null,
    })
    .where(
      and(
        scopeWhere(input),
        eq(schema.uploadedAssetCleanupOutbox.intent, "registration"),
        eq(schema.uploadedAssetCleanupOutbox.state, "registering"),
        eq(schema.uploadedAssetCleanupOutbox.leaseToken, token),
      ),
    )
    .returning({ id: schema.uploadedAssetCleanupOutbox.id });

  if (!completed) {
    throw new Error("Uploaded asset registration reservation was claimed.");
  }
}

export async function clearRegisteredUploadedAsset(
  input: Pick<
    UploadedAssetCleanupOutboxInput,
    "assetId" | "ownerEmail" | "orgId"
  >,
  token: string,
): Promise<boolean> {
  const removed = await getDb()
    .delete(schema.uploadedAssetCleanupOutbox)
    .where(
      and(
        scopeWhere(input),
        eq(schema.uploadedAssetCleanupOutbox.state, "registered"),
        eq(schema.uploadedAssetCleanupOutbox.leaseToken, token),
      ),
    )
    .returning({ id: schema.uploadedAssetCleanupOutbox.id });
  return removed.length > 0;
}

export async function claimFailedUploadedAssetRegistration(
  input: UploadedAssetCleanupOutboxInput,
  registrationToken: string,
): Promise<string | null> {
  const token = nanoid();
  const now = Date.now();
  const [claimed] = await getDb()
    .update(schema.uploadedAssetCleanupOutbox)
    .set({
      intent: "delete",
      state: "deleting",
      provider: input.provider,
      providerObjectId: input.providerObjectId,
      url: input.url,
      leaseToken: token,
      leaseExpiresAt: new Date(
        now + UPLOADED_ASSET_CLEANUP_LEASE_MS,
      ).toISOString(),
      attemptCount: sql`${schema.uploadedAssetCleanupOutbox.attemptCount} + 1`,
      nextAttemptAt: null,
    })
    .where(
      and(
        scopeWhere(input),
        eq(schema.uploadedAssetCleanupOutbox.intent, "registration"),
        eq(schema.uploadedAssetCleanupOutbox.state, "registering"),
        eq(schema.uploadedAssetCleanupOutbox.leaseToken, registrationToken),
      ),
    )
    .returning({ id: schema.uploadedAssetCleanupOutbox.id });
  return claimed ? token : null;
}

export async function scheduleUploadedAssetDeletion(
  transaction: SlidesTransaction,
  input: Omit<UploadedAssetCleanupOutboxInput, "intent">,
): Promise<string> {
  const existing = await transaction
    .select()
    .from(schema.uploadedAssetCleanupOutbox)
    .where(scopeWhere(input))
    .for("update");
  const token = nanoid();
  const now = Date.now();
  const { assetId, ...cleanupValues } = input;
  const values = {
    ...cleanupValues,
    intent: "delete" as const,
    state: "deleting" as const,
    leaseToken: token,
    leaseExpiresAt: new Date(
      now + UPLOADED_ASSET_CLEANUP_LEASE_MS,
    ).toISOString(),
    nextAttemptAt: null,
    attemptCount: sql`${schema.uploadedAssetCleanupOutbox.attemptCount} + 1`,
    createdAt: new Date(now).toISOString(),
  };

  if (existing.length === 0) {
    await transaction
      .insert(schema.uploadedAssetCleanupOutbox)
      .values({ id: assetId, ...cleanupValues, ...values, attemptCount: 1 });
    return token;
  }

  const row = existing[0] as UploadedAssetCleanupOutboxRow;
  const expired = !row.leaseExpiresAt || Date.parse(row.leaseExpiresAt) <= now;
  if (
    row.state === "registering" ||
    (row.state === "deleting" && !expired) ||
    (row.state === "claimed" && !expired)
  ) {
    throw new Error("Uploaded asset cleanup is already in progress.");
  }

  const [updated] = await transaction
    .update(schema.uploadedAssetCleanupOutbox)
    .set(values)
    .where(
      and(
        scopeWhere(input),
        eq(schema.uploadedAssetCleanupOutbox.state, row.state),
        row.leaseToken
          ? eq(schema.uploadedAssetCleanupOutbox.leaseToken, row.leaseToken)
          : isNull(schema.uploadedAssetCleanupOutbox.leaseToken),
        row.leaseExpiresAt
          ? eq(
              schema.uploadedAssetCleanupOutbox.leaseExpiresAt,
              row.leaseExpiresAt,
            )
          : isNull(schema.uploadedAssetCleanupOutbox.leaseExpiresAt),
      ),
    )
    .returning({ id: schema.uploadedAssetCleanupOutbox.id });
  if (!updated) {
    throw new Error("Uploaded asset cleanup lease changed during deletion.");
  }
  return token;
}

export async function finishOwnedUploadedAssetCleanup(
  transaction: SlidesTransaction,
  input: Pick<
    UploadedAssetCleanupOutboxInput,
    "assetId" | "ownerEmail" | "orgId"
  >,
  token: string,
): Promise<boolean> {
  const removed = await transaction
    .delete(schema.uploadedAssetCleanupOutbox)
    .where(
      and(
        scopeWhere(input),
        eq(schema.uploadedAssetCleanupOutbox.leaseToken, token),
        or(
          eq(schema.uploadedAssetCleanupOutbox.state, "deleting"),
          eq(schema.uploadedAssetCleanupOutbox.state, "claimed"),
        ),
      ),
    )
    .returning({ id: schema.uploadedAssetCleanupOutbox.id });
  return removed.length > 0;
}

export async function retryOwnedUploadedAssetCleanup(
  input: Pick<
    UploadedAssetCleanupOutboxInput,
    "assetId" | "ownerEmail" | "orgId"
  >,
  token: string,
  attemptCount: number,
): Promise<boolean> {
  const delayMs = Math.min(
    60 * 60 * 1_000,
    60 * 1_000 * 2 ** Math.min(Math.max(attemptCount - 1, 0), 6),
  );
  const retried = await getDb()
    .update(schema.uploadedAssetCleanupOutbox)
    .set({
      state: "pending",
      leaseToken: null,
      leaseExpiresAt: null,
      nextAttemptAt: new Date(Date.now() + delayMs).toISOString(),
    })
    .where(
      and(
        scopeWhere(input),
        eq(schema.uploadedAssetCleanupOutbox.leaseToken, token),
        or(
          eq(schema.uploadedAssetCleanupOutbox.state, "deleting"),
          eq(schema.uploadedAssetCleanupOutbox.state, "claimed"),
        ),
      ),
    )
    .returning({ id: schema.uploadedAssetCleanupOutbox.id });
  return retried.length > 0;
}

function isDue(row: UploadedAssetCleanupOutboxRow, nowIso: string): boolean {
  if (row.state === "registering" && (!row.provider || !row.url)) return false;
  if (row.state === "pending") {
    return !row.nextAttemptAt || row.nextAttemptAt <= nowIso;
  }
  return (
    (row.state === "registering" ||
      row.state === "deleting" ||
      row.state === "claimed") &&
    (!row.leaseExpiresAt || row.leaseExpiresAt <= nowIso)
  );
}

export async function listDueUploadedAssetCleanups(options: {
  ownerEmail?: string;
  orgId?: string | null;
  limit: number;
  now?: Date;
}): Promise<UploadedAssetCleanupOutboxRow[]> {
  const nowIso = (options.now ?? new Date()).toISOString();
  const due = or(
    and(
      eq(schema.uploadedAssetCleanupOutbox.state, "pending"),
      or(
        isNull(schema.uploadedAssetCleanupOutbox.nextAttemptAt),
        lte(schema.uploadedAssetCleanupOutbox.nextAttemptAt, nowIso),
      ),
    ),
    and(
      eq(schema.uploadedAssetCleanupOutbox.state, "registering"),
      isNotNull(schema.uploadedAssetCleanupOutbox.provider),
      isNotNull(schema.uploadedAssetCleanupOutbox.url),
      or(
        isNull(schema.uploadedAssetCleanupOutbox.leaseExpiresAt),
        lte(schema.uploadedAssetCleanupOutbox.leaseExpiresAt, nowIso),
      ),
    ),
    and(
      or(
        eq(schema.uploadedAssetCleanupOutbox.state, "deleting"),
        eq(schema.uploadedAssetCleanupOutbox.state, "claimed"),
      ),
      or(
        isNull(schema.uploadedAssetCleanupOutbox.leaseExpiresAt),
        lte(schema.uploadedAssetCleanupOutbox.leaseExpiresAt, nowIso),
      ),
    ),
  );
  const scope = [due];
  if (options.ownerEmail) {
    scope.push(
      eq(schema.uploadedAssetCleanupOutbox.ownerEmail, options.ownerEmail),
    );
    scope.push(
      options.orgId
        ? eq(schema.uploadedAssetCleanupOutbox.orgId, options.orgId)
        : isNull(schema.uploadedAssetCleanupOutbox.orgId),
    );
  }
  return getDb()
    .select()
    .from(schema.uploadedAssetCleanupOutbox)
    .where(and(...scope))
    .orderBy(asc(schema.uploadedAssetCleanupOutbox.createdAt))
    .limit(options.limit);
}

export async function claimDueUploadedAssetCleanup(
  candidate: UploadedAssetCleanupOutboxRow,
  now = new Date(),
): Promise<UploadedAssetCleanupOutboxRow | null> {
  if (!candidate.provider || !candidate.url) return null;
  if (!isDue(candidate, now.toISOString())) return null;
  const nowIso = now.toISOString();
  const token = nanoid();
  const due =
    candidate.state === "pending"
      ? and(
          eq(schema.uploadedAssetCleanupOutbox.state, "pending"),
          or(
            isNull(schema.uploadedAssetCleanupOutbox.nextAttemptAt),
            lte(schema.uploadedAssetCleanupOutbox.nextAttemptAt, nowIso),
          ),
        )
      : and(
          eq(schema.uploadedAssetCleanupOutbox.state, candidate.state),
          or(
            isNull(schema.uploadedAssetCleanupOutbox.leaseExpiresAt),
            lte(schema.uploadedAssetCleanupOutbox.leaseExpiresAt, nowIso),
          ),
        );
  const [claimed] = await getDb()
    .update(schema.uploadedAssetCleanupOutbox)
    .set({
      state: "claimed",
      leaseToken: token,
      leaseExpiresAt: new Date(
        now.getTime() + UPLOADED_ASSET_CLEANUP_LEASE_MS,
      ).toISOString(),
      nextAttemptAt: null,
      attemptCount: sql`${schema.uploadedAssetCleanupOutbox.attemptCount} + 1`,
    })
    .where(
      and(
        eq(schema.uploadedAssetCleanupOutbox.id, candidate.id),
        eq(schema.uploadedAssetCleanupOutbox.ownerEmail, candidate.ownerEmail),
        candidate.orgId
          ? eq(schema.uploadedAssetCleanupOutbox.orgId, candidate.orgId)
          : isNull(schema.uploadedAssetCleanupOutbox.orgId),
        eq(schema.uploadedAssetCleanupOutbox.intent, candidate.intent),
        eq(schema.uploadedAssetCleanupOutbox.state, candidate.state),
        candidate.leaseToken
          ? eq(
              schema.uploadedAssetCleanupOutbox.leaseToken,
              candidate.leaseToken,
            )
          : isNull(schema.uploadedAssetCleanupOutbox.leaseToken),
        candidate.leaseExpiresAt
          ? eq(
              schema.uploadedAssetCleanupOutbox.leaseExpiresAt,
              candidate.leaseExpiresAt,
            )
          : isNull(schema.uploadedAssetCleanupOutbox.leaseExpiresAt),
        candidate.nextAttemptAt
          ? eq(
              schema.uploadedAssetCleanupOutbox.nextAttemptAt,
              candidate.nextAttemptAt,
            )
          : isNull(schema.uploadedAssetCleanupOutbox.nextAttemptAt),
        due,
      ),
    )
    .returning();
  return claimed ?? null;
}

export async function listRegisteredUploadedAssetCleanups(options: {
  ownerEmail?: string;
  orgId?: string | null;
  limit: number;
}): Promise<UploadedAssetCleanupOutboxRow[]> {
  const scope = [eq(schema.uploadedAssetCleanupOutbox.state, "registered")];
  if (options.ownerEmail) {
    scope.push(
      eq(schema.uploadedAssetCleanupOutbox.ownerEmail, options.ownerEmail),
    );
    scope.push(
      options.orgId
        ? eq(schema.uploadedAssetCleanupOutbox.orgId, options.orgId)
        : isNull(schema.uploadedAssetCleanupOutbox.orgId),
    );
  }
  return getDb()
    .select()
    .from(schema.uploadedAssetCleanupOutbox)
    .where(and(...scope))
    .orderBy(asc(schema.uploadedAssetCleanupOutbox.createdAt))
    .limit(options.limit);
}
