/**
 * Legacy abuse mitigation for hosted guest authoring.
 *
 * Older hosted deploys minted a stable `guest-<uuid>@agent-native.guest`
 * identity for an unauthenticated visitor (see `resolvePlanGuestAuthorOwner` in
 * `./public-plans.ts`). This module is retained for legacy helpers/tests and as
 * a guard if a guest identity reaches a create path.
 *
 * This module adds three additive, dialect-agnostic guards. EVERY guard is a
 * no-op unless the resolved owner is a guest identity (`isGuestAuthorIdentity`),
 * so authenticated real users and local single-user mode keep byte-identical
 * behavior:
 *
 *   1. Per-guest plan cap — a single guest identity may OWN at most N plans at
 *      once (`assertGuestCreateWithinLimits`). Deleting a plan frees a slot, so
 *      this bounds rows-per-identity rather than blocking forever.
 *   2. Per-IP mint rate limit — minting a NEW guest identity is rate-limited per
 *      client IP per window (`tryConsumeGuestMint`). Cookies are
 *      attacker-controlled, so we rate-limit at the one chokepoint every new
 *      identity must pass through: the cookie mint. Established guests (valid
 *      cookie) never hit this, so normal browsing is unaffected.
 *   3. Global anonymous-create throttle — a backstop cap on total guest plan
 *      creations across all IPs per window (`assertGuestCreateWithinLimits`),
 *      which catches `X-Forwarded-For` spoofing that evades the per-IP limit.
 *
 * State is SQL-backed (not an in-memory map) so the limits hold across
 * serverless cold starts and concurrent frozen instances — an in-memory counter
 * would reset per instance, making the real ceiling `limit × instances`.
 *
 * All checks FAIL OPEN on a database error: a transient DB hiccup must never
 * block a legitimate guest. The global throttle is the backstop for the rare
 * window where a per-row check could not run.
 */
import { createHash, randomUUID } from "node:crypto";

import { getDbExec } from "@agent-native/core/db";
import { getHeader, getRequestIP, type H3Event } from "h3";

import {
  GUEST_AUTHOR_DOMAIN,
  isGuestAuthorIdentity,
} from "./local-identity.js";

const HOUR_MS = 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * HOUR_MS;

/**
 * Read a non-negative integer from the environment, clamped to [min, max].
 * Blank/missing/non-integer values fall back to `fallback` so a typo can never
 * silently disable a guard or set an absurd limit.
 */
function intEnv(
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Master escape hatch. When set, every guard short-circuits to "allowed" so the
 * abuse mitigation can be disabled wholesale (e.g. for load testing) without a
 * code change. Defaults to OFF (guards active).
 */
export function guestAbuseDisabled(): boolean {
  return /^(1|true)$/i.test(process.env.PLAN_GUEST_ABUSE_DISABLED ?? "");
}

/** Max plans a single guest identity may own at once. */
function guestMaxPlans(): number {
  return intEnv("PLAN_GUEST_MAX_PLANS", 25, 1, 1_000_000);
}
/** Max NEW guest identities a single client IP may mint per mint window. */
function guestMintLimit(): number {
  return intEnv("PLAN_GUEST_MINT_LIMIT", 30, 1, 1_000_000);
}
function guestMintWindowMs(): number {
  return intEnv("PLAN_GUEST_MINT_WINDOW_MS", HOUR_MS, 1_000, THIRTY_DAYS_MS);
}
/** Backstop cap on total guest plan creations across all IPs per window. */
function guestGlobalLimit(): number {
  return intEnv("PLAN_GUEST_GLOBAL_CREATE_LIMIT", 500, 1, 100_000_000);
}
function guestGlobalWindowMs(): number {
  return intEnv("PLAN_GUEST_GLOBAL_WINDOW_MS", HOUR_MS, 1_000, THIRTY_DAYS_MS);
}

/**
 * Error thrown when a guest hits a create limit. The `statusCode` makes the
 * action route reply 429 and echo the (user-safe) message instead of a generic
 * 500 — see the `statusCode < 500` branch in `action-routes.ts`.
 */
export class GuestAbuseLimitError extends Error {
  readonly statusCode = 429;
  constructor(message: string) {
    super(message);
    this.name = "GuestAbuseLimitError";
  }
}

/**
 * Best-effort client IP for rate limiting. Prefers the trusted edge headers set
 * by the hosting platform (the platform overwrites these, so a remote client
 * cannot spoof them), then the left-most `X-Forwarded-For` entry, then the raw
 * socket peer. This is a rate-limit signal, NOT an auth boundary: spoofing only
 * shifts an attacker into a different per-IP bucket, which the global throttle
 * still backstops.
 */
export function getClientIpFromEvent(event: H3Event): string | undefined {
  const trusted =
    getHeader(event, "x-nf-client-connection-ip") ?? // Netlify
    getHeader(event, "cf-connecting-ip") ?? // Cloudflare
    getHeader(event, "true-client-ip") ?? // Akamai / CF Enterprise
    getHeader(event, "x-real-ip"); // common reverse proxies
  if (trusted && trusted.trim()) return trusted.trim();

  const xff = getHeader(event, "x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }

  try {
    const peer = getRequestIP(event);
    if (peer) return peer;
  } catch {
    // getRequestIP can throw on runtimes without a node socket; ignore.
  }
  return undefined;
}

/**
 * sha256 of the client IP (hex). Stored instead of the raw IP so the
 * short-lived abuse-mitigation rows do not persist plaintext client addresses.
 * This is pseudonymization for de-identification, not secret-keyed — the
 * rate-limiter only needs a stable equality key, not irreversibility. A missing
 * IP buckets under a shared `unknown` key (conservatively shared, never
 * fail-open).
 */
function hashIp(ip: string | undefined): string {
  return createHash("sha256")
    .update(ip && ip.length ? ip : "unknown")
    .digest("hex");
}

function isoAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

async function countRows(
  sql: string,
  args: Array<string | number | null>,
): Promise<number | null> {
  try {
    const { rows } = await getDbExec().execute({ sql, args });
    const row = rows[0] as Record<string, unknown> | undefined;
    return Number(row?.n ?? 0);
  } catch {
    // Fail open: a transient DB error must not block a legitimate guest.
    return null;
  }
}

/**
 * Consume one mint slot for the request's client IP. Returns `true` when a NEW
 * guest identity may be minted (and records the mint), `false` when the per-IP
 * mint budget for the window is exhausted.
 *
 * Call this ONLY when actually about to mint a new identity (no valid existing
 * cookie) — established guests must not consume mint budget. Counting and
 * recording are intentionally non-atomic (a small over-count under concurrency
 * is acceptable for a rate limiter).
 */
export async function tryConsumeGuestMint(event: H3Event): Promise<boolean> {
  if (guestAbuseDisabled()) return true;

  const ipHash = hashIp(getClientIpFromEvent(event));
  const windowMs = guestMintWindowMs();
  const cutoff = isoAgo(windowMs);

  const count = await countRows(
    `SELECT COUNT(*) AS n FROM plan_guest_mints WHERE ip_hash = ? AND created_at > ?`,
    [ipHash, cutoff],
  );
  // countRows returned null => DB error => fail open.
  if (count !== null && count >= guestMintLimit()) return false;

  try {
    const db = getDbExec();
    await db.execute({
      sql: `INSERT INTO plan_guest_mints (id, ip_hash, created_at) VALUES (?, ?, ?)`,
      args: [randomUUID(), ipHash, new Date().toISOString()],
    });
    // Opportunistic prune of expired rows to bound table growth. Best-effort.
    await db.execute({
      sql: `DELETE FROM plan_guest_mints WHERE created_at < ?`,
      args: [cutoff],
    });
  } catch {
    // Recording failed; still allow the mint (fail open).
  }
  return true;
}

/**
 * Enforce the per-guest plan cap and the global anonymous-create throttle at
 * the top of every plan-create action. No-op for non-guest owners (real users
 * and local mode), so their behavior is byte-identical.
 *
 * Throws {@link GuestAbuseLimitError} (HTTP 429) when a limit is exceeded.
 */
export async function assertGuestCreateWithinLimits(
  ownerEmail: string,
): Promise<void> {
  if (guestAbuseDisabled()) return;
  if (!isGuestAuthorIdentity(ownerEmail)) return;

  // 1. Per-guest ownership cap. Bounds the rows a single identity can hold.
  const owned = await countRows(
    `SELECT COUNT(*) AS n FROM plans WHERE owner_email = ?`,
    [ownerEmail],
  );
  const maxPlans = guestMaxPlans();
  if (owned !== null && owned >= maxPlans) {
    throw new GuestAbuseLimitError(
      `Guest plan limit reached (${maxPlans} plans). Sign in to create and keep more plans, or delete an existing guest plan first.`,
    );
  }

  // 2. Global anonymous-create throttle (backstop for IP-spoofing / cookie
  //    rotation). Counts guest-owned plans created within the window.
  const recent = await countRows(
    `SELECT COUNT(*) AS n FROM plans WHERE owner_email LIKE ? AND created_at > ?`,
    [`guest-%@${GUEST_AUTHOR_DOMAIN}`, isoAgo(guestGlobalWindowMs())],
  );
  if (recent !== null && recent >= guestGlobalLimit()) {
    throw new GuestAbuseLimitError(
      `Too many guest plans are being created right now. Please sign in, or try again shortly.`,
    );
  }
}
