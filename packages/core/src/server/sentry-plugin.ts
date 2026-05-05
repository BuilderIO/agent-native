/**
 * Nitro plugin that initializes server-side Sentry and attaches per-request
 * user context.
 *
 * Wires three pieces:
 *   1. On startup, `initServerSentry()` reads `SENTRY_SERVER_DSN` and arms
 *      the SDK (no-op when the env var is unset).
 *   2. On every request, hook into Nitro's `request` event: resolve the
 *      session via `getSession(event)` and tag the per-request isolation
 *      scope with the user's id/email/orgId. Wrapped in try/catch so a
 *      session-resolution failure can never 500 the request.
 *   3. On every Nitro `error` event, capture the exception with the route,
 *      method, and user-agent attached as searchable tags.
 *
 * Mounted as a default plugin from `framework-request-handler.ts` —
 * templates that don't define `server/plugins/sentry.ts` get this for
 * free. Templates that need to customize (e.g. add custom tags / skip
 * Sentry) can override by exporting their own `sentry.ts` plugin.
 */
import {
  awaitBootstrap,
  markDefaultPluginProvided,
} from "./framework-request-handler.js";
import { getSession } from "./auth.js";
import {
  captureRouteError,
  initServerSentry,
  isServerSentryEnabled,
  setSentryUserForRequest,
} from "./sentry.js";
import { getHeader, getMethod, type H3Event } from "h3";

type NitroPluginDef = (nitroApp: any) => void | Promise<void>;

function readRoute(event: H3Event): string | undefined {
  try {
    return event.url?.pathname;
  } catch {
    return undefined;
  }
}

function readUserAgent(event: H3Event): string | undefined {
  try {
    return getHeader(event, "user-agent");
  } catch {
    return undefined;
  }
}

/**
 * Skip session resolution for paths that obviously don't need one. Avoids
 * a DB round-trip on every static-asset / favicon / public-share request
 * while keeping API + framework routes covered.
 */
function shouldResolveSession(path: string | undefined): boolean {
  if (!path) return false;
  // Vite / React Router static assets and similar.
  if (
    path.startsWith("/assets/") ||
    path.startsWith("/_build/") ||
    path === "/favicon.ico" ||
    path.startsWith("/static/")
  ) {
    return false;
  }
  return true;
}

export function createSentryPlugin(): NitroPluginDef {
  return async (nitroApp: any) => {
    markDefaultPluginProvided(nitroApp, "sentry");
    await awaitBootstrap(nitroApp);

    initServerSentry();
    if (!isServerSentryEnabled()) {
      // No DSN — skip wiring per-request hooks. We'd just be paying the
      // call-site overhead for every request to no effect.
      return;
    }

    // Per-request: resolve session and attach to Sentry isolation scope so
    // any exception captured later in the request carries the user. Wrapped
    // in try/catch so a session-DB hiccup or auth-broken state never turns
    // into a 500 — the worst case is we lose user context on the event.
    nitroApp.hooks?.hook?.("request", async (event: H3Event) => {
      if (!shouldResolveSession(readRoute(event))) return;
      try {
        const session = await getSession(event);
        setSentryUserForRequest(session);
      } catch {
        // best-effort — don't break the request
      }
    });

    // Per-error: capture with route/method/UA tags. Nitro's `error` hook
    // signature is (error, { event, tags }) — we forward what we can.
    nitroApp.hooks?.hook?.(
      "error",
      (error: unknown, ctx?: { event?: H3Event }) => {
        try {
          const event = ctx?.event;
          captureRouteError(error, {
            route: event ? readRoute(event) : undefined,
            method: event ? getMethod(event) : undefined,
            userAgent: event ? readUserAgent(event) : undefined,
          });
        } catch {
          // Sentry capture must never escape into Nitro's error path.
        }
      },
    );
  };
}

/**
 * Default Sentry plugin — auto-mounts when a template doesn't define its
 * own `server/plugins/sentry.ts`. Reads `SENTRY_SERVER_DSN` from env and
 * silently no-ops when it's unset, so this is safe to default-mount in
 * every template (including local dev with no DSN configured).
 */
export const defaultSentryPlugin: NitroPluginDef = createSentryPlugin();
