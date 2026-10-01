import { loadOptionalPeer } from "../shared/optional-peer.js";
import { redact } from "../tracking/redaction.js";
import type { AuthSession } from "./auth.js";
import {
  resolveDeployEnvironment,
  resolveServerRelease,
} from "./deploy-environment.js";
import {
  errorSignalFromSentryEvent,
  shouldReportErrorSignal,
} from "./error-noise-filter.js";
import { getRequestContext } from "./request-context.js";
import { resolveServerSentryDsn } from "./sentry-config.js";

let Sentry: typeof import("@sentry/node") | undefined;
let _initPromise: Promise<boolean> | undefined;
let _initSucceeded = false;

const SQL_QUERY_FAILURE_RE = /\b(?:failed query|query failed):/i;

function parseTracesSampleRate(): number {
  const raw = process.env.SENTRY_SERVER_TRACES_SAMPLE_RATE;
  if (!raw) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 1) return 0;
  return n;
}

function containsSqlQueryFailure(
  value: unknown,
  seen = new WeakSet<object>(),
): boolean {
  if (typeof value === "string") return SQL_QUERY_FAILURE_RE.test(value);
  if (value == null || typeof value !== "object" || seen.has(value)) {
    return false;
  }
  seen.add(value);

  if (
    !Array.isArray(value) &&
    "params" in value &&
    ("query" in value || "sql" in value)
  ) {
    return true;
  }

  return Object.values(value).some((child) =>
    containsSqlQueryFailure(child, seen),
  );
}

function redactSentryEventPayload(
  value: unknown,
  sqlFailure = false,
  eventRoot = false,
  seen = new WeakSet<object>(),
): void {
  if (value == null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);

  const record = value as Record<string, unknown>;
  const redactSqlParams =
    sqlFailure ||
    (!eventRoot &&
      ((!Array.isArray(value) &&
        "params" in value &&
        ("query" in value || "sql" in value)) ||
        Object.values(record).some(
          (child) =>
            typeof child === "string" && SQL_QUERY_FAILURE_RE.test(child),
        )));
  for (const [key, child] of Object.entries(record)) {
    if (redactSqlParams && key.toLowerCase() === "params") {
      record[key] = "<redacted>";
    } else if (typeof child === "string") {
      record[key] = redact(child);
    } else {
      redactSentryEventPayload(child, redactSqlParams, false, seen);
    }
  }
}

export function initServerSentry(): Promise<boolean> {
  if (_initPromise) return _initPromise;

  const dsn = resolveServerSentryDsn();
  if (!dsn) {
    if (process.env.DEBUG) {
      console.log(
        "[agent-native] SENTRY_SERVER_DSN/SENTRY_DSN not set — server Sentry disabled.",
      );
    }
    _initPromise = Promise.resolve(false);
    return _initPromise;
  }

  _initPromise = loadOptionalPeer("@sentry/node", () => import("@sentry/node"))
    .then((sentry) => {
      Sentry = sentry;
      sentry.init({
        dsn,
        environment: resolveDeployEnvironment(),
        release: resolveServerRelease(),
        tracesSampleRate: parseTracesSampleRate(),
        sendDefaultPii: false,
        beforeSend(event) {
          event.tags = {
            ...event.tags,
            deployment_environment: resolveDeployEnvironment(),
          };

          if (!shouldReportErrorSignal(errorSignalFromSentryEvent(event))) {
            return null;
          }

          const hasSqlLogEntryFailure = containsSqlQueryFailure([
            event.message,
            event.logentry,
            event.exception,
            event.extra?.__serialized__,
          ]);
          redactSentryEventPayload(event, false, true);
          if (hasSqlLogEntryFailure && event.logentry) {
            delete event.logentry.params;
          }

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
            delete (event.request as Record<string, unknown>).cookies;
          }

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

          if (event.contexts && typeof event.contexts === "object") {
            delete (event.contexts as Record<string, unknown>).runtime_env;
          }

          return event;
        },
      });
      _initSucceeded = true;
      return true;
    })
    .catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`[agent-native] Server Sentry disabled: ${detail}`);
      return false;
    });
  return _initPromise;
}

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
  if (!_initSucceeded || !Sentry) return;
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

export function setSentryRequestContext(ctx: {
  userEmail?: string;
  orgId?: string;
}): void {
  if (!_initSucceeded || !Sentry) return;
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

export function captureAuthError(
  error: unknown,
  context: {
    route:
      | "login"
      | "signup"
      | "logout"
      | "magic-link"
      | "verify-email"
      // Catch-all for the direct Better Auth handler, which forwards
      // arbitrary Better Auth sub-paths (`/token`, `/reset-password`, ...)
      // that don't each warrant their own route label — use `path` below
      // for the specific sub-path.
      | "better-auth";
    email?: string;
    path?: string;
  },
): string | undefined {
  if (getRequestContext()?.isSyntheticTraffic) return undefined;
  if (!_initSucceeded || !Sentry) return undefined;
  const sentry = Sentry;
  try {
    return sentry.withScope((scope) => {
      scope.setLevel("warning");
      scope.setTag("auth", context.route);
      if (context.path) scope.setTag("path", context.path);
      if (context.email) {
        scope.setUser({ id: context.email, email: context.email });
      }
      return sentry.captureException(error);
    });
  } catch {
    return undefined;
  }
}

export interface RouteErrorContext {
  route?: string;
  method?: string;
  userAgent?: string;
  tags?: Record<string, string | undefined>;
  extra?: Record<string, unknown>;
  contexts?: Record<string, Record<string, unknown>>;
}

export function captureRouteError(
  error: unknown,
  context: RouteErrorContext = {},
): string | undefined {
  if (getRequestContext()?.isSyntheticTraffic) return undefined;
  if (!_initSucceeded || !Sentry) return undefined;
  const sentry = Sentry;
  try {
    return sentry.withScope((scope) => {
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
      return sentry.captureException(error);
    });
  } catch {
    return undefined;
  }
}
