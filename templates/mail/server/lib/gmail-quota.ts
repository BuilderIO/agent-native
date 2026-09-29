import { createHash } from "node:crypto";

import {
  clearGmailQuotaCooldownAfterSuccess,
  recordGmailQuotaCooldown,
  reserveGmailQuota,
  type GmailQuotaLane,
} from "./inbox-store.js";

export type { GmailQuotaLane } from "./inbox-store.js";

type GmailQuotaAccount = {
  ownerEmail: string;
  accountEmail: string;
  expiresAt: number;
};

const accountsByToken = new Map<string, GmailQuotaAccount>();

function tokenKey(accessToken: string): string {
  return createHash("sha256").update(accessToken).digest("hex");
}

function pruneExpiredAccounts(now: number): void {
  for (const [key, account] of accountsByToken) {
    if (account.expiresAt <= now) accountsByToken.delete(key);
  }
}

export class GmailQuotaAccountUnavailableError extends Error {
  constructor() {
    super("Gmail quota account is unavailable for this token");
    this.name = "GmailQuotaAccountUnavailableError";
  }
}

export function registerGmailAccountToken(
  accessToken: string,
  ownerEmail: string,
  accountEmail: string,
  expiresAt = Date.now() + 60 * 60_000,
): void {
  const owner = ownerEmail.toLowerCase();
  const account = accountEmail.toLowerCase();
  const now = Date.now();
  pruneExpiredAccounts(now);
  if (expiresAt <= now) return;
  accountsByToken.set(tokenKey(accessToken), {
    ownerEmail: owner,
    accountEmail: account,
    expiresAt,
  });
}

function registeredAccountForToken(
  accessToken: string,
): GmailQuotaAccount | undefined {
  pruneExpiredAccounts(Date.now());
  return accountsByToken.get(tokenKey(accessToken));
}

function accountForToken(accessToken: string): GmailQuotaAccount {
  const account = registeredAccountForToken(accessToken);
  if (!account) throw new GmailQuotaAccountUnavailableError();
  return account;
}

export class GmailQuotaCooldownError extends Error {
  readonly retryAfterMs: number;
  readonly statusCode = 429;
  readonly errorCode = "gmail_quota_cooldown";
  readonly details: { retryAfterSeconds: number };

  constructor(messageOrRetryAfterMs: string | number, retryAfterMs?: number) {
    const waitMs =
      typeof messageOrRetryAfterMs === "number"
        ? messageOrRetryAfterMs
        : (retryAfterMs ?? 1_000);
    super(
      typeof messageOrRetryAfterMs === "string"
        ? messageOrRetryAfterMs
        : `Email service is briefly busy and will be ready again in about ${Math.ceil(waitMs / 1000)}s.`,
    );
    this.name = "GmailQuotaCooldownError";
    this.retryAfterMs = waitMs;
    this.details = {
      retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)),
    };
  }
}

export async function acquireGmailQuota(
  accessToken: string,
  units: number,
  lane: GmailQuotaLane,
): Promise<boolean> {
  const account = accountForToken(accessToken);
  const reservation = await reserveGmailQuota(
    account.ownerEmail,
    account.accountEmail,
    units,
    lane,
  );
  if (reservation.retryAfterMs > 0) {
    throw new GmailQuotaCooldownError(reservation.retryAfterMs);
  }
  return reservation.quotaCooldownAttempts > 0;
}

export async function tripGmailQuotaCooldown(
  accessToken: string,
  retryAfterMs?: number,
): Promise<number> {
  const account = accountForToken(accessToken);
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
  const account = registeredAccountForToken(accessToken);
  if (!account) return;
  await clearGmailQuotaCooldownAfterSuccess(account.accountEmail);
}
