/**
 * Calendar accounts held in Dispatch.
 *
 * When this deployment points at Dispatch's Google account hub, the Google
 * accounts Dispatch holds for a person and grants to Clips show up as
 * ordinary `calendar_accounts` rows with `token_source = 'dispatch'`. Those
 * rows carry no tokens: each read asks the hub for a short-lived access
 * token. Clips keeps the rows so per-account state (sync errors, cached
 * events, shares) works the same as for an account connected here, and an
 * account the person also connected in Clips keeps using Clips' own tokens.
 */

import { randomUUID } from "node:crypto";

import {
  getHubGoogleAccount,
  isGoogleAccountHubConfigured,
  listHubGoogleAccounts,
} from "@agent-native/core/google-account-hub";
import { and, eq } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import { CLIPS_GOOGLE_OAUTH_APP_ID } from "./google-calendar-oauth.js";
import {
  getActiveOrganizationId,
  normalizeOwnerEmail,
  ownerEmailMatches,
} from "./recordings.js";

const HUB_PROVIDER = "google_calendar";
// Rows change only when Dispatch's answer does, so look at most this often.
const SYNC_INTERVAL_MS = 60_000;

const lastSyncedAt = new Map<string, number>();
const syncsInFlight = new Map<string, Promise<void>>();

function sameEmail(a: string | null | undefined, b: string): boolean {
  return Boolean(a) && a!.trim().toLowerCase() === b.trim().toLowerCase();
}

async function syncOwner(owner: string): Promise<void> {
  let granted: Map<string, "connected" | "needs-reauth">;
  try {
    const { accounts, errors } = await listHubGoogleAccounts({
      appId: CLIPS_GOOGLE_OAUTH_APP_ID,
      userEmail: owner,
      provider: HUB_PROVIDER,
    });
    granted = new Map();
    for (const error of errors) {
      granted.set(error.accountEmail.toLowerCase(), "needs-reauth");
    }
    for (const account of accounts) {
      granted.set(account.accountEmail.toLowerCase(), "connected");
    }
  } catch (error) {
    // Leave the rows as they are; reads report their own token errors.
    console.warn(
      "[clips] Google account hub unavailable:",
      error instanceof Error ? error.message : error,
    );
    return;
  }

  const db = getDb();
  const rows = await db
    .select()
    .from(schema.calendarAccounts)
    .where(
      and(
        eq(schema.calendarAccounts.provider, "google"),
        ownerEmailMatches(schema.calendarAccounts.ownerEmail, owner),
      ),
    );
  const now = new Date().toISOString();
  let orgId: string | null | undefined;

  for (const [accountEmail, status] of granted) {
    const ownConnection = rows.find(
      (row) =>
        row.tokenSource !== "dispatch" &&
        row.status === "connected" &&
        sameEmail(row.email, accountEmail),
    );
    if (ownConnection) continue;
    const existing = rows.find(
      (row) =>
        row.tokenSource === "dispatch" && sameEmail(row.email, accountEmail),
    );
    if (existing) {
      if (existing.status !== status) {
        await db
          .update(schema.calendarAccounts)
          .set({ status, lastSyncError: null, updatedAt: now })
          .where(eq(schema.calendarAccounts.id, existing.id));
      }
      continue;
    }
    orgId ??= await getActiveOrganizationId().catch(() => null);
    await db.insert(schema.calendarAccounts).values({
      id: randomUUID(),
      provider: "google",
      externalAccountId: accountEmail,
      accessTokenSecretRef: null,
      refreshTokenSecretRef: null,
      tokenSource: "dispatch",
      displayName: accountEmail,
      email: accountEmail,
      status,
      lastSyncedAt: null,
      lastSyncError: null,
      createdAt: now,
      updatedAt: now,
      ownerEmail: owner,
      orgId: orgId ?? null,
      visibility: "private",
    } as any);
  }

  // Dispatch no longer grants these to Clips (disconnected there, or the
  // grant was removed), so they stop being read.
  for (const row of rows) {
    if (
      row.tokenSource === "dispatch" &&
      row.status !== "disconnected" &&
      !granted.has((row.email ?? "").toLowerCase())
    ) {
      await db
        .update(schema.calendarAccounts)
        .set({ status: "disconnected", updatedAt: now })
        .where(eq(schema.calendarAccounts.id, row.id));
    }
  }
}

/**
 * Brings this person's Dispatch-held calendar accounts into
 * `calendar_accounts`. A no-op when no account hub is configured.
 */
export async function syncDispatchCalendarAccounts(
  ownerEmail: string | null | undefined,
  options: { force?: boolean } = {},
): Promise<void> {
  if (!ownerEmail || !isGoogleAccountHubConfigured()) return;
  const owner = normalizeOwnerEmail(ownerEmail);
  const pending = syncsInFlight.get(owner);
  if (pending) return pending;
  if (
    !options.force &&
    Date.now() - (lastSyncedAt.get(owner) ?? 0) < SYNC_INTERVAL_MS
  ) {
    return;
  }
  const sync = syncOwner(owner)
    .then(() => {
      lastSyncedAt.set(owner, Date.now());
    })
    .finally(() => {
      syncsInFlight.delete(owner);
    });
  syncsInFlight.set(owner, sync);
  return sync;
}

/** A short-lived access token for a Dispatch-held account, or null. */
export async function resolveDispatchCalendarAccessToken(account: {
  ownerEmail?: string | null;
  email?: string | null;
}): Promise<string | null> {
  if (!account.ownerEmail || !account.email) return null;
  const hubAccount = await getHubGoogleAccount({
    appId: CLIPS_GOOGLE_OAUTH_APP_ID,
    userEmail: account.ownerEmail,
    provider: HUB_PROVIDER,
    accountEmail: account.email,
  });
  return hubAccount?.accessToken ?? null;
}
