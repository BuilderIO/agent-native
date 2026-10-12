import { createHash } from "node:crypto";

import { countOutcome } from "@agent-native/core/tracking";
import {
  GMAIL_QUOTA_COOLDOWN_ERROR_CODE,
  type GmailCooldownBody,
} from "@shared/gmail-freshness.js";

import {
  clearGmailQuotaCooldownAfterSuccess,
  readGmailQuotaCooldowns,
  readGmailTokenAccount,
  recordGmailQuotaCooldown,
  reserveGmailQuota,
  saveGmailTokenAccount,
  type GmailQuotaLane,
} from "./inbox-store.js";

export type { GmailQuotaLane } from "./inbox-store.js";

/**
 * Where a Gmail cooldown reached someone, as a per-minute count
 * (`gmail_cooldown_counts`): Gmail answered 429 (`tripped`), a read was refused
 * locally (`rejected_local`, `rejected_agent_precheck`), or a list was answered
 * from the synced store (`served_cached`, with its freshness) or with the typed
 * 429 (`typed_429`). Counts only: never accounts, tokens or addresses.
 */
export type GmailCooldownSite =
  | "tripped"
  | "rejected_local"
  | "rejected_agent_precheck"
  | "served_cached"
  | "typed_429";

export function countGmailCooldown(
  site: GmailCooldownSite,
  freshness?: "cached" | "stale",
): void {
  countOutcome("gmail_cooldown_counts", { site, freshness });
}

type GmailQuotaAccount = {
  ownerEmail: string;
  accountEmail: string;
  expiresAt: number;
};

// Read-through cache of mail_gmail_token_accounts, never the source of truth:
// a miss reads the table, so a cold or different serverless instance resolves a
// token exactly as the instance that obtained it does.
const accountsByToken = new Map<string, GmailQuotaAccount>();
const TOKEN_REGISTRATION_REFRESH_MS = 10 * 60_000;

function tokenKey(accessToken: string): string {
  return createHash("sha256").update(accessToken).digest("hex");
}

function pruneExpiredAccounts(now: number): void {
  for (const [key, account] of accountsByToken) {
    if (account.expiresAt <= now) accountsByToken.delete(key);
  }
}

/**
 * The token was never registered anywhere (not on this instance, not in the
 * table), so its quota budget cannot be named. That is a caller bug, not an
 * instance-affinity accident, and it stays a loud 500.
 */
export class GmailQuotaAccountUnavailableError extends Error {
  readonly errorCode = "gmail_quota_account_unresolved";

  constructor() {
    super("Gmail quota account is unavailable for this token");
    this.name = "GmailQuotaAccountUnavailableError";
  }
}

export async function registerGmailAccountToken(
  accessToken: string,
  ownerEmail: string,
  accountEmail: string,
  expiresAt = Date.now() + 60 * 60_000,
): Promise<void> {
  const owner = ownerEmail.toLowerCase();
  const account = accountEmail.toLowerCase();
  const now = Date.now();
  pruneExpiredAccounts(now);
  if (expiresAt <= now) return;
  const key = tokenKey(accessToken);
  const known = accountsByToken.get(key);
  // A token is handed out on every request, often with no real expiry, so the
  // default grows each call. Persist only a new or changed mapping, or one
  // whose stored row is about to lapse, never once per Gmail call.
  if (
    known &&
    known.ownerEmail === owner &&
    known.accountEmail === account &&
    known.expiresAt >= Math.min(expiresAt, now + TOKEN_REGISTRATION_REFRESH_MS)
  ) {
    return;
  }
  const entry = { ownerEmail: owner, accountEmail: account, expiresAt };
  accountsByToken.set(key, entry);
  try {
    await saveGmailTokenAccount(key, entry, now);
  } catch (error) {
    // Not persisted means other instances cannot resolve it: retry next time.
    accountsByToken.delete(key);
    throw error;
  }
}

async function accountForToken(
  accessToken: string,
): Promise<GmailQuotaAccount> {
  const account = await resolveAccountForToken(accessToken);
  if (!account) throw new GmailQuotaAccountUnavailableError();
  return account;
}

async function resolveAccountForToken(
  accessToken: string,
): Promise<GmailQuotaAccount | undefined> {
  const now = Date.now();
  pruneExpiredAccounts(now);
  const key = tokenKey(accessToken);
  const cached = accountsByToken.get(key);
  if (cached) return cached;
  const stored = await readGmailTokenAccount(key, now);
  if (stored) accountsByToken.set(key, stored);
  return stored;
}

// Read by the model as the tool result: it must not call Gmail again sooner.
const COOLDOWN_GUIDANCE = "Do not retry before then.";

/**
 * A Gmail cooldown as a typed value. It travels through every action boundary
 * as a contract error (`actionContractError`) carrying `errorCode`, HTTP 429 and
 * `details.retryAfterMs`/`cooldownUntil`, so the UI shows what it already has
 * and the agent is told when to stop, instead of each caller re-deriving it
 * from message text.
 */
export class GmailQuotaCooldownError extends Error {
  readonly actionContractError = true;
  readonly retryAfterMs: number;
  readonly cooldownUntil: number;
  readonly statusCode = 429;
  readonly errorCode = GMAIL_QUOTA_COOLDOWN_ERROR_CODE;
  readonly details: {
    retryAfterSeconds: number;
    retryAfterMs: number;
    cooldownUntil: number;
  };

  constructor(
    messageOrRetryAfterMs: string | number,
    retryAfterMs?: number,
    now = Date.now(),
  ) {
    const waitMs = Math.max(
      1,
      typeof messageOrRetryAfterMs === "number"
        ? messageOrRetryAfterMs
        : (retryAfterMs ?? 1_000),
    );
    const seconds = Math.max(1, Math.ceil(waitMs / 1000));
    super(
      typeof messageOrRetryAfterMs === "string"
        ? messageOrRetryAfterMs
        : `Email service is briefly busy and will be ready again in about ${seconds}s. ${COOLDOWN_GUIDANCE}`,
    );
    this.name = "GmailQuotaCooldownError";
    this.retryAfterMs = waitMs;
    this.cooldownUntil = now + waitMs;
    this.details = {
      retryAfterSeconds: seconds,
      retryAfterMs: waitMs,
      cooldownUntil: this.cooldownUntil,
    };
  }
}

export function gmailCooldownBody(
  error: GmailQuotaCooldownError,
): GmailCooldownBody {
  return {
    errorCode: GMAIL_QUOTA_COOLDOWN_ERROR_CODE,
    retryAfterMs: error.retryAfterMs,
    cooldownUntil: error.cooldownUntil,
  };
}

export type GmailCooldownSnapshot = {
  cooldownUntil: number;
  retryAfterMs: number;
  /** Every requested account is cooling down, so no live read can succeed. */
  allAccounts: boolean;
};

export function summarizeGmailCooldowns(
  cooldowns: ReadonlyMap<string, number>,
  accountEmails: readonly string[],
  now = Date.now(),
): GmailCooldownSnapshot | null {
  const requested = new Set(accountEmails.map((email) => email.toLowerCase()));
  const cooling = [...cooldowns]
    .filter(([account]) => requested.has(account.toLowerCase()))
    .map(([, until]) => until);
  if (cooling.length === 0) return null;
  const cooldownUntil = Math.max(...cooling);
  return {
    cooldownUntil,
    retryAfterMs: Math.max(1, cooldownUntil - now),
    allAccounts: cooling.length >= requested.size,
  };
}

/**
 * Reads the persisted cooldown for these accounts without reserving quota or
 * touching Gmail. Null when nothing is cooling down.
 */
export async function readGmailCooldown(
  accountEmails: readonly string[],
  now = Date.now(),
): Promise<GmailCooldownSnapshot | null> {
  if (accountEmails.length === 0) return null;
  const cooldowns = await readGmailQuotaCooldowns({ accountEmails }, now);
  return summarizeGmailCooldowns(cooldowns, accountEmails, now);
}

/** Accounts of this owner that are cooling down, in one indexed read. */
export function readOwnerGmailCooldowns(
  ownerEmail: string,
  now = Date.now(),
): Promise<Map<string, number>> {
  return readGmailQuotaCooldowns({ ownerEmail }, now);
}

/**
 * Rejects locally, with the same typed error a Gmail 429 produces, when every
 * account is already cooling down. Repeat calls inside the window cost one
 * indexed read and never reach Gmail.
 */
export async function assertGmailNotCoolingDown(
  accountEmails: readonly string[],
): Promise<void> {
  const now = Date.now();
  const cooldown = await readGmailCooldown(accountEmails, now);
  if (cooldown?.allAccounts) {
    countGmailCooldown("rejected_agent_precheck");
    throw new GmailQuotaCooldownError(cooldown.retryAfterMs, undefined, now);
  }
}

export async function acquireGmailQuota(
  accessToken: string,
  units: number,
  lane: GmailQuotaLane,
): Promise<boolean> {
  const account = await accountForToken(accessToken);
  const reservation = await reserveGmailQuota(
    account.ownerEmail,
    account.accountEmail,
    units,
    lane,
  );
  if (reservation.retryAfterMs > 0) {
    countGmailCooldown("rejected_local");
    throw new GmailQuotaCooldownError(reservation.retryAfterMs);
  }
  return reservation.quotaCooldownAttempts > 0;
}

export async function tripGmailQuotaCooldown(
  accessToken: string,
  retryAfterMs?: number,
): Promise<number> {
  const account = await accountForToken(accessToken);
  countGmailCooldown("tripped");
  return recordGmailQuotaCooldown(
    account.ownerEmail,
    account.accountEmail,
    retryAfterMs,
  );
}

export async function markGmailQuotaSuccess(
  accessToken: string,
  shouldClearCooldown: boolean,
): Promise<void> {
  if (!shouldClearCooldown) return;
  const account = await resolveAccountForToken(accessToken);
  if (!account) return;
  await clearGmailQuotaCooldownAfterSuccess(account.accountEmail);
}
