import { createHmac, timingSafeEqual } from "node:crypto";

import {
  defineEventHandler,
  getMethod,
  setResponseHeader,
  setResponseStatus,
} from "h3";
import type { H3Event } from "h3";

import { getAppConfig } from "../app-config/index.js";
import { routeAuditAttribution } from "../audit/attribution.js";
import { recordActionAudit } from "../audit/record.js";
import { getDbExec } from "../db/client.js";
import { sql } from "../db/sql.js";
import { defineStore } from "../db/store-registry.js";
import { getRequiredAuthProviderForEmail } from "../org/auth-policy.js";
import { isDeploymentEmailDomainAllowed } from "../org/signup-admission.js";
import {
  getBetterAuthInternalAdapter,
  type BetterAuthConfig,
} from "./better-auth-instance.js";
import { captureError } from "./capture-error.js";
import { getClientIp } from "./client-ip.js";
import { readBodyWithSizeLimit } from "./h3-helpers.js";
import { RUNNER_SESSION_LABEL } from "./runner-session-label.js";

export const RUNNER_SESSION_PATH = "/_agent-native/auth/runner-session";

const SIGNATURE_CONTEXT = "agent-native-runner-session:v1";
const MAX_CLOCK_SKEW_MS = 120_000;
const SESSION_TTL_MS = 2 * 60 * 60_000;
const NONCE_RETENTION_MS = 5 * 60_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_PRUNE_SIZE = 10_000;
const MAX_BODY_BYTES = 4096;
const MAX_EMAIL_LENGTH = 320;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const SIGNATURE_PATTERN = /^[0-9a-f]{1,128}$/;

export const runnerSessionNoncesStore = defineStore({
  id: "runner_session_nonces",
  migrations: [
    {
      name: "baseline",
      sql: `CREATE TABLE IF NOT EXISTS runner_session_nonces (
      nonce TEXT PRIMARY KEY,
      created_at BIGINT NOT NULL,
      expires_at BIGINT NOT NULL
    )`,
    },
    {
      name: "expiry-index",
      sql: `CREATE INDEX IF NOT EXISTS runner_session_nonces_expires_at_idx ON runner_session_nonces (expires_at)`,
    },
  ],
});

type RunnerSessionErrorCode =
  | "runner_session_disabled"
  | "invalid_request"
  | "rate_limited"
  | "email_not_allowed"
  | "stale_timestamp"
  | "bad_signature"
  | "nonce_reused"
  | "user_not_found"
  | "sign_in_provider_required"
  | "runner_session_unavailable";

interface RunnerSessionRequest {
  email: string;
  ts: number;
  nonce: string;
  sig: string;
}

export interface RunnerSessionRouteOptions {
  betterAuthConfig?: BetterAuthConfig;
  /** Stages the cookies an ordinary sign-in sets for `token`. */
  setSignInCookies: (event: H3Event, token: string) => void;
}

const rateLimitHits = new Map<string, { count: number; resetAt: number }>();

function takeRateLimitSlot(
  key: string,
  now: number,
): { ok: true } | { ok: false; retryAfterSeconds: number } {
  const entry = rateLimitHits.get(key);
  if (!entry || entry.resetAt <= now) {
    if (rateLimitHits.size >= RATE_LIMIT_PRUNE_SIZE) {
      for (const [hitKey, hit] of rateLimitHits) {
        if (hit.resetAt <= now) rateLimitHits.delete(hitKey);
      }
    }
    rateLimitHits.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { ok: true };
  }
  if (entry.count >= RATE_LIMIT_MAX) {
    return {
      ok: false,
      retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
    };
  }
  entry.count += 1;
  return { ok: true };
}

export function resetRunnerSessionRateLimitForTests(): void {
  rateLimitHits.clear();
}

function parseRunnerSessionRequest(body: unknown): RunnerSessionRequest | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const { email, ts, nonce, sig } = body as Record<string, unknown>;
  if (typeof email !== "string" || typeof nonce !== "string") return null;
  if (typeof sig !== "string" || typeof ts !== "number") return null;
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || normalizedEmail.length > MAX_EMAIL_LENGTH) {
    return null;
  }
  if (!Number.isSafeInteger(ts) || ts <= 0) return null;
  if (!NONCE_PATTERN.test(nonce) || !SIGNATURE_PATTERN.test(sig)) return null;
  return { email: normalizedEmail, ts, nonce, sig };
}

function signatureMatches(
  secret: string,
  request: RunnerSessionRequest,
): boolean {
  const expected = createHmac("sha256", secret)
    .update(
      `${SIGNATURE_CONTEXT}\n${request.email}\n${request.ts}\n${request.nonce}`,
      "utf8",
    )
    .digest();
  const presented = Buffer.from(request.sig, "hex");
  return (
    presented.length === expected.length && timingSafeEqual(presented, expected)
  );
}

async function consumeNonce(nonce: string, now: number): Promise<boolean> {
  await runnerSessionNoncesStore.ready();
  const { rows } = await getDbExec().execute(sql`
    INSERT INTO runner_session_nonces (nonce, created_at, expires_at)
    VALUES (${sql.value(nonce)}, ${sql.value(now)}, ${sql.value(now + NONCE_RETENTION_MS)})
    ON CONFLICT (nonce) DO NOTHING
    RETURNING nonce`);
  return rows.length === 1;
}

async function pruneExpiredNonces(now: number): Promise<void> {
  try {
    await getDbExec().execute(
      sql`DELETE FROM runner_session_nonces WHERE expires_at < ${sql.value(now)}`,
    );
  } catch (error) {
    console.warn("[auth] could not prune expired runner session nonces", error);
  }
}

function reject(
  event: H3Event,
  status: number,
  code: RunnerSessionErrorCode,
  message: string,
) {
  setResponseStatus(event, status);
  return { error: { code, message } };
}

async function recordRunnerSessionAudit(
  event: H3Event,
  input: {
    email: string;
    ip: string | undefined;
    outcome: "ok" | RunnerSessionErrorCode;
    owner: string | undefined;
  },
): Promise<void> {
  const ok = input.outcome === "ok";
  await recordActionAudit({
    config: {
      enabled: true,
      target: () => ({ type: "auth-session", visibility: "private" }),
      summary: () =>
        ok
          ? "Signed in through the test-runner route"
          : `Refused a test-runner sign-in: ${input.outcome}`,
    },
    args: {
      email: input.email,
      ip: input.ip ?? null,
      outcome: input.outcome,
      label: RUNNER_SESSION_LABEL,
    },
    ctx: {
      actionName: "runner-session-sign-in",
      ...(input.owner ? { userEmail: input.owner } : {}),
    },
    attribution: routeAuditAttribution(event),
    status: ok
      ? "success"
      : input.outcome === "runner_session_unavailable"
        ? "error"
        : "denied",
  });
}

export function createRunnerSessionHandler(options: RunnerSessionRouteOptions) {
  return defineEventHandler(async (event) => {
    setResponseHeader(event, "Cache-Control", "no-store");
    const {
      runnerSessionSecret: secret,
      runnerSessionAllowedEmails: allowedEmails,
    } = getAppConfig().auth;
    if (!secret || allowedEmails.length === 0) {
      return reject(event, 404, "runner_session_disabled", "Not found.");
    }

    const now = Date.now();
    const ip = getClientIp(event);
    const slot = takeRateLimitSlot(ip ?? "unknown", now);
    if (!slot.ok) {
      setResponseHeader(event, "Retry-After", String(slot.retryAfterSeconds));
      return reject(event, 429, "rate_limited", "Too many sign-in attempts.");
    }

    if (getMethod(event) !== "POST") {
      setResponseHeader(event, "Allow", "POST");
      return reject(event, 405, "invalid_request", "Use POST.");
    }
    let body: unknown;
    try {
      body = await readBodyWithSizeLimit(event, MAX_BODY_BYTES);
    } catch {
      return reject(event, 400, "invalid_request", "Body must be JSON.");
    }
    const request = parseRunnerSessionRequest(body);
    if (!request) {
      return reject(
        event,
        400,
        "invalid_request",
        "Expected email, ts, nonce, and sig.",
      );
    }

    const { email } = request;
    const refuse = async (
      status: number,
      code: RunnerSessionErrorCode,
      message: string,
      owner: string | undefined = email,
    ) => {
      await recordRunnerSessionAudit(event, {
        email,
        ip,
        outcome: code,
        owner,
      });
      return reject(event, status, code, message);
    };

    if (
      !allowedEmails.includes(email) ||
      !isDeploymentEmailDomainAllowed(email)
    ) {
      return refuse(
        403,
        "email_not_allowed",
        "Email is not allowed.",
        undefined,
      );
    }
    if (Math.abs(now - request.ts) >= MAX_CLOCK_SKEW_MS) {
      return refuse(401, "stale_timestamp", "Timestamp is out of range.");
    }
    if (!signatureMatches(secret, request)) {
      return refuse(401, "bad_signature", "Signature does not match.");
    }

    try {
      if (!(await consumeNonce(request.nonce, now))) {
        return refuse(409, "nonce_reused", "Nonce was already used.");
      }

      const adapter = await getBetterAuthInternalAdapter(
        options.betterAuthConfig,
      );
      if (!adapter) throw new Error("Better Auth is unavailable.");
      const existing = await adapter.findUserByEmail(email, {
        includeAccounts: false,
      });
      if (!existing) {
        return refuse(403, "user_not_found", "No account has this email.");
      }
      if (await getRequiredAuthProviderForEmail(email)) {
        return refuse(
          403,
          "sign_in_provider_required",
          "This account's organization requires provider sign-in.",
        );
      }

      const expiresAt = new Date(now + SESSION_TTL_MS);
      const session = await adapter.createSession(
        existing.user.id,
        true,
        { expiresAt, userAgent: RUNNER_SESSION_LABEL, ipAddress: ip ?? "" },
        true,
      );
      if (!session.token) throw new Error("Better Auth created no session.");

      options.setSignInCookies(event, session.token);
      setResponseHeader(event, "Referrer-Policy", "no-referrer");
      await pruneExpiredNonces(now);
      await recordRunnerSessionAudit(event, {
        email,
        ip,
        outcome: "ok",
        owner: email,
      });
      return { ok: true, email, expiresAt: expiresAt.toISOString() };
    } catch (error) {
      captureError(error, {
        tags: { component: "auth", route: "runner-session" },
      });
      return refuse(
        503,
        "runner_session_unavailable",
        "Sign-in is unavailable.",
      );
    }
  });
}
