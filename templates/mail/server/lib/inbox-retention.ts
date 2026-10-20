import { getDbExec } from "@agent-native/core/db";
import { listOAuthAccountsByOwner } from "@agent-native/core/oauth-tokens";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import { hasGmailScope } from "./gmail-scope.js";
import {
  INBOX_THREAD_CAP,
  purgeArchivedInboxThreadRows,
  trimInboxThreadRows,
} from "./inbox-store.js";

// "Inactive" is an owner whose newest sync across all their accounts is older
// than this. mail_sync_accounts.last_synced_at is only written by sync steps,
// which run while someone has Mail open, so it is the app-activity signal.
export const INBOX_INACTIVE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
// Same as the sync claim TTL in inbox-sync.ts: an older claim belongs to a
// worker that is gone.
const STALE_CLAIM_MS = 90_000;
const RETENTION_PAGE_SIZE = 500;

export type ConnectedAccountsResult = {
  accounts: string[];
  errors: Array<{ email: string; error: string }>;
};

export type ResolveConnectedAccounts = (
  ownerEmail: string,
) => Promise<ConnectedAccountsResult>;

export type RetentionPair = {
  ownerEmail: string;
  accountEmail: string;
  syncId: string;
  inactive: boolean;
  claimed: boolean;
};

export type InboxRetentionSummary = {
  pairs: number;
  archivedRowsRemoved: number;
  capRowsRemoved: number;
  capOwners: number;
  ruleRowsRemoved: number;
  ruleOwners: number;
  pairsReset: number;
  pairsSkippedClaimed: number;
  // Claimed or synced between the scan and the clear.
  pairsSkippedActive: number;
  pairsSkippedUnverified: number;
};

// One row per mail_sync_accounts row.
export async function readRetentionPairs(
  now: number,
): Promise<RetentionPair[]> {
  const pairs: RetentionPair[] = [];
  let cursor = "";
  for (;;) {
    const { rows } = await getDbExec().execute({
      sql: `SELECT s.owner_email, s.account_email, s.id,
          (SELECT MAX(COALESCE(o2.last_synced_at, o2.created_at))
             FROM mail_sync_accounts o2
             WHERE o2.owner_email = s.owner_email) AS owner_active_at,
          (s.sync_claim_id IS NOT NULL AND COALESCE(s.sync_claimed_at, 0) >= $1) AS claimed
        FROM mail_sync_accounts s
        WHERE s.id > $2
        ORDER BY s.id
        LIMIT $3`,
      args: [now - STALE_CLAIM_MS, cursor, RETENTION_PAGE_SIZE],
    });
    for (const row of rows as any[]) {
      pairs.push({
        ownerEmail: String(row.owner_email),
        accountEmail: String(row.account_email),
        syncId: String(row.id),
        inactive: Number(row.owner_active_at) < now - INBOX_INACTIVE_AFTER_MS,
        claimed: Boolean(row.claimed),
      });
    }
    if (rows.length < RETENTION_PAGE_SIZE) return pairs;
    cursor = String((rows as any[])[rows.length - 1].id);
  }
}

// Clears one account's sync progress and its thread rows in one transaction.
// Returns null when a live sync claim, or (for an inactivity clear) a sync that
// landed after the scan, got there first, so nothing is removed. Taking over a
// stale claim drops its id so the old worker fails the withSyncClaim fence.
export async function clearPair(
  pair: RetentionPair,
  now: number,
  requireInactive: boolean,
): Promise<number | null> {
  return getDb().transaction(async (tx: any) => {
    const claimed = await tx
      .update(schema.mailSyncAccounts)
      .set({
        historyId: null,
        fullSyncPageToken: null,
        fullSyncHistoryId: null,
        fullSyncStartedAt: null,
        fullSyncPhase: null,
        fullSyncReconcilePageToken: null,
        fullSyncReconcilePendingIdsJson: null,
        fullSyncReconcilePasses: 0,
        fullSyncListedCount: 0,
        status: "idle",
        lastError: null,
        syncClaimId: null,
        syncClaimedAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.mailSyncAccounts.id, pair.syncId),
          or(
            isNull(schema.mailSyncAccounts.syncClaimId),
            lt(schema.mailSyncAccounts.syncClaimedAt, now - STALE_CLAIM_MS),
          ),
          requireInactive
            ? sql`(SELECT MAX(COALESCE(o.last_synced_at, o.created_at))
                FROM mail_sync_accounts o
                WHERE o.owner_email = ${pair.ownerEmail}) < ${now - INBOX_INACTIVE_AFTER_MS}::bigint`
            : undefined,
        ),
      )
      .returning({ id: schema.mailSyncAccounts.id });
    if (claimed.length === 0) return null;
    const deleted = await tx
      .delete(schema.mailInboxThreads)
      .where(
        and(
          eq(schema.mailInboxThreads.ownerEmail, pair.ownerEmail),
          eq(schema.mailInboxThreads.accountEmail, pair.accountEmail),
        ),
      )
      .returning({ id: schema.mailInboxThreads.id });
    return deleted.length;
  });
}

// Runs the retention pass. A disconnected account is only cleared after the
// resolver confirms it has no connection; a resolver error keeps the rows.
export async function runInboxRetention(opts: {
  now?: number;
  resolveConnectedAccounts: ResolveConnectedAccounts;
}): Promise<InboxRetentionSummary> {
  const now = opts.now ?? Date.now();
  const pairs = await readRetentionPairs(now);
  const summary: InboxRetentionSummary = {
    pairs: pairs.length,
    archivedRowsRemoved: 0,
    capRowsRemoved: 0,
    capOwners: 0,
    ruleRowsRemoved: 0,
    ruleOwners: 0,
    pairsReset: 0,
    pairsSkippedClaimed: 0,
    pairsSkippedActive: 0,
    pairsSkippedUnverified: 0,
  };

  const cappedOwners = new Set<string>();
  for (const pair of pairs) {
    summary.archivedRowsRemoved += await purgeArchivedInboxThreadRows(
      pair.ownerEmail,
      pair.accountEmail,
      now,
    );
    const capped = await trimInboxThreadRows(
      pair.ownerEmail,
      pair.accountEmail,
      INBOX_THREAD_CAP,
    );
    if (capped > 0) {
      summary.capRowsRemoved += capped;
      cappedOwners.add(pair.ownerEmail);
    }
  }
  summary.capOwners = cappedOwners.size;

  const connectedByOwner = new Map<string, Set<string> | null>();
  const connectedFor = async (ownerEmail: string) => {
    if (!connectedByOwner.has(ownerEmail)) {
      const result = await opts.resolveConnectedAccounts(ownerEmail);
      connectedByOwner.set(
        ownerEmail,
        result.errors.length > 0
          ? null
          : new Set(result.accounts.map((email) => email.toLowerCase())),
      );
    }
    return connectedByOwner.get(ownerEmail) ?? null;
  };

  // Mail's resolver only counts a Google grant that carries a Gmail scope. A
  // managed workspace connection is checked later by the resolver.
  const gmailGrantsByOwner = new Map<string, Set<string>>();
  const hasGmailGrant = async (pair: RetentionPair) => {
    let grants = gmailGrantsByOwner.get(pair.ownerEmail);
    if (!grants) {
      const accounts = await listOAuthAccountsByOwner(
        "google",
        pair.ownerEmail,
      );
      grants = new Set(
        accounts
          .filter((account) => hasGmailScope(account.tokens))
          .map((account) => account.accountId.toLowerCase()),
      );
      gmailGrantsByOwner.set(pair.ownerEmail, grants);
    }
    return grants.has(pair.accountEmail);
  };

  const ruleOwners = new Set<string>();
  for (const pair of pairs) {
    if (!pair.inactive && (await hasGmailGrant(pair))) continue;
    if (pair.claimed) {
      summary.pairsSkippedClaimed++;
      continue;
    }
    if (!pair.inactive) {
      const connected = await connectedFor(pair.ownerEmail);
      if (connected === null) {
        summary.pairsSkippedUnverified++;
        continue;
      }
      if (connected.has(pair.accountEmail)) continue;
    }
    const removed = await clearPair(pair, now, pair.inactive);
    if (removed === null) {
      summary.pairsSkippedActive++;
      continue;
    }
    summary.pairsReset++;
    summary.ruleRowsRemoved += removed;
    if (removed > 0) ruleOwners.add(pair.ownerEmail);
  }
  summary.ruleOwners = ruleOwners.size;
  return summary;
}
