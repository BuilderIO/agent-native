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
 *   - client/analytics.ts   → @sentry/browser, VITE_SENTRY_CLIENT_DSN
 *   - server/sentry.ts      → @sentry/node, SENTRY_SERVER_DSN
 *
 * Each maps to a different Sentry project so we can route errors to the
 * right team without one project drowning out the others. Don't wire the
 * three together — they share the SDK package but live in different
 * processes / runtimes / call sites.
 */
import * as Sentry from "@sentry/node";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import type { AuthSession } from "./auth.js";

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
 * No DSN is hardcoded: unlike the CLI (a published binary that always
 * wants to phone home crashes), the server runs in customer environments.
 * Operators set `SENTRY_SERVER_DSN` when they want their own Sentry
 * project to receive these events; without it the module no-ops.
 */
export function initServerSentry(): boolean {
  if (_initStarted) return _initSucceeded;
  _initStarted = true;

  const dsn = process.env.SENTRY_SERVER_DSN;
  if (!dsn) {
    if (process.env.DEBUG) {
      console.log(
        "[agent-native] SENTRY_SERVER_DSN not set — server Sentry disabled.",
      );
    }
    return false;
  }

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || "production",
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

export interface RouteErrorContext {
  /** The full request path (e.g. `/_agent-native/agent-chat`). */
  route?: string;
  /** HTTP method (e.g. `GET`, `POST`). */
  method?: string;
  /** Caller's `User-Agent` header. */
  userAgent?: string;
  /** Free-form extra tags to add to the event. */
  tags?: Record<string, string | undefined>;
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
      return Sentry.captureException(error);
    });
  } catch {
    return undefined;
  }
}
