import {
  clearGmailQuotaCooldownAfterSuccess,
  recordGmailQuotaCooldown,
  reserveGmailQuota,
  type GmailQuotaLane,
} from "./inbox-store.js";

export type { GmailQuotaLane } from "./inbox-store.js";

type GmailQuotaAccount = { ownerEmail: string; accountEmail: string };

const accountsByToken = new Map<string, GmailQuotaAccount>();
const tokenByRegistration = new Map<string, string>();
const registrationsByToken = new Map<string, Set<string>>();

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
): void {
  const owner = ownerEmail.toLowerCase();
  const account = accountEmail.toLowerCase();
  const registration = `${owner}:${account}`;
  const previousToken = tokenByRegistration.get(registration);
  if (previousToken && previousToken !== accessToken) {
    const registrations = registrationsByToken.get(previousToken);
    registrations?.delete(registration);
    if (!registrations?.size) {
      registrationsByToken.delete(previousToken);
      accountsByToken.delete(previousToken);
    }
  }
  tokenByRegistration.set(registration, accessToken);
  const registrations = registrationsByToken.get(accessToken) ?? new Set();
  registrations.add(registration);
  registrationsByToken.set(accessToken, registrations);
  accountsByToken.set(accessToken, {
    ownerEmail: owner,
    accountEmail: account,
  });
}

function accountForToken(accessToken: string): GmailQuotaAccount {
  const account = accountsByToken.get(accessToken);
  if (!account) {
    throw new GmailQuotaAccountUnavailableError();
  }
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
  const account = accountsByToken.get(accessToken);
  if (!account) return;
  await clearGmailQuotaCooldownAfterSuccess(account.accountEmail);
}
