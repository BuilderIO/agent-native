import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Server-side Sentry initialization for Nitro.
 *
 * Errors thrown inside Nitro routes (the framework's own /_agent-native/*
 * handlers, the template's API routes, action handlers, agent-chat streams)
 * never reach the CLI's Sentry init — that only covers the developer's
 * machine. Without server-side Sentry the only signal a 500 ever produces
 * is a server-side console.error that lives and dies with the request.
 *
 * This module is the third Sentry init point in the framework:
 *   - cli/index.ts          → @sentry/node, hardcoded DSN, "agent-native-cli"
 *   - client/analytics.ts   → @sentry/browser, VITE_SENTRY_CLIENT_DSN / runtime config
 *   - server/sentry.ts      → @sentry/node, SENTRY_SERVER_DSN / SENTRY_DSN
 *
 * The browser and server can share a Sentry project/DSN. Separate projects
 * are an operational choice for noise, ownership, or quotas; not a runtime
 * requirement.
 */
import * as Sentry from "@sentry/node";

import type { AuthSession } from "./auth.js";
import {
  resolveSentryEnvironment,
  resolveServerSentryDsn,
} from "./sentry-config.js";

let _initStarted = false;
let _initSucceeded = false;

/**
 * Resolve the agent-native version baked into core's package.json so Sentry
 * "release" reflects the running framework version. Mirrors how the CLI
 * computes `_version` — same dist layout, same fallback string. Guarded so
 * a missing/unreadable package.json never crashes server boot.
 */
function resolveServerRelease(): string {
  const explicit = process.env.AGENT_NATIVE_RELEASE;
  if (explicit) return explicit;
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    // dist/server/sentry.js → ../../package.json
    const pkgPath = path.resolve(here, "../../package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as {
      version?: string;
    };
    if (pkg?.version) return `agent-native-server@${pkg.version}`;
  } catch {
    // ignore — fall through to "unknown"
  }
  return "agent-native-server@unknown";
}

function parseTracesSampleRate(): number {
  const raw = process.env.SENTRY_SERVER_TRACES_SAMPLE_RATE;
  if (!raw) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 1) return 0;
  return n;
}

/**
 * Initialize server-side Sentry. Idempotent — safe to call from multiple
 * plugin entrypoints. Returns `true` if initialization actually happened
 * (DSN was set), `false` if Sentry is disabled (no DSN).
 *
 * No DSN is hardcoded: unlike the CLI (a published binary that always wants
 * to phone home crashes), the server runs in customer environments. Operators
 * set `SENTRY_SERVER_DSN` or the common `SENTRY_DSN` when they want their own
 * Sentry project to receive these events; without one the module no-ops.
 */
export function initServerSentry(): boolean {
  if (_initStarted) return _initSucceeded;
  _initStarted = true;

  const dsn = resolveServerSentryDsn();
  if (!dsn) {
    if (process.env.DEBUG) {
      console.log(
        "[agent-native] SENTRY_SERVER_DSN/SENTRY_DSN not set — server Sentry disabled.",
      );
    }
    return false;
  }

  Sentry.init({
    dsn,
    environment: resolveSentryEnvironment(),
    release: resolveServerRelease(),
    tracesSampleRate: parseTracesSampleRate(),
    // sendDefaultPii MUST stay false — the framework runs inside customer
    // environments and we never want to silently ship request headers,
    // cookies, or process.env contents to Sentry without explicit consent.
    sendDefaultPii: false,
    beforeSend(event) {
      // Drop expected user-input rejections so they don't pollute Sentry
      // with non-bug noise. Mirrors the CLI's drop list — the framework
      // and CLI both throw `ValidationError` for the same class of input
      // failures, and exception type comes through as the class name.
      const exceptionType = event.exception?.values?.[0]?.type;
      if (
        exceptionType === "ValidationError" ||
        event.tags?.handled === "validation"
      ) {
        return null;
      }
      // Drop access-control rejections (caller lacks permission, signed
      // out, etc.). These are 4xx user-facing errors that propagated to
      // Nitro's error hook because a route forgot to catch them — fixing
      // the route is the right answer, but in the meantime they bury
      // real bugs and don't represent server failures. Auth-routes use
      // `captureAuthError` directly with `level: warning` so this filter
      // only sees the generic-handler escape path.
      if (
        exceptionType === "ForbiddenError" ||
        exceptionType === "UnauthorizedError"
      ) {
        return null;
      }
      // Drop "socket hang up" unhandled promise rejections that fire from
      // Lambda freeze cycles. AWS Lambda recycles long-lived sockets (e.g.
      // MCP Streamable HTTP long-polls, keep-alive HTTP agents) ~60s after
      // a function returns 200; the next thaw delivers a socket-end event
      // whose Promise has nobody left to await it. The function itself
      // already returned correctly, so there's no user impact — just
      // ~10k events/day of noise. The narrow shape (unhandled rejection
      // from `Socket.socketOnEnd` in `node:_http_client`) keeps real
      // application-thrown socket errors from being silenced.
      const exceptionValue = event.exception?.values?.[0]?.value ?? "";
      const exceptionMechanism = event.exception?.values?.[0]?.mechanism?.type;
      const isUnhandledRejection =
        typeof exceptionMechanism === "string" &&
        exceptionMechanism.endsWith("onunhandledrejection");
      if (exceptionValue === "socket hang up" && isUnhandledRejection) {
        const frames = event.exception?.values?.[0]?.stacktrace?.frames ?? [];
        const fromHttpClient = frames.some(
          (f) =>
            f?.function === "Socket.socketOnEnd" ||
            f?.filename === "node:_http_client",
        );
        if (fromHttpClient) {
          return null;
        }
      }
      // Drop SDK-only ErrorEvent promise rejections. These arrive as Node
      // unhandled rejections with no application frames — typically the Neon
      // serverless driver's WebSocket dying across a Lambda freeze/thaw and
      // rejecting a floating promise with the raw ErrorEvent (the per-client
      // logger in db/client.ts already records these with context). Keep any
      // event with real app frames so thrown ErrorEvents stay visible.
      //
      // "Application frame" must exclude the Sentry SDK's own bundled chunks:
      // serverless bundles place them under the app root (e.g.
      // `/var/task/_libs/@sentry/node+….mjs`), outside node_modules, so the
      // SDK marks them in_app and the unhandled-rejection instrumentation
      // stack alone would defeat this filter.
      if (exceptionValue === "[object ErrorEvent]" && isUnhandledRejection) {
        const frames = event.exception?.values?.[0]?.stacktrace?.frames ?? [];
        const hasApplicationFrame = frames.some(
          (frame) =>
            frame?.in_app && !String(frame?.filename ?? "").includes("sentry"),
        );
        const hasSentryFrame = frames.some((frame) =>
          String(frame?.filename ?? "").includes("sentry"),
        );
        if (!hasApplicationFrame && hasSentryFrame) {
          return null;
        }
      }
      const metadata = (
        event as {
          metadata?: {
            filename?: unknown;
            value?: unknown;
          };
        }
      ).metadata;
      if (
        metadata?.value === "[object ErrorEvent]" &&
        !event.exception?.values?.length &&
        String(metadata.filename ?? "").includes("sentry")
      ) {
        return null;
      }
      // h3's `createError({ statusCode: 4xx, ... })` produces an
      // `HTTPError` (h3 v2) / `H3Error` (h3 v1). 4xx HTTPErrors are
      // handler-controlled "expected failure" responses (404 not found,
      // 400 bad input) that route through Nitro's error hook just
      // because they bubble out of `defineEventHandler`. They aren't
      // bugs — they're the documented way to return a 4xx in h3.
      // Capture only when the statusCode looks like 5xx (real failure)
      // or is missing (generic Error masquerading as HTTPError).
      if (exceptionType === "HTTPError" || exceptionType === "H3Error") {
        const statusCode = (event.tags?.statusCode ??
          (
            event.contexts as
              | Record<string, Record<string, unknown>>
              | undefined
          )?.h3?.statusCode) as number | string | undefined;
        const code =
          typeof statusCode === "string"
            ? parseInt(statusCode, 10)
            : statusCode;
        if (typeof code === "number" && code >= 400 && code < 500) {
          return null;
        }
        // No statusCode in the event payload — fall back to matching the
        // common 4xx messages so handler-thrown 404/400/403/401 don't
        // pollute Sentry. This is a heuristic, but the alternatives
        // (every 4xx becomes a "real" issue, or we patch every route to
        // catch+return) are worse.
        const value = event.exception?.values?.[0]?.value ?? "";
        if (
          /^Cannot find any route matching/i.test(value) ||
          / not found$/i.test(value) ||
          /Unauthenticated$/i.test(value) ||
          /^Unauthorized$/i.test(value) ||
          /^No access to /i.test(value)
        ) {
          return null;
        }
      }

      // Defense in depth: scrub PII even if some integration auto-attached
      // request metadata despite sendDefaultPii: false.
      if (event.request) {
        if (event.request.headers) {
          const headers = event.request.headers as Record<string, string>;
          for (const k of Object.keys(headers)) {
            const lk = k.toLowerCase();
            if (
              lk === "cookie" ||
              lk === "authorization" ||
              lk === "set-cookie" ||
              lk === "proxy-authorization"
            ) {
              delete headers[k];
            }
          }
        }
        // Cookies live in their own field too.
        delete (event.request as Record<string, unknown>).cookies;
      }

      // Keep user info that was explicitly set via Sentry.setUser
      // (id/email/username) so we can attribute crashes back to a real
      // operator. Always strip ip_address — auto-collected, no consent.
      if (event.user) {
        const user = event.user as Record<string, unknown>;
        delete user.ip_address;
        const hasIdentity =
          typeof user.id === "string" ||
          typeof user.email === "string" ||
          typeof user.username === "string";
        if (!hasIdentity) {
          delete event.user;
        }
      }

      // Sentry's contexts can carry process.env snapshots — strip env-shaped
      // contexts so we don't leak deployment secrets.
      if (event.contexts && typeof event.contexts === "object") {
        delete (event.contexts as Record<string, unknown>).runtime_env;
      }

      return event;
    },
  });

  _initSucceeded = true;
  return true;
}

/**
 * `true` once `initServerSentry()` has succeeded with a DSN. Plugins that
 * want to skip work when Sentry is disabled can check this before calling
 * the helpers below.
 */
export function isServerSentryEnabled(): boolean {
  return _initSucceeded;
}

/**
 * Attach the current request's user to Sentry's isolation scope so any
 * `captureException` triggered later in the request carries the right
 * `user.id` / `user.email` / `user.username` and `orgId` tag.
 *
 * Sentry node 10 uses Node's AsyncLocalStorage to give each async context
 * its own isolation scope, so setting on `getIsolationScope()` here only
 * affects events emitted while this request's async context is active.
 *
 * No-ops gracefully when Sentry isn't initialized or no session exists —
 * never throws into the request path.
 */
export function setSentryUserForRequest(session: AuthSession | null): void {
  if (!_initSucceeded) return;
  try {
    const scope = Sentry.getIsolationScope();
    if (!session) {
      scope.setUser(null);
      scope.setTag("orgId", null);
      return;
    }
    scope.setUser({
      id: session.userId ?? session.email,
      email: session.email,
      username: session.name,
    });
    scope.setTag("orgId", session.orgId ?? null);
    if (session.orgRole) {
      scope.setTag("orgRole", session.orgRole);
    }
  } catch {
    // Sentry scope APIs should never throw, but if they do we'd rather
    // continue serving the request than crash on observability.
  }
}

/**
 * Pin a user/org onto the current isolation scope from a lighter
 * `RequestContext`-shaped payload. Used by the request-context observer so
 * action handlers, agent-chat runs, and integration webhook processors —
 * all of which already wrap their work in `runWithRequestContext({ userEmail,
 * orgId, ... })` — automatically tag Sentry events with the right user even
 * when the Nitro `request` hook didn't see a cookie (e.g. webhook delivery,
 * A2A calls, internal background runs).
 *
 * Skips overwriting a richer user identity already set by
 * `setSentryUserForRequest` — the cookie-resolved session has
 * userId/username on top of email, which we shouldn't clobber.
 */
export function setSentryRequestContext(ctx: {
  userEmail?: string;
  orgId?: string;
}): void {
  if (!_initSucceeded) return;
  try {
    const scope = Sentry.getIsolationScope();
    if (ctx.userEmail) {
      const existing = scope.getScopeData().user;
      if (!existing?.id && !existing?.email) {
        scope.setUser({ id: ctx.userEmail, email: ctx.userEmail });
      }
    }
    if (ctx.orgId) {
      scope.setTag("orgId", ctx.orgId);
    }
  } catch {
    // never throw
  }
}

/**
 * Capture an error from one of the auth attempt routes (login / signup)
 * with the email pinned to the event so support can filter by user. Sets
 * Sentry level to `warning` (not `error`) — bad-password attempts aren't
 * actionable, but a sustained spike of warnings on a route IS the signal
 * we care about.
 *
 * Caller should still return their normal HTTP response (401/409/etc.);
 * this just records the error for observability.
 */
export function captureAuthError(
  error: unknown,
  context: { route: "login" | "signup" | "logout"; email?: string },
): string | undefined {
  if (!_initSucceeded) return undefined;
  try {
    return Sentry.withScope((scope) => {
      scope.setLevel("warning");
      scope.setTag("auth", context.route);
      if (context.email) {
        scope.setUser({ id: context.email, email: context.email });
      }
      return Sentry.captureException(error);
    });
  } catch {
    return undefined;
  }
}

export interface RouteErrorContext {
  /** The full request path (e.g. `/_agent-native/agent-chat`). */
  route?: string;
  /** HTTP method (e.g. `GET`, `POST`). */
  method?: string;
  /** Caller's `User-Agent` header. */
  userAgent?: string;
  /** Free-form extra tags to add to the event (low-cardinality). */
  tags?: Record<string, string | undefined>;
  /**
   * High-cardinality / structured payload — not searchable but visible in
   * the Sentry event detail (recording IDs, byte counts, compression
   * metadata, response body tails, etc.).
   */
  extra?: Record<string, unknown>;
  /**
   * Grouped contexts shown as separate cards in the Sentry event UI.
   */
  contexts?: Record<string, Record<string, unknown>>;
}

/**
 * Capture an exception that surfaced in a Nitro route handler with the
 * request's route/method/userAgent attached as searchable Sentry tags.
 *
 * Non-throwing: if Sentry isn't initialized or the underlying capture
 * fails, this is a no-op. Returns the Sentry event ID when capture
 * succeeded, otherwise `undefined`.
 */
export function captureRouteError(
  error: unknown,
  context: RouteErrorContext = {},
): string | undefined {
  if (!_initSucceeded) return undefined;
  try {
    return Sentry.withScope((scope) => {
      if (context.route) scope.setTag("route", context.route);
      if (context.method) scope.setTag("method", context.method);
      if (context.userAgent) scope.setTag("userAgent", context.userAgent);
      if (context.tags) {
        for (const [k, v] of Object.entries(context.tags)) {
          if (typeof v === "string") scope.setTag(k, v);
        }
      }
      if (context.extra) {
        for (const [k, v] of Object.entries(context.extra)) {
          if (v !== undefined) scope.setExtra(k, v);
        }
      }
      if (context.contexts) {
        for (const [k, v] of Object.entries(context.contexts)) {
          scope.setContext(k, v);
        }
      }
      return Sentry.captureException(error);
    });
  } catch {
    return undefined;
  }
}
