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
const SYNC_INTERVAL_MS = 60_000;

type HubAccountStatus = "connected" | "needs-reauth";

const lastSyncedAt = new Map<string, number>();
const syncsInFlight = new Map<string, Promise<void>>();

function sameEmail(a: string | null | undefined, b: string): boolean {
  return (
    typeof a === "string" && a.trim().toLowerCase() === b.trim().toLowerCase()
  );
}

async function grantedHubAccounts(
  owner: string,
): Promise<Map<string, HubAccountStatus> | null> {
  try {
    const { accounts, errors } = await listHubGoogleAccounts({
      appId: CLIPS_GOOGLE_OAUTH_APP_ID,
      userEmail: owner,
      provider: HUB_PROVIDER,
    });
    const granted = new Map<string, HubAccountStatus>();
    for (const error of errors) {
      granted.set(error.accountEmail.toLowerCase(), "needs-reauth");
    }
    for (const account of accounts) {
      granted.set(account.accountEmail.toLowerCase(), "connected");
    }
    return granted;
  } catch (error) {
    console.warn(
      "[clips] Google account hub unavailable:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

async function syncOwner(owner: string): Promise<void> {
  const granted = await grantedHubAccounts(owner);
  if (!granted) return;

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
        row.managedBy !== "dispatch" &&
        row.status === "connected" &&
        sameEmail(row.email, accountEmail),
    );
    if (ownConnection) continue;
    const existing = rows.find(
      (row) =>
        row.managedBy === "dispatch" && sameEmail(row.email, accountEmail),
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
    orgId ??= await getActiveOrganizationId();
    const values: typeof schema.calendarAccounts.$inferInsert = {
      id: randomUUID(),
      provider: "google",
      externalAccountId: accountEmail,
      accessTokenSecretRef: null,
      refreshTokenSecretRef: null,
      managedBy: "dispatch",
      displayName: accountEmail,
      email: accountEmail,
      status,
      lastSyncedAt: null,
      lastSyncError: null,
      createdAt: now,
      updatedAt: now,
      ownerEmail: owner,
      orgId,
      visibility: "private",
    };
    await db.insert(schema.calendarAccounts).values(values);
  }

  for (const row of rows) {
    if (
      row.managedBy === "dispatch" &&
      row.status !== "disconnected" &&
      !(row.email && granted.has(row.email.toLowerCase()))
    ) {
      await db
        .update(schema.calendarAccounts)
        .set({ status: "disconnected", updatedAt: now })
        .where(eq(schema.calendarAccounts.id, row.id));
    }
  }
}

export async function syncDispatchCalendarAccounts(
  ownerEmail: string | null | undefined,
  options: { force?: boolean } = {},
): Promise<void> {
  if (!ownerEmail || !isGoogleAccountHubConfigured()) return;
  const owner = normalizeOwnerEmail(ownerEmail);
  const pending = syncsInFlight.get(owner);
  if (pending) return pending;
  const last = lastSyncedAt.get(owner);
  if (
    !options.force &&
    last !== undefined &&
    Date.now() - last < SYNC_INTERVAL_MS
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
