import { createHash } from "node:crypto";

import { and, eq, gt, lt, or, sql } from "drizzle-orm";

import { getDb } from "../db/index.js";
import { mailInventoryCursors } from "../db/schema.js";

const TTL_MS = 10 * 60 * 1000;
const CLAIM_TTL_MS = 60 * 1000;
const PAGE_ITEMS_BUDGET_BYTES = 12 * 1024;

export interface MailInventoryItem {
  id: string;
  threadId: string;
  accountEmail: string;
  date: string;
  from: { name?: string; email: string };
  subject: string;
  isUnread: boolean;
  isStarred?: boolean;
  messageCount: number;
  unreadCount: number;
  snippet?: string;
}

export interface MailInventoryError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface MailInventoryAccountState {
  accountEmail: string;
  status: "ok" | "error";
  error?: MailInventoryError;
  providerPageToken?: string;
  exhausted: boolean;
  pending: MailInventoryItem[];
  emittedCount: number;
  /** Unique rows discovered so coverage remains visible before emission. */
  knownCount?: number;
  /** Account-local thread ids already emitted by an earlier output page. */
  emittedThreadIds?: string[];
}

export interface MailInventoryCursorState {
  queryFingerprint: string;
  requestedAccounts: string[] | null;
  accounts: MailInventoryAccountState[];
  firstPage: boolean;
}

export interface MailInventoryCursorClaim {
  id: string;
  claimId: string;
  ownerEmail: string;
  queryFingerprint: string;
  version: number;
  state: MailInventoryCursorState;
}

export interface MailInventoryFetchResult {
  items: MailInventoryItem[];
  errors: Record<string, MailInventoryError>;
  nextPageTokens: Record<string, string>;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, stableValue(child)]),
    );
  }
  return value;
}

export function inventoryQueryFingerprint(input: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(stableValue(input)))
    .digest("hex");
}

export function compareInventoryItems(
  a: MailInventoryItem,
  b: MailInventoryItem,
): number {
  const date = new Date(b.date).getTime() - new Date(a.date).getTime();
  if (date) return date;
  const account = a.accountEmail.localeCompare(b.accountEmail);
  if (account) return account;
  const thread = a.threadId.localeCompare(b.threadId);
  if (thread) return thread;
  return a.id.localeCompare(b.id);
}

function dedupeAndSort(items: MailInventoryItem[]): MailInventoryItem[] {
  const unique = new Map<string, MailInventoryItem>();
  for (const item of items) {
    const key = `${item.accountEmail.toLowerCase()}:${item.threadId}`;
    const current = unique.get(key);
    if (!current || compareInventoryItems(item, current) < 0) {
      unique.set(key, item);
    }
  }
  return [...unique.values()].sort(compareInventoryItems);
}

function applyFetch(
  states: MailInventoryAccountState[],
  result: MailInventoryFetchResult,
): void {
  const byAccount = new Map<string, MailInventoryItem[]>();
  for (const item of result.items) {
    const key = item.accountEmail.toLowerCase();
    const accountItems = byAccount.get(key) ?? [];
    accountItems.push(item);
    byAccount.set(key, accountItems);
  }

  for (const state of states) {
    const key = state.accountEmail.toLowerCase();
    const error = result.errors[key];
    if (error) {
      state.status = "error";
      state.error = error;
      state.exhausted = true;
      state.providerPageToken = undefined;
      continue;
    }
    const emitted = new Set(state.emittedThreadIds ?? []);
    const before = new Set(
      state.pending.map((item) => item.threadId).concat([...emitted]),
    );
    const additions = (byAccount.get(key) ?? []).filter(
      (item) => !before.has(item.threadId),
    );
    state.knownCount =
      (state.knownCount ?? state.emittedCount) + additions.length;
    state.pending = dedupeAndSort([...state.pending, ...additions]);
    state.providerPageToken = result.nextPageTokens[key];
    state.exhausted = !state.providerPageToken;
  }
}

export async function buildMailInventoryPage(
  state: MailInventoryCursorState,
  limit: number,
  fetch: (
    accounts: Array<{ accountEmail: string; pageToken?: string }>,
  ) => Promise<MailInventoryFetchResult>,
): Promise<{ items: MailInventoryItem[]; hasMore: boolean }> {
  const pageLimit = Math.max(1, Math.min(Math.floor(limit), 100));
  const refillCounts = new Map<string, number>();
  const refillFrontiers = async () => {
    while (true) {
      const needsFetch = state.accounts.filter(
        (account) =>
          account.status === "ok" &&
          account.pending.length === 0 &&
          !account.exhausted,
      );
      if (needsFetch.length === 0) return;
      const fetchable = needsFetch.filter((account) => {
        const key = account.accountEmail.toLowerCase();
        const count = refillCounts.get(key) ?? 0;
        if (count < 4) {
          refillCounts.set(key, count + 1);
          return true;
        }
        account.status = "error";
        account.error = {
          code: "pagination_limit",
          message:
            "Mail pagination did not expose a row frontier within four provider pages.",
          retryable: true,
        };
        account.exhausted = true;
        account.providerPageToken = undefined;
        return false;
      });
      if (fetchable.length === 0) continue;
      const prior = fetchable.map((account) => ({
        account,
        token: account.providerPageToken,
      }));
      applyFetch(
        fetchable,
        await fetch(
          fetchable.map((account) => ({
            accountEmail: account.accountEmail,
            pageToken: account.providerPageToken,
          })),
        ),
      );
      for (const { account, token } of prior) {
        if (
          account.status === "ok" &&
          !account.exhausted &&
          account.pending.length === 0 &&
          account.providerPageToken === token
        ) {
          throw new Error(
            `Mail provider pagination made no progress for ${account.accountEmail}.`,
          );
        }
      }
    }
  };

  const page: MailInventoryItem[] = [];
  const emittedKeys = new Set<string>();
  let pageBytes = 2; // JSON array brackets
  const emit = (
    account: MailInventoryAccountState,
    item: MailInventoryItem,
  ) => {
    const key = `${item.accountEmail.toLowerCase()}:${item.threadId}`;
    if (emittedKeys.has(key)) return;
    emittedKeys.add(key);
    page.push(item);
    account.emittedCount += 1;
    account.emittedThreadIds = [
      ...(account.emittedThreadIds ?? []),
      item.threadId,
    ];
  };

  while (page.length < pageLimit) {
    // A global merge is only safe when every live account has a known
    // frontier. Refill an emptied account before emitting an older candidate
    // from another account; otherwise an unseen newer provider row can be
    // skipped across the page boundary.
    await refillFrontiers();
    const candidates = state.accounts
      .filter((account) => account.pending.length > 0)
      .map((account) => ({ account, item: account.pending[0] }))
      .sort((a, b) => compareInventoryItems(a.item, b.item));
    if (candidates.length === 0) {
      break;
    }
    const winner = candidates[0];
    const itemBytes = new TextEncoder().encode(
      JSON.stringify(winner.item),
    ).byteLength;
    if (
      page.length > 0 &&
      pageBytes + itemBytes + 1 > PAGE_ITEMS_BUDGET_BYTES
    ) {
      break;
    }
    winner.account.pending.shift();
    emit(winner.account, winner.item);
    pageBytes += itemBytes + (page.length > 1 ? 1 : 0);
  }

  page.sort(compareInventoryItems);
  state.firstPage = false;
  return {
    items: page,
    hasMore: state.accounts.some(
      (account) => account.pending.length > 0 || !account.exhausted,
    ),
  };
}

export async function createInventoryCursor(
  ownerEmail: string,
  state: MailInventoryCursorState,
): Promise<string> {
  const now = Date.now();
  const id = crypto.randomUUID();
  await getDb()
    .insert(mailInventoryCursors)
    .values({
      id,
      ownerEmail,
      queryFingerprint: state.queryFingerprint,
      state: JSON.stringify(state),
      version: 1,
      expiresAt: now + TTL_MS,
      updatedAt: now,
    });
  await getDb()
    .delete(mailInventoryCursors)
    .where(lt(mailInventoryCursors.expiresAt, now));
  return id;
}

/**
 * Atomically leases a cursor without consuming it. Provider work happens only
 * after this short-lived CAS. Failures can release the lease; success settles
 * it into a distinct successor id (or deletes it at exhaustion).
 */
export async function claimInventoryCursor(
  ownerEmail: string,
  id: string,
  queryFingerprint: string,
): Promise<MailInventoryCursorClaim | null> {
  const now = Date.now();
  const claimId = crypto.randomUUID();
  const staleBefore = now - CLAIM_TTL_MS;
  const rows = await getDb()
    .update(mailInventoryCursors)
    .set({ claimId, claimedAt: now, updatedAt: now })
    .where(
      and(
        eq(mailInventoryCursors.id, id),
        eq(mailInventoryCursors.ownerEmail, ownerEmail),
        eq(mailInventoryCursors.queryFingerprint, queryFingerprint),
        gt(mailInventoryCursors.expiresAt, now),
        or(
          sql`${mailInventoryCursors.claimId} IS NULL`,
          lt(mailInventoryCursors.claimedAt, staleBefore),
        ),
      ),
    )
    .returning({
      state: mailInventoryCursors.state,
      expiresAt: mailInventoryCursors.expiresAt,
      version: mailInventoryCursors.version,
    });
  const row = rows[0];
  if (!row || row.expiresAt <= now) return null;
  try {
    return {
      id,
      claimId,
      ownerEmail,
      queryFingerprint,
      version: row.version,
      state: JSON.parse(row.state) as MailInventoryCursorState,
    };
  } catch {
    await releaseInventoryCursorClaim({
      id,
      claimId,
      ownerEmail,
      queryFingerprint,
      version: row.version,
      state: {} as MailInventoryCursorState,
    });
    return null;
  }
}

export async function releaseInventoryCursorClaim(
  claim: MailInventoryCursorClaim,
): Promise<void> {
  await getDb()
    .update(mailInventoryCursors)
    .set({ claimId: null, claimedAt: null, updatedAt: Date.now() })
    .where(
      and(
        eq(mailInventoryCursors.id, claim.id),
        eq(mailInventoryCursors.ownerEmail, claim.ownerEmail),
        eq(mailInventoryCursors.queryFingerprint, claim.queryFingerprint),
        eq(mailInventoryCursors.version, claim.version),
        eq(mailInventoryCursors.claimId, claim.claimId),
      ),
    );
}

/** Atomically consumes a leased id and optionally creates its successor. */
export async function settleInventoryCursorClaim(
  claim: MailInventoryCursorClaim,
  state: MailInventoryCursorState,
  hasMore: boolean,
): Promise<string | undefined> {
  const db = getDb();
  const successorId = hasMore ? crypto.randomUUID() : undefined;
  const now = Date.now();
  return db.transaction(async (tx: any) => {
    const consumed = await tx
      .delete(mailInventoryCursors)
      .where(
        and(
          eq(mailInventoryCursors.id, claim.id),
          eq(mailInventoryCursors.ownerEmail, claim.ownerEmail),
          eq(mailInventoryCursors.queryFingerprint, claim.queryFingerprint),
          eq(mailInventoryCursors.version, claim.version),
          eq(mailInventoryCursors.claimId, claim.claimId),
        ),
      )
      .returning({ id: mailInventoryCursors.id });
    if (consumed.length !== 1) {
      throw new Error("Inventory cursor lease was lost before settlement.");
    }
    if (successorId) {
      await tx.insert(mailInventoryCursors).values({
        id: successorId,
        ownerEmail: claim.ownerEmail,
        queryFingerprint: claim.queryFingerprint,
        state: JSON.stringify(state),
        version: claim.version + 1,
        claimId: null,
        claimedAt: null,
        expiresAt: now + TTL_MS,
        updatedAt: now,
      });
    }
    return successorId;
  });
}
