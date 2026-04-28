import crypto from "node:crypto";
import path from "node:path";

// Lazy fs — loaded via dynamic import() on first use.
// Avoids static require() which crashes on CF Workers.
let _fs: typeof import("fs") | undefined;
async function getFs(): Promise<typeof import("fs")> {
  if (!_fs) {
    _fs = await import("node:fs");
  }
  return _fs;
}
import {
  defineEventHandler,
  getMethod,
  getQuery,
  sendRedirect,
  setResponseHeader,
  setResponseStatus,
  getCookie,
  setCookie,
  deleteCookie,
} from "h3";
import type { H3Event } from "h3";
import type { H3AppShim } from "./framework-request-handler.js";

// In h3 v2, `event.req` IS the web Request — no conversion needed.
function toWebRequest(event: H3Event): Request {
  return (event as any).req as Request;
}

type H3App = H3AppShim;
import {
  getDbExec,
  isPostgres,
  intType,
  isLocalDatabase,
  retryOnDdlRace,
} from "../db/client.js";
import { getBetterAuth, getBetterAuthSync } from "./better-auth-instance.js";
import type { BetterAuthConfig } from "./better-auth-instance.js";
import { getOnboardingHtml, getResetPasswordHtml } from "./onboarding-html.js";
import { migrateLocalUserData } from "./local-migration.js";
import { readBody } from "../server/h3-helpers.js";
import {
  readDesktopSso,
  writeDesktopSso,
  clearDesktopSso,
} from "./desktop-sso.js";
import {
  isElectron as isElectronRequest,
  getOrigin,
  encodeOAuthState,
  decodeOAuthState,
  createOAuthSession,
  oauthCallbackResponse,
  oauthErrorPage,
} from "./google-oauth.js";

/**
 * Get the configured session max age. Desktop SSO broker writes from
 * OAuth flows read this so expiration stays consistent with the cookie.
 */
export function getSessionMaxAge(): number {
  return sessionMaxAge;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuthSession {
  email: string;
  userId?: string;
  token?: string;
  /** Display name from the auth provider, when available (Better Auth user.name). */
  name?: string;
  /** Active organization ID (from Better Auth organization plugin) */
  orgId?: string;
  /** User's role in the active organization (owner/admin/member) */
  orgRole?: string;
}

export interface AuthOptions {
  /** Session max age in seconds. Default: 30 days */
  maxAge?: number;
  /**
   * Custom getSession implementation (for BYOA — Auth.js, Clerk, etc.).
   * When provided, Better Auth is bypassed entirely.
   */
  getSession?: (event: H3Event) => Promise<AuthSession | null>;
  /**
   * Paths that are accessible without authentication.
   * Supports prefix matching: "/book" matches /book/anything.
   * Both page routes and API routes can be made public.
   */
  publicPaths?: string[];
  /**
   * Custom login page HTML. When provided, this HTML is served to
   * unauthenticated page requests instead of the built-in login form.
   * Use this for custom login flows (e.g., "Sign in with Google" button).
   */
  loginHtml?: string;
  /**
   * Hide email/password forms on the built-in login page and show only the
   * Google sign-in button. Use this for templates (mail, calendar) where
   * Google connection is required anyway. Has no effect when `loginHtml`
   * is provided.
   */
  googleOnly?: boolean;
  /**
   * Product marketing content shown alongside the sign-in form.
   * When provided, the page uses a split layout: marketing on the left,
   * sign-in form on the right.
   */
  marketing?: {
    appName: string;
    tagline: string;
    description?: string;
    features?: string[];
  };
  /**
   * Additional Better Auth configuration (social providers, plugins, etc.)
   */
  betterAuth?: BetterAuthConfig;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Cookie name for the framework's session cookie.
 *
 * Browsers scope cookies by host (NOT host+port — RFC 6265), so two apps
 * running on different localhost ports share one cookie jar. When multiple
 * templates run side-by-side (`dev:all`, the desktop app, multi-template
 * deploys on a shared domain), they would otherwise stomp on each other's
 * `an_session` cookie and ping-pong each other into a logged-out state.
 *
 * When `APP_NAME` is set, suffix the cookie so each app gets its own slot.
 */
const APP_NAME_SLUG = (process.env.APP_NAME || "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "_")
  .replace(/^_+|_+$/g, "");
export const COOKIE_NAME = APP_NAME_SLUG
  ? `an_session_${APP_NAME_SLUG}`
  : "an_session";
const DEFAULT_MAX_AGE = 60 * 60 * 24 * 30; // 30 days
const LOCAL_MODE_MARKER_PATH = path.resolve(
  process.cwd(),
  ".agent-native",
  "auth-mode",
);

// ---------------------------------------------------------------------------
// AUTH_MODE detection
// ---------------------------------------------------------------------------

let _warnedRemoteLocalMode = false;

/**
 * Check if the app is in local-only mode (no auth).
 *
 * Returns true when AUTH_MODE=local is explicitly set or when the dev
 * onboarding flow has enabled local mode for the current workspace via
 * a runtime marker file.
 *
 * Local mode is an explicit escape hatch for when you want to guarantee
 * no auth is used. In development, getSession() also falls back to
 * local@localhost automatically if no other auth method succeeds, so
 * apps are always usable without configuration in dev.
 *
 * Refuses to enable on any non-local database (Postgres, Turso, D1): local
 * mode uses a single shared virtual user with no per-machine scoping, so on
 * a shared DB every developer would land on the same account and collide.
 */
async function isLocalModeEnabled(): Promise<boolean> {
  if (!isLocalDatabase()) {
    if (process.env.AUTH_MODE === "local" && !_warnedRemoteLocalMode) {
      _warnedRemoteLocalMode = true;
      console.warn(
        "[agent-native] AUTH_MODE=local ignored: database is not local SQLite. " +
          "local@localhost has no per-user scoping and would collide across developers on a shared DB.",
      );
    }
    return false;
  }

  if (process.env.AUTH_MODE === "local") return true;

  try {
    const fs = await getFs();
    const mode = fs.readFileSync(LOCAL_MODE_MARKER_PATH, "utf-8").trim();
    return mode === "local";
  } catch {
    return false;
  }
}

/**
 * Check if we're in a development/test environment.
 * Used for cookie security settings, not for auth bypass.
 */
function isDevEnvironment(): boolean {
  const env = process.env.NODE_ENV;
  return env === "development" || env === "test";
}

/**
 * Validate a `?return=` URL for the /_agent-native/sign-in entrypoint.
 *
 * Parses the candidate against a sentinel base origin; any input that
 * resolves to a different origin (network-path references, absolute URLs,
 * `data:` / `javascript:` schemes, backslash-bypass tricks WHATWG normalises
 * to `//`) gets rejected and falls back to "/". Control characters are
 * stripped up front to defend against header-injection. Returns the
 * normalised path the parser produced — never the raw input.
 *
 * Exported for unit tests.
 */
export function safeReturnPath(raw: string | null | undefined): string {
  if (!raw) return "/";
  if (/[\x00-\x1f]/.test(raw)) return "/";
  try {
    const parsed = new URL(raw, "http://safe-base.invalid");
    if (parsed.origin !== "http://safe-base.invalid") return "/";
    return parsed.pathname + parsed.search + parsed.hash;
  } catch {
    return "/";
  }
}

// ---------------------------------------------------------------------------
// ACCESS_TOKEN resolution
// ---------------------------------------------------------------------------

function getAccessTokens(): string[] {
  const single = process.env.ACCESS_TOKEN;
  const multi = process.env.ACCESS_TOKENS;
  const tokens: string[] = [];
  if (single) tokens.push(single);
  if (multi) {
    for (const t of multi.split(",")) {
      const trimmed = t.trim();
      if (trimmed && !tokens.includes(trimmed)) tokens.push(trimmed);
    }
  }
  return tokens;
}

function safeTokenMatch(input: string, tokens: string[]): boolean {
  const inputBuf = Buffer.from(input);
  for (const token of tokens) {
    const tokenBuf = Buffer.from(token);
    if (
      inputBuf.length === tokenBuf.length &&
      crypto.timingSafeEqual(inputBuf, tokenBuf)
    ) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Legacy session store — kept for backward compat (addSession/getSessionEmail)
// Used by google-oauth.ts for mobile deep linking session creation.
// ---------------------------------------------------------------------------

let _sessionInitPromise: Promise<void> | undefined;
let sessionMaxAge = DEFAULT_MAX_AGE;

async function ensureSessionTable(): Promise<void> {
  if (!_sessionInitPromise) {
    _sessionInitPromise = (async () => {
      const client = getDbExec();
      await retryOnDdlRace(() =>
        client.execute(`
          CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            email TEXT,
            created_at ${intType()} NOT NULL
          )
        `),
      );
      try {
        await client.execute(`ALTER TABLE sessions ADD COLUMN email TEXT`);
      } catch {
        // Column already exists
      }
    })().catch((err) => {
      // Don't cache the rejection — let the next caller retry a fresh init.
      _sessionInitPromise = undefined;
      throw err;
    });
  }
  return _sessionInitPromise;
}

/**
 * Re-run any `sessions`-table op once if Postgres reports the relation is
 * missing. Covers the case where a prior `ensureSessionTable()` resolved but
 * the table wasn't actually present (e.g. a race where the CREATE was dropped
 * on a reused pool connection, or a cached resolved promise from a prior
 * DB URL). Forces a fresh init, then retries the caller's op.
 */
async function retryIfSessionsMissing<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (e: any) {
    if (e?.code !== "42P01") throw e;
    const msg = String(e?.message ?? "");
    if (!msg.includes("sessions")) throw e;
    _sessionInitPromise = undefined;
    await ensureSessionTable();
    return await op();
  }
}

/**
 * Create a new session in the legacy sessions table.
 * Used by google-oauth.ts for mobile deep linking.
 */
export async function addSession(token: string, email?: string): Promise<void> {
  await ensureSessionTable();
  const client = getDbExec();
  await retryIfSessionsMissing(() =>
    client.execute({
      sql: isPostgres()
        ? `INSERT INTO sessions (token, email, created_at) VALUES (?, ?, ?) ON CONFLICT (token) DO UPDATE SET email=EXCLUDED.email, created_at=EXCLUDED.created_at`
        : `INSERT OR REPLACE INTO sessions (token, email, created_at) VALUES (?, ?, ?)`,
      args: [token, email ?? null, Date.now()],
    }),
  );
}

/** Remove a session from the legacy sessions table. */
export async function removeSession(token: string): Promise<void> {
  await ensureSessionTable();
  const client = getDbExec();
  await retryIfSessionsMissing(() =>
    client.execute({
      sql: `DELETE FROM sessions WHERE token = ?`,
      args: [token],
    }),
  );
}

/**
 * Look up the email associated with a legacy session token.
 * Returns null if the session doesn't exist, is expired, or has no email.
 */
export async function getSessionEmail(token: string): Promise<string | null> {
  await ensureSessionTable();
  const client = getDbExec();
  const { rows } = await retryIfSessionsMissing(() =>
    client.execute({
      sql: `SELECT email, created_at FROM sessions WHERE token = ?`,
      args: [token],
    }),
  );
  if (rows.length === 0) return null;
  const createdAt = rows[0].created_at as number;
  if (Date.now() - createdAt > sessionMaxAge * 1000) {
    await client.execute({
      sql: `DELETE FROM sessions WHERE token = ?`,
      args: [token],
    });
    return null;
  }
  return (rows[0].email as string) ?? null;
}

// ---------------------------------------------------------------------------
// getSession — the auth contract
// ---------------------------------------------------------------------------

let customGetSession: ((event: H3Event) => Promise<AuthSession | null>) | null =
  null;
let authDisabledMode = false;

/**
 * Mutable config for the auth guard. Stored separately from the guard function
 * so that a custom auth plugin can update the login HTML / public paths even
 * after the default plugin has already installed the middleware (a race that
 * occurs in production serverless environments where the default plugin is
 * auto-mounted before the template's custom auth plugin runs).
 */
interface AuthGuardConfig {
  loginHtml: string;
  publicPaths: string[];
}
let _authGuardConfig: AuthGuardConfig | null = null;

// Desktop OAuth exchange store — holds session tokens keyed by a unique flow
// ID so native apps (Tauri, Electron) that open OAuth in the system browser
// can retrieve the token after the callback completes on the server.
//
// Primary: in-memory Map (fast, works for single-instance dev/preview builds).
// Fallback: sessions table with a "dex:" prefixed key for cross-instance
// durability (Cloudflare Workers, multi-region deployments). The value stored
// in the `email` column is "{realToken}::{userEmail}" so both can be recovered
// from a single DB lookup.
const _desktopExchanges = new Map<
  string,
  { token: string; email: string; expiresAt: number }
>();

// 5-minute TTL for exchange entries (short — single-use tokens).
const DESKTOP_EXCHANGE_TTL_MS = 5 * 60 * 1000;

export function setDesktopExchange(
  flowId: string,
  token: string,
  email: string,
) {
  _desktopExchanges.set(flowId, {
    token,
    email,
    expiresAt: Date.now() + DESKTOP_EXCHANGE_TTL_MS,
  });
}

/**
 * Persist a desktop exchange entry to the sessions table so it survives
 * cross-instance routing (e.g. Cloudflare Workers). Stored under a synthetic
 * token key "dex:{flowId}"; the `email` column packs both the real session
 * token and the user email so they can be recovered in one query.
 * Non-fatal — if the DB isn't ready yet the in-memory Map still works for
 * same-instance requests.
 */
async function persistDesktopExchangeToDB(
  flowId: string,
  token: string,
  email: string,
): Promise<void> {
  try {
    await addSession(`dex:${flowId}`, `${token}::${email}`);
  } catch {
    // non-fatal — in-memory Map is the primary path
  }
}

/**
 * Retrieve and consume a desktop exchange entry from the DB fallback.
 * Returns null if not found or already consumed.
 */
async function consumeDesktopExchangeFromDB(
  flowId: string,
): Promise<{ token: string; email: string } | null> {
  try {
    const packed = await getSessionEmail(`dex:${flowId}`);
    if (!packed) return null;
    const sepIdx = packed.indexOf("::");
    if (sepIdx === -1) return null;
    const token = packed.slice(0, sepIdx);
    const email = packed.slice(sepIdx + 2);
    // Single-use — delete immediately after reading.
    await removeSession(`dex:${flowId}`);
    return { token, email };
  } catch {
    return null;
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _desktopExchanges) {
    if (v.expiresAt < now) _desktopExchanges.delete(k);
  }
}, 60_000).unref?.();

/**
 * Module-level auth guard function. Set by autoMountAuth() when auth is active.
 * Called by the server middleware to enforce auth on ALL requests (not just
 * /_agent-native/* routes).
 */
let _authGuardFn:
  | ((event: H3Event) => Promise<Response | object | string | void>)
  | null = null;

/**
 * The H3 app the auth routes + guard were last mounted on. Module-level
 * state survives Vite HMR restarts, but each HMR cycle creates a fresh
 * nitroApp/H3 instance whose middleware array is empty again. Tracking the
 * app here lets autoMountAuth detect "same module state, new app" and
 * re-mount routes instead of silently skipping them because `_authGuardFn`
 * looks populated from a previous cycle.
 */
let _mountedApp: H3App | null = null;

/**
 * Run the auth guard on an event. Returns a Response/object to block the
 * request (login page or 401), or undefined to allow it through.
 *
 * Called by the default server middleware (server/middleware/auth.ts) to
 * enforce auth on page routes and API routes — not just framework routes.
 */
export async function runAuthGuard(
  event: H3Event,
): Promise<Response | object | string | void> {
  if (!_authGuardFn) return; // Auth not mounted (local mode, etc.)
  return _authGuardFn(event);
}

const LOCAL_SESSION: AuthSession = { email: "local@localhost" };

// ---------------------------------------------------------------------------
// Auth guard factory
// ---------------------------------------------------------------------------

/**
 * Create an auth guard function that checks session and blocks
 * unauthenticated requests. Returns the login HTML for page routes
 * or a 401 JSON response for API routes.
 *
 * Reads loginHtml and publicPaths from _authGuardConfig on every request
 * so that a custom plugin can update them after the default has already
 * installed this middleware (the production race condition fix).
 */
function applyCorsHeaders(event: H3Event): void {
  // Framework-level CORS. The auth guard runs before any of the app's own
  // route handlers, so we need to set CORS here too — otherwise a 401
  // response would be missing the Allow-Origin header and the browser
  // blocks the response body (making it look like a network error
  // rather than "unauthenticated").
  const reqHeaders = (event.node?.req?.headers ?? {}) as Record<
    string,
    string | string[] | undefined
  >;
  const originRaw = reqHeaders["origin"];
  const origin = Array.isArray(originRaw) ? originRaw[0] : originRaw;
  if (!origin) return;
  // Dev convenience: always allow localhost origins across ports (Tauri
  // tray apps, the frame, docs). In prod, the CORS_ALLOWED_ORIGINS env
  // var is the safe-list.
  const allowlist = (process.env.CORS_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const allowed =
    allowlist.length === 0
      ? /^(https?|tauri):\/\/(localhost|127\.0\.0\.1|tauri\.localhost)(:\d+)?$/.test(
          origin,
        )
      : allowlist.includes(origin);
  if (!allowed) return;
  setResponseHeader(event, "Access-Control-Allow-Origin", origin);
  setResponseHeader(event, "Vary", "Origin");
  setResponseHeader(event, "Access-Control-Allow-Credentials", "true");
  setResponseHeader(
    event,
    "Access-Control-Allow-Methods",
    "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  );
  setResponseHeader(
    event,
    "Access-Control-Allow-Headers",
    "Content-Type,Authorization,X-Requested-With",
  );
}

function createAuthGuardFn(): (
  event: H3Event,
) => Promise<Response | object | string | void> {
  return async (event: H3Event) => {
    const config = _authGuardConfig;
    if (!config) return;
    const { loginHtml, publicPaths } = config;

    const url = event.node?.req?.url ?? event.path ?? "/";
    const p = url.split("?")[0];

    // Emit CORS headers on every request the guard sees so that even
    // error responses (401) reach the browser.
    applyCorsHeaders(event);
    // Preflight short-circuit: the browser sends OPTIONS before the real
    // credentialed request. Must return success without invoking auth.
    if (getMethod(event) === "OPTIONS") {
      setResponseStatus(event, 204);
      return "";
    }

    // Skip auth routes and specific Google OAuth endpoints that must be public
    // (callback and auth-url). Other Google endpoints like /status require auth.
    if (
      p.startsWith("/_agent-native/auth/") ||
      p === "/_agent-native/google/callback" ||
      p === "/_agent-native/google/auth-url" ||
      p === "/_agent-native/google/add-account/callback"
    ) {
      return;
    }

    // Integration webhook endpoints verify authenticity via platform-specific
    // signature verification (Slack HMAC, Telegram token, etc.), not sessions.
    if (/^\/_agent-native\/integrations\/[^/]+\/webhook$/.test(p)) {
      return;
    }

    // A2A endpoint verifies authenticity via JWT signed with the org's A2A
    // secret (or the global A2A_SECRET fallback), not via session cookies.
    if (p === "/_agent-native/a2a") {
      return;
    }

    // Force-sign-in entrypoint. Templates send viewers from public pages
    // (share links, embeds) here with a `?return=<path>` query — anonymous
    // visitors get the loginHtml, and once they sign in the loginHtml's
    // post-login reload re-hits this same URL with a session cookie set,
    // so we 302 them to the original page.
    //
    // `return` is validated by parsing it against a sentinel base origin
    // and checking the resolved origin still matches. This rejects every
    // open-redirect shape — `//evil.com/...` (network-path reference),
    // `/\evil.com/...` (WHATWG URL parser normalises `\` to `/` in HTTP
    // URLs, so a naive prefix check on `//` misses this), absolute URLs
    // like `https://evil.com`, and `data:` / `javascript:` schemes. The
    // reconstructed path comes from the parsed segments so any leftover
    // quirks get normalised. Control chars (incl. CR/LF for header
    // injection) are rejected up front.
    //
    if (p === "/_agent-native/sign-in") {
      const queryStr = url.includes("?") ? url.slice(url.indexOf("?") + 1) : "";
      const safeReturn = safeReturnPath(
        new URLSearchParams(queryStr).get("return"),
      );
      const session = await getSession(event);
      if (session) {
        return new Response("", {
          status: 302,
          headers: { Location: safeReturn },
        });
      }
      return new Response(loginHtml, {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // Skip static assets (Vite chunks, fonts, images, etc.)
    if (
      p.startsWith("/assets/") ||
      p.startsWith("/_build/") ||
      p.endsWith(".js") ||
      p.endsWith(".css") ||
      p.endsWith(".map") ||
      p.endsWith(".ico") ||
      p.endsWith(".png") ||
      p.endsWith(".svg") ||
      p.endsWith(".woff2") ||
      p.endsWith(".woff")
    ) {
      return;
    }
    if (isPublicPath(url, publicPaths)) return;

    const session = await getSession(event);
    if (session) return;

    if (p.startsWith("/api/") || p.startsWith("/_agent-native/")) {
      setResponseStatus(event, 401);
      return { error: "Unauthorized" };
    }

    return new Response(loginHtml, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  };
}

/**
 * Map a Better Auth session to our AuthSession type.
 */
function mapBetterAuthSession(baSession: {
  user: { id: string; email: string; name?: string };
  session: { token: string; activeOrganizationId?: string };
}): AuthSession {
  return {
    email: baSession.user.email,
    userId: baSession.user.id,
    name: baSession.user.name,
    token: baSession.session?.token,
    orgId: baSession.session?.activeOrganizationId ?? undefined,
  };
}

/**
 * Get the current auth session for a request.
 *
 * Resolution chain:
 * 1. AUTH_MODE=local → local@localhost (explicit escape hatch)
 * 2. AUTH_DISABLED=true → local@localhost (infrastructure auth)
 * 3. ACCESS_TOKEN → check legacy cookie-based token sessions
 * 4. BYOA custom getSession → delegate to template callback
 * 5. Better Auth → check session via Better Auth API (cookie or Bearer)
 * 6. Legacy cookie → check an_session cookie in legacy sessions table
 * 7. Mobile _session query param → promote to cookie
 * 8. Dev-mode fallback → local@localhost (never block in development)
 */
export async function getSession(event: H3Event): Promise<AuthSession | null> {
  // 1. AUTH_MODE=local — explicit local-only mode
  if ((await isLocalModeEnabled()) || authDisabledMode) {
    // Check for a real session cookie first (e.g. from Google OAuth)
    try {
      const cookie = getCookie(event, COOKIE_NAME);
      if (cookie) {
        const email = await getSessionEmail(cookie);
        if (email) return { email, token: cookie };
      }
    } catch {
      // DB not ready yet
    }

    // Also try Better Auth session (for users who created an account then went local)
    try {
      const ba = getBetterAuthSync();
      if (ba) {
        const baSession = await ba.api.getSession({
          headers: event.headers,
        });
        if (baSession?.user?.email) {
          return mapBetterAuthSession(baSession);
        }
      }
    } catch {
      // Better Auth not initialized yet
    }

    return LOCAL_SESSION;
  }

  // 2. ACCESS_TOKEN check (programmatic/agent access)
  const accessTokens = getAccessTokens();
  if (accessTokens.length > 0) {
    const cookie = getCookie(event, COOKIE_NAME);
    if (cookie) {
      const email = await getSessionEmail(cookie);
      if (email) return { email, token: cookie };
    }
  }

  // 3. BYOA custom getSession
  if (customGetSession) {
    const session = await customGetSession(event);
    if (session) return session;
    // Desktop SSO broker: even with BYOA auth, fall back to the broker
    // for Electron requests so cross-template SSO works for custom-auth
    // templates too.
    if (isElectronRequest(event)) {
      const sso = await readDesktopSso();
      if (sso?.email) return { email: sso.email, token: sso.token };
    }
    // Fall through to mobile _session check
  } else {
    // 4. Better Auth session (cookie or Bearer token)
    try {
      const ba = getBetterAuthSync();
      if (ba) {
        const baSession = await ba.api.getSession({
          headers: event.headers,
        });
        if (baSession?.user?.email) {
          // Successful real sign-in — clear the upgrade-pending marker so
          // the dev fallback becomes reachable again for future local work.
          clearUpgradePendingCookie(event);
          return mapBetterAuthSession(baSession);
        }
      }
    } catch {
      // Better Auth not ready
    }

    // 5. Legacy cookie fallback (for sessions created before migration)
    const cookie = getCookie(event, COOKIE_NAME);
    if (cookie) {
      const email = await getSessionEmail(cookie);
      if (email) {
        clearUpgradePendingCookie(event);
        return { email, token: cookie };
      }
    }

    // 5b. Desktop SSO broker fallback.
    // Each template in the Electron desktop app has its own database, so
    // a session token created by one template doesn't resolve in another.
    // When an Electron request has no resolvable session, trust the
    // home-dir SSO record written by whichever template the user signed
    // into. Gated on Electron user-agent so no non-desktop code path
    // consults the file.
    if (isElectronRequest(event)) {
      const sso = await readDesktopSso();
      if (sso?.email) {
        clearUpgradePendingCookie(event);
        return { email: sso.email, token: sso.token };
      }
    }
  }

  // 6. Mobile WebView bridge — _session query param
  const qToken = getQuery(event)?._session as string | undefined;
  if (qToken) {
    const email = await getSessionEmail(qToken);
    if (email) {
      setCookie(event, COOKIE_NAME, qToken, {
        httpOnly: true,
        ...crossSiteCookieAttrs(event),
        path: "/",
        maxAge: sessionMaxAge,
      });
      setResponseHeader(event, "Referrer-Policy", "no-referrer");
      return { email, token: qToken };
    }
  }

  // 7. Dev-mode safety net — in development on a local SQLite database, fall
  // back to local@localhost so the app is usable without any auth configuration.
  // This prevents 401 errors when Better Auth isn't configured, the marker file
  // is missing, or the user simply wants to play around locally.
  //
  // Gated on isLocalDatabase() because local@localhost has no per-user scoping:
  // on a shared DB (Postgres, Turso, D1) this fallback would land every
  // developer on the same account and expose each other's data.
  //
  // EXCEPTION: if the user has explicitly exited local mode (clicked "Upgrade
  // to real account"), they've signaled they want real auth. The upgrade
  // cookie suppresses this fallback so the onboarding/sign-in page is served
  // instead of silently re-authenticating them as local@localhost.
  if (
    isDevEnvironment() &&
    isLocalDatabase() &&
    !isUpgradePending(event) &&
    !hasSignInFlag(event)
  ) {
    return LOCAL_SESSION;
  }

  return null;
}

/**
 * Cookie set by POST /_agent-native/auth/exit-local-mode so we know the user
 * is in the middle of upgrading from local@localhost to a real account.
 * While this cookie is present we skip the dev-mode "auto local session"
 * fallback so the onboarding/sign-in page can actually render.
 * Cleared on successful sign-in/sign-up.
 */
const UPGRADE_COOKIE = "an_upgrade_pending";

function isUpgradePending(event: H3Event): boolean {
  try {
    return getCookie(event, UPGRADE_COOKIE) === "1";
  } catch {
    return false;
  }
}

function setUpgradePendingCookie(event: H3Event): void {
  setCookie(event, UPGRADE_COOKIE, "1", {
    httpOnly: true,
    ...crossSiteCookieAttrs(event),
    path: "/",
    maxAge: 60 * 60, // 1 hour — enough to complete sign-in
  });
}

/**
 * URL-flag fallback for third-party iframe contexts (e.g. the Builder.io
 * editor) where SameSite=Lax cookies from an exit-local-mode POST are not
 * delivered on the subsequent reload. TeamPage reloads with ?signin=1 so
 * we can reliably suppress the dev-mode local fallback without a cookie.
 */
function hasSignInFlag(event: H3Event): boolean {
  try {
    return getQuery(event)?.signin === "1";
  } catch {
    return false;
  }
}

/**
 * Cookie attributes that work in both same-site and third-party iframe
 * contexts. Over HTTPS we emit `SameSite=None; Secure` (required by browsers
 * to ship the cookie back inside a cross-origin iframe); for plain HTTP dev
 * we keep `SameSite=Lax` since `None` requires Secure.
 */
function crossSiteCookieAttrs(event: H3Event): {
  sameSite: "lax" | "none";
  secure: boolean;
} {
  return isHttpsRequest(event)
    ? { sameSite: "none", secure: true }
    : { sameSite: "lax", secure: false };
}

function isHttpsRequest(event: H3Event): boolean {
  try {
    const req: any = (event as any).req ?? event.node?.req;
    const headers: any = req?.headers;
    const get = (k: string): string | undefined => {
      if (!headers) return undefined;
      if (typeof headers.get === "function") {
        return headers.get(k) ?? undefined;
      }
      const v = headers[k];
      return Array.isArray(v) ? v[0] : v;
    };
    const xfProto = get("x-forwarded-proto");
    if (xfProto && String(xfProto).split(",")[0].trim() === "https") {
      return true;
    }
    const url: string | undefined = req?.url;
    if (typeof url === "string" && url.startsWith("https://")) return true;
    const appUrl = process.env.APP_URL || process.env.BETTER_AUTH_URL || "";
    if (appUrl.startsWith("https://")) return true;
  } catch {
    // ignore
  }
  return false;
}

function clearUpgradePendingCookie(event: H3Event): void {
  try {
    deleteCookie(event, UPGRADE_COOKIE, { path: "/" });
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Public path matching
// ---------------------------------------------------------------------------

function isPublicPath(url: string, publicPaths: string[]): boolean {
  const p = url.split("?")[0];
  return publicPaths.some((pp) => p === pp || p.startsWith(pp + "/"));
}

// ---------------------------------------------------------------------------
// Login page HTML (ACCESS_TOKEN mode)
// ---------------------------------------------------------------------------

const TOKEN_LOGIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<title>Sign in</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: #0a0a0a;
    color: #e5e5e5;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
  }
  .card {
    width: 100%;
    max-width: 360px;
    padding: 2rem;
    background: #141414;
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 12px;
  }
  h1 { font-size: 1.125rem; font-weight: 600; margin-bottom: 1.5rem; color: #fff; }
  label { display: block; font-size: 0.8125rem; color: #888; margin-bottom: 0.375rem; }
  input {
    width: 100%;
    padding: 0.625rem 0.75rem;
    background: #1e1e1e;
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 8px;
    color: #e5e5e5;
    font-size: 0.9375rem;
    outline: none;
  }
  input:focus { border-color: rgba(255,255,255,0.3); }
  button {
    width: 100%;
    margin-top: 1rem;
    padding: 0.625rem;
    background: #fff;
    color: #000;
    border: none;
    border-radius: 8px;
    font-size: 0.9375rem;
    font-weight: 500;
    cursor: pointer;
  }
  button:hover { opacity: 0.85; }
  .error { margin-top: 0.75rem; font-size: 0.8125rem; color: #f87171; display: none; }
  .error.show { display: block; }
</style>
</head>
<body>
<div class="card">
  <h1>Sign in</h1>
  <form id="form">
    <label for="token">Access token</label>
    <input id="token" type="password" autocomplete="current-password" autofocus placeholder="Enter access token" />
    <button type="submit">Continue</button>
    <p class="error" id="err">Invalid token. Please try again.</p>
  </form>
</div>
<script>
  document.getElementById('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const token = document.getElementById('token').value;
    const res = await fetch('/_agent-native/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    if (res.ok) {
      window.location.reload();
    } else {
      document.getElementById('err').classList.add('show');
    }
  });
</script>
</body>
</html>`;

// ---------------------------------------------------------------------------
// setAuthModeLocal — write AUTH_MODE=local to .env for the escape hatch
// ---------------------------------------------------------------------------

async function setAuthModeLocal(): Promise<boolean> {
  try {
    const fs = await getFs();
    fs.mkdirSync(path.dirname(LOCAL_MODE_MARKER_PATH), { recursive: true });
    fs.writeFileSync(LOCAL_MODE_MARKER_PATH, "local\n", "utf-8");
    process.env.AUTH_MODE = "local";
    return true;
  } catch {
    return false;
  }
}

async function removeAuthModeLocal(): Promise<boolean> {
  try {
    const fs = await getFs();
    try {
      fs.unlinkSync(LOCAL_MODE_MARKER_PATH);
    } catch {
      // Marker already absent
    }
    delete process.env.AUTH_MODE;
    return true;
  } catch {
    return false;
  }
}

/**
 * POST /_agent-native/auth/migrate-local-data handler. Exposed here (not
 * inlined in a single mount function) because it must be registered from
 * every auth-mount path — including local-mode and fallback — so the
 * upgrade-from-local flow never 500s when BetterAuth init is skipped or
 * failed. Previously this was only mounted inside mountBetterAuthRoutes()
 * which meant that in local mode (or when BetterAuth failed to init) the
 * request fell through to the Nitro SSR renderer and produced a 500.
 */
const migrateLocalDataHandler = defineEventHandler(async (event) => {
  if (getMethod(event) !== "POST") {
    setResponseStatus(event, 405);
    return { error: "Method not allowed" };
  }
  const session = await getSession(event);
  if (!session?.email || session.email === "local@localhost") {
    setResponseStatus(event, 401);
    return { error: "Not authenticated as a real account" };
  }
  try {
    const result = await migrateLocalUserData(session.email);
    return { ok: true, ...result };
  } catch (e: any) {
    console.error("[migrate-local-data] Migration threw for", session.email, e);
    setResponseStatus(event, 500);
    return {
      error: e?.message || "Migration failed",
      stack: isDevEnvironment() ? e?.stack : undefined,
    };
  }
});

// ---------------------------------------------------------------------------
// mountBetterAuthRoutes — Better Auth powered auth with backward-compat routes
// ---------------------------------------------------------------------------

async function mountBetterAuthRoutes(
  app: H3App,
  options: AuthOptions,
): Promise<void> {
  const publicPaths = [...(options.publicPaths ?? [])];

  // The A2A agent card is part of an open protocol — other agents must be
  // able to discover it without auth. Same for favicons and similar probes.
  for (const pp of ["/.well-known", "/favicon.ico", "/favicon.png"]) {
    if (!publicPaths.includes(pp)) publicPaths.push(pp);
  }

  // Auto-add Google OAuth routes when credentials are configured.
  // Templates can override by defining their own Nitro routes at the same
  // paths (e.g. mail/calendar need broader scopes for API access).
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    for (const gp of [
      "/_agent-native/google/callback",
      "/_agent-native/google/auth-url",
    ]) {
      if (!publicPaths.includes(gp)) publicPaths.push(gp);
    }

    const googleScopes = [
      "openid",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile",
    ].join(" ");

    app.use(
      "/_agent-native/google/auth-url",
      defineEventHandler((event) => {
        if (getMethod(event) !== "GET") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        const redirectUri =
          (getQuery(event).redirect_uri as string) ||
          `${getOrigin(event)}/_agent-native/google/callback`;
        const q = getQuery(event);
        const desktop =
          isElectronRequest(event) || q.desktop === "1" || q.desktop === "true";
        const flowId = desktop ? (q.flow_id as string) || undefined : undefined;
        // Validate the caller's return param up front and only embed it
        // into the OAuth state when it normalises to a non-root path —
        // skip embedding "/" (the default fallback) so the state stays
        // small for the common case.
        const returnQuery = q.return;
        const validated =
          typeof returnQuery === "string" ? safeReturnPath(returnQuery) : "/";
        const returnUrl = validated !== "/" ? validated : undefined;
        const state = encodeOAuthState(
          redirectUri,
          undefined,
          desktop,
          false,
          undefined,
          returnUrl,
          flowId,
        );
        const params = new URLSearchParams({
          client_id: process.env.GOOGLE_CLIENT_ID!,
          redirect_uri: redirectUri,
          response_type: "code",
          scope: googleScopes,
          access_type: "online",
          prompt: "select_account",
          state,
        });
        const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
        if (q.redirect === "1") {
          return sendRedirect(event, authUrl, 302);
        }
        return { url: authUrl };
      }),
    );

    app.use(
      "/_agent-native/google/callback",
      defineEventHandler(async (event) => {
        if (getMethod(event) !== "GET") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        try {
          const query = getQuery(event);
          const code = query.code as string;
          if (!code) {
            setResponseStatus(event, 400);
            return { error: "Missing authorization code" };
          }

          const { redirectUri, desktop, returnUrl, flowId } = decodeOAuthState(
            query.state as string | undefined,
            `${getOrigin(event)}/_agent-native/google/callback`,
          );

          const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              code,
              client_id: process.env.GOOGLE_CLIENT_ID!,
              client_secret: process.env.GOOGLE_CLIENT_SECRET!,
              redirect_uri: redirectUri,
              grant_type: "authorization_code",
            }),
          });
          const tokens = await tokenRes.json();
          if (!tokenRes.ok) {
            throw new Error(
              tokens.error_description ||
                tokens.error ||
                "Token exchange failed",
            );
          }

          const userRes = await fetch(
            "https://www.googleapis.com/oauth2/v2/userinfo",
            { headers: { Authorization: `Bearer ${tokens.access_token}` } },
          );
          const user = await userRes.json();
          const email = user.email as string;
          if (!email) throw new Error("Could not get email from Google");

          const { sessionToken } = await createOAuthSession(event, email, {
            hasProductionSession: false,
            desktop,
          });

          if (flowId && sessionToken) {
            _desktopExchanges.set(flowId, {
              token: sessionToken,
              email,
              expiresAt: Date.now() + DESKTOP_EXCHANGE_TTL_MS,
            });
            // Also persist to DB for cross-instance durability (Cloudflare
            // Workers, multi-region). Fire-and-forget — in-memory Map is
            // still the primary fast path for same-instance requests.
            void persistDesktopExchangeToDB(flowId, sessionToken, email);
          }

          return oauthCallbackResponse(event, email, {
            sessionToken,
            desktop,
            returnUrl,
            flowId,
          });
        } catch (error: any) {
          const msg = error.message || "Unknown error";
          return oauthErrorPage(`Connection failed: ${msg}`);
        }
      }),
    );
  }

  // Desktop OAuth exchange — native apps (Tauri tray, Electron) open OAuth
  // in the system browser but need a way to retrieve the session token
  // afterwards since they don't share a cookie jar with the browser.
  app.use(
    "/_agent-native/auth/desktop-exchange",
    defineEventHandler(async (event) => {
      if (getMethod(event) !== "GET") {
        setResponseStatus(event, 405);
        return { error: "Method not allowed" };
      }
      const flowId = getQuery(event).flow_id as string | undefined;
      if (!flowId) {
        setResponseStatus(event, 400);
        return { error: "Missing flow_id" };
      }
      let entry = _desktopExchanges.get(flowId);
      if (!entry || entry.expiresAt < Date.now()) {
        // In-memory miss — fall back to the DB-persisted entry. This handles
        // cross-instance routing (Cloudflare Workers, multi-region) where the
        // OAuth callback and the polling request may hit different isolates.
        const fromDb = await consumeDesktopExchangeFromDB(flowId);
        if (!fromDb) {
          return { pending: true };
        }
        entry = {
          token: fromDb.token,
          email: fromDb.email,
          expiresAt: Date.now() + 1, // already consumed from DB
        };
      }
      _desktopExchanges.delete(flowId);
      return { token: entry.token, email: entry.email };
    }),
  );

  const accessTokens = getAccessTokens();

  // Initialize Better Auth
  const auth = await getBetterAuth(options.betterAuth);

  // Mount Better Auth catch-all handler at /_agent-native/auth/ba/*
  app.use(
    "/_agent-native/auth/ba",
    defineEventHandler(async (event) => {
      const reqPath = event.url?.pathname ?? event.path ?? "";
      const isResetPassword =
        reqPath.includes("reset-password") && getMethod(event) === "POST";

      // Pre-read the body for reset-password so we can extract the
      // token after Better Auth consumes the stream.
      let resetToken: string | undefined;
      if (isResetPassword) {
        try {
          const body = await readBody(event);
          resetToken = body?.token;
        } catch {
          // ignore — Better Auth will handle validation
        }
      }

      const response = await auth.handler(toWebRequest(event));
      const isResponse =
        response != null &&
        typeof (response as any).status === "number" &&
        typeof (response as any).headers?.get === "function";

      // After email verification, add ?verified to the redirect so the
      // login page can show a "Email verified!" success message.
      if (
        reqPath.includes("verify-email") &&
        isResponse &&
        (response as Response).status >= 300 &&
        (response as Response).status < 400
      ) {
        const loc = response.headers.get("location");
        if (loc && !/[?&]verified=/.test(loc)) {
          const sep = loc.includes("?") ? "&" : "?";
          const newResponse = new Response(null, {
            status: response.status,
            headers: new Headers(response.headers),
          });
          newResponse.headers.set("location", loc + sep + "verified=1");
          return newResponse;
        }
      }

      // Auto-verify email after a successful password reset. The user
      // proved email ownership by receiving and using the reset link.
      if (
        isResetPassword &&
        resetToken &&
        isResponse &&
        (response as Response).status >= 200 &&
        (response as Response).status < 300
      ) {
        try {
          const { getDbExec } = await import("../db/client.js");
          const db = getDbExec();
          // Better Auth stores the reset token in its `verification`
          // table with the user's identifier. Look up the user via the
          // token and mark their email as verified — they proved
          // ownership by receiving and using the email-delivered link.
          const rows = await db.execute({
            sql: "SELECT identifier FROM verification WHERE value = ?",
            args: [resetToken],
          });
          const email = rows.rows[0]?.identifier as string | undefined;
          if (email) {
            await db.execute({
              sql: "UPDATE user SET email_verified = 1 WHERE email = ? AND (email_verified = 0 OR email_verified IS NULL)",
              args: [email],
            });
          }
        } catch {
          // Best-effort — don't block the response
        }
      }

      return response;
    }),
  );

  // POST /_agent-native/auth/local-mode — switch to local mode (onboarding escape hatch)
  // Only available in dev — production requires real accounts for usage tracking.
  app.use(
    "/_agent-native/auth/local-mode",
    defineEventHandler(async (event) => {
      if (getMethod(event) !== "POST") {
        setResponseStatus(event, 405);
        return { error: "Method not allowed" };
      }
      if (!isDevEnvironment()) {
        setResponseStatus(event, 403);
        return {
          error:
            "Local mode is not available in production. Create an account to continue.",
        };
      }
      if (!isLocalDatabase()) {
        setResponseStatus(event, 400);
        return {
          error:
            "Local mode is only available on a local SQLite database. Your DATABASE_URL points at a shared database — create an account instead.",
        };
      }
      const ok = await setAuthModeLocal();
      if (!ok) {
        setResponseStatus(event, 500);
        return { error: "Failed to enable local mode" };
      }
      return { ok: true };
    }),
  );

  // POST /_agent-native/auth/exit-local-mode — switch back to real auth
  app.use(
    "/_agent-native/auth/exit-local-mode",
    defineEventHandler(async (event) => {
      if (getMethod(event) !== "POST") {
        setResponseStatus(event, 405);
        return { error: "Method not allowed" };
      }
      const ok = await removeAuthModeLocal();
      if (!ok) {
        setResponseStatus(event, 500);
        return { error: "Failed to disable local mode" };
      }
      // Mark the browser so getSession's dev-mode fallback won't silently
      // re-authenticate the user as local@localhost on the next request.
      setUpgradePendingCookie(event);
      return { ok: true };
    }),
  );

  // Backward-compat: POST /_agent-native/auth/login
  app.use(
    "/_agent-native/auth/login",
    defineEventHandler(async (event) => {
      if (getMethod(event) !== "POST") {
        setResponseStatus(event, 405);
        return { error: "Method not allowed" };
      }

      const body = await readBody(event);

      // Legacy ACCESS_TOKEN login
      if (
        body?.token &&
        typeof body.token === "string" &&
        accessTokens.length > 0
      ) {
        if (!safeTokenMatch(body.token, accessTokens)) {
          setResponseStatus(event, 401);
          return { error: "Invalid token" };
        }
        const sessionToken = crypto.randomBytes(32).toString("hex");
        await addSession(sessionToken, "user");
        setCookie(event, COOKIE_NAME, sessionToken, {
          httpOnly: true,
          ...crossSiteCookieAttrs(event),
          path: "/",
          maxAge: sessionMaxAge,
        });
        return { ok: true };
      }

      // Email/password login via Better Auth
      const email = body?.email?.trim?.()?.toLowerCase?.();
      const password = body?.password;

      if (!email || !password) {
        setResponseStatus(event, 400);
        return { error: "Email and password are required" };
      }

      try {
        const result = await auth.api.signInEmail({
          body: { email, password },
        });
        if (result?.token) {
          setCookie(event, COOKIE_NAME, result.token, {
            httpOnly: true,
            ...crossSiteCookieAttrs(event),
            path: "/",
            maxAge: sessionMaxAge,
          });
          await addSession(result.token, email);
          if (isElectronRequest(event)) {
            await writeDesktopSso({
              email,
              token: result.token,
              expiresAt: Date.now() + sessionMaxAge * 1000,
            });
          }
          return { ok: true };
        }
        // signInEmail succeeded but returned no token — typically means the
        // email isn't verified yet. Don't return { ok: true } without a
        // session or the frontend will reload into a dead end.
        setResponseStatus(event, 403);
        return {
          error:
            "Email not verified. Check your inbox for a verification link.",
        };
      } catch (e: any) {
        setResponseStatus(event, 401);
        return { error: e?.message || "Invalid email or password" };
      }
    }),
  );

  // Backward-compat: POST /_agent-native/auth/register
  app.use(
    "/_agent-native/auth/register",
    defineEventHandler(async (event) => {
      if (getMethod(event) !== "POST") {
        setResponseStatus(event, 405);
        return { error: "Method not allowed" };
      }

      const body = await readBody(event);
      const email = body?.email?.trim?.()?.toLowerCase?.();
      const password = body?.password;

      if (!email || typeof email !== "string" || !email.includes("@")) {
        setResponseStatus(event, 400);
        return { error: "Valid email is required" };
      }
      if (!password || typeof password !== "string" || password.length < 8) {
        setResponseStatus(event, 400);
        return { error: "Password must be at least 8 characters" };
      }

      try {
        await auth.api.signUpEmail({
          body: { email, password, name: email.split("@")[0] },
        });
        return { ok: true };
      } catch (e: any) {
        setResponseStatus(event, 409);
        return { error: e?.message || "Registration failed" };
      }
    }),
  );

  // Backward-compat: POST /_agent-native/auth/logout
  app.use(
    "/_agent-native/auth/logout",
    defineEventHandler(async (event) => {
      const cookie = getCookie(event, COOKIE_NAME);
      if (cookie) await removeSession(cookie);
      deleteCookie(event, COOKIE_NAME, { path: "/" });

      try {
        await auth.api.signOut({ headers: event.headers });
      } catch {
        // Ignore if no Better Auth session
      }

      if (isElectronRequest(event)) await clearDesktopSso();

      return { ok: true };
    }),
  );

  // GET /_agent-native/auth/session
  app.use(
    "/_agent-native/auth/session",
    defineEventHandler(async (event) => {
      if (getMethod(event) !== "GET") {
        setResponseStatus(event, 405);
        return { error: "Method not allowed" };
      }
      const session = await getSession(event);
      return session ?? { error: "Not authenticated" };
    }),
  );

  // POST /_agent-native/auth/migrate-local-data — move local-mode data to
  // the currently signed-in account. Called by the UI after a user upgrades
  // from local mode to a real account so they don't lose their data.
  app.use("/_agent-native/auth/migrate-local-data", migrateLocalDataHandler);

  // GET /_agent-native/auth/reset — HTML page shown when a user clicks the
  // reset link in their email. Reads ?token=... and POSTs to Better Auth's
  // /reset-password endpoint on submit.
  app.use(
    "/_agent-native/auth/reset",
    defineEventHandler((event) => {
      if (getMethod(event) !== "GET") {
        setResponseStatus(event, 405);
        return { error: "Method not allowed" };
      }
      return new Response(getResetPasswordHtml(), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }),
  );

  // Auth guard — stored both in framework middleware registry AND in
  // _authGuardFn so the server middleware can enforce it on ALL routes.
  const loginHtml =
    options.loginHtml ??
    getOnboardingHtml({
      googleOnly: options.googleOnly,
      marketing: options.marketing,
    });
  _authGuardConfig = { loginHtml, publicPaths };
  const guardFn = createAuthGuardFn();
  _authGuardFn = guardFn;
  app.use(defineEventHandler(guardFn));
}

// ---------------------------------------------------------------------------
// mountTokenOnlyRoutes — ACCESS_TOKEN-only auth (no Better Auth)
// ---------------------------------------------------------------------------

function mountTokenOnlyRoutes(
  app: H3App,
  accessTokens: string[],
  publicPaths: string[] = [],
): void {
  app.use(
    "/_agent-native/auth/login",
    defineEventHandler(async (event) => {
      if (getMethod(event) !== "POST") {
        setResponseStatus(event, 405);
        return { error: "Method not allowed" };
      }

      const body = await readBody(event);
      if (
        !body?.token ||
        typeof body.token !== "string" ||
        !safeTokenMatch(body.token, accessTokens)
      ) {
        setResponseStatus(event, 401);
        return { error: "Invalid token" };
      }
      const sessionToken = crypto.randomBytes(32).toString("hex");
      await addSession(sessionToken, "user");
      setCookie(event, COOKIE_NAME, sessionToken, {
        httpOnly: true,
        ...crossSiteCookieAttrs(event),
        path: "/",
        maxAge: sessionMaxAge,
      });
      return { ok: true };
    }),
  );

  app.use(
    "/_agent-native/auth/logout",
    defineEventHandler(async (event) => {
      const cookie = getCookie(event, COOKIE_NAME);
      if (cookie) await removeSession(cookie);
      deleteCookie(event, COOKIE_NAME, { path: "/" });
      if (isElectronRequest(event)) await clearDesktopSso();
      return { ok: true };
    }),
  );

  app.use(
    "/_agent-native/auth/session",
    defineEventHandler(async (event) => {
      if (getMethod(event) !== "GET") {
        setResponseStatus(event, 405);
        return { error: "Method not allowed" };
      }
      const session = await getSession(event);
      return session ?? { error: "Not authenticated" };
    }),
  );
  app.use("/_agent-native/auth/migrate-local-data", migrateLocalDataHandler);

  _authGuardConfig = { loginHtml: TOKEN_LOGIN_HTML, publicPaths };
  const guardFn = createAuthGuardFn();
  _authGuardFn = guardFn;
  app.use(defineEventHandler(guardFn));
}

// ---------------------------------------------------------------------------
// mountLocalModeRoutes — stub routes for AUTH_MODE=local
// ---------------------------------------------------------------------------

function mountLocalModeRoutes(app: H3App): void {
  app.use(
    "/_agent-native/auth/session",
    defineEventHandler(async (event) => {
      if (getMethod(event) !== "GET") {
        setResponseStatus(event, 405);
        return { error: "Method not allowed" };
      }
      return await getSession(event);
    }),
  );
  app.use(
    "/_agent-native/auth/login",
    defineEventHandler(() => ({ ok: true })),
  );
  app.use(
    "/_agent-native/auth/logout",
    defineEventHandler(() => ({ ok: true })),
  );
  // Allow exiting local mode to switch to real auth
  app.use(
    "/_agent-native/auth/exit-local-mode",
    defineEventHandler(async (event) => {
      if (getMethod(event) !== "POST") {
        setResponseStatus(event, 405);
        return { error: "Method not allowed" };
      }
      const ok = await removeAuthModeLocal();
      if (!ok) {
        setResponseStatus(event, 500);
        return { error: "Failed to disable local mode" };
      }
      // Mark the browser so getSession's dev-mode fallback won't silently
      // re-authenticate the user as local@localhost on the next request.
      setUpgradePendingCookie(event);
      return { ok: true };
    }),
  );
  // Upgrade path: migrate-local-data must be reachable from local mode
  // because the user is still in local mode when they trigger the upgrade.
  app.use("/_agent-native/auth/migrate-local-data", migrateLocalDataHandler);
}

// ---------------------------------------------------------------------------
// mountAuthFallbackRoutes — minimal auth endpoints when Better Auth init fails
// ---------------------------------------------------------------------------

function mountAuthFallbackRoutes(app: H3App): void {
  app.use(
    "/_agent-native/auth/login",
    defineEventHandler(async (event) => {
      if (getMethod(event) !== "POST") {
        setResponseStatus(event, 405);
        return { error: "Method not allowed" };
      }

      const body = await readBody(event);
      const email = body?.email?.trim?.()?.toLowerCase?.();
      const password = body?.password;

      if (!email || !password) {
        setResponseStatus(event, 400);
        return { error: "Email and password are required" };
      }

      try {
        const auth = await getBetterAuth();
        const result = await auth.api.signInEmail({
          body: { email, password },
        });
        if (result?.token) {
          setCookie(event, COOKIE_NAME, result.token, {
            httpOnly: true,
            ...crossSiteCookieAttrs(event),
            path: "/",
            maxAge: sessionMaxAge,
          });
          await addSession(result.token, email);
          if (isElectronRequest(event)) {
            await writeDesktopSso({
              email,
              token: result.token,
              expiresAt: Date.now() + sessionMaxAge * 1000,
            });
          }
          return { ok: true };
        }
        setResponseStatus(event, 403);
        return {
          error:
            "Email not verified. Check your inbox for a verification link.",
        };
      } catch (e: any) {
        setResponseStatus(event, 401);
        return { error: e?.message || "Invalid email or password" };
      }
    }),
  );

  app.use(
    "/_agent-native/auth/register",
    defineEventHandler(async (event) => {
      if (getMethod(event) !== "POST") {
        setResponseStatus(event, 405);
        return { error: "Method not allowed" };
      }

      const body = await readBody(event);
      const email = body?.email?.trim?.()?.toLowerCase?.();
      const password = body?.password;

      if (!email || typeof email !== "string" || !email.includes("@")) {
        setResponseStatus(event, 400);
        return { error: "Valid email is required" };
      }
      if (!password || typeof password !== "string" || password.length < 8) {
        setResponseStatus(event, 400);
        return { error: "Password must be at least 8 characters" };
      }

      try {
        const auth = await getBetterAuth();
        await auth.api.signUpEmail({
          body: { email, password, name: email.split("@")[0] },
        });
        return { ok: true };
      } catch (e: any) {
        setResponseStatus(event, 409);
        return { error: e?.message || "Registration failed" };
      }
    }),
  );

  app.use(
    "/_agent-native/auth/logout",
    defineEventHandler(async (event) => {
      const cookie = getCookie(event, COOKIE_NAME);
      if (cookie) await removeSession(cookie);
      deleteCookie(event, COOKIE_NAME, { path: "/" });

      try {
        const auth = await getBetterAuth();
        await auth.api.signOut({ headers: event.headers });
      } catch {
        // Ignore if Better Auth is still unavailable
      }

      if (isElectronRequest(event)) await clearDesktopSso();

      return { ok: true };
    }),
  );

  app.use(
    "/_agent-native/auth/local-mode",
    defineEventHandler(async (event) => {
      if (getMethod(event) !== "POST") {
        setResponseStatus(event, 405);
        return { error: "Method not allowed" };
      }
      if (!isDevEnvironment()) {
        setResponseStatus(event, 403);
        return {
          error:
            "Local mode is not available in production. Create an account to continue.",
        };
      }
      if (!isLocalDatabase()) {
        setResponseStatus(event, 400);
        return {
          error:
            "Local mode is only available on a local SQLite database. Your DATABASE_URL points at a shared database — create an account instead.",
        };
      }
      const ok = await setAuthModeLocal();
      if (!ok) {
        setResponseStatus(event, 500);
        return { error: "Failed to enable local mode" };
      }
      return { ok: true };
    }),
  );

  app.use(
    "/_agent-native/auth/exit-local-mode",
    defineEventHandler(async (event) => {
      if (getMethod(event) !== "POST") {
        setResponseStatus(event, 405);
        return { error: "Method not allowed" };
      }
      const ok = await removeAuthModeLocal();
      if (!ok) {
        setResponseStatus(event, 500);
        return { error: "Failed to disable local mode" };
      }
      // Mark the browser so getSession's dev-mode fallback won't silently
      // re-authenticate the user as local@localhost on the next request.
      setUpgradePendingCookie(event);
      return { ok: true };
    }),
  );

  app.use(
    "/_agent-native/auth/session",
    defineEventHandler(async (event) => {
      if (getMethod(event) !== "GET") {
        setResponseStatus(event, 405);
        return { error: "Method not allowed" };
      }
      const session = await getSession(event);
      return session ?? { error: "Not authenticated" };
    }),
  );

  // Must be reachable from fallback mode too — otherwise a user who
  // upgrades-from-local on a server that couldn't init Better Auth gets a
  // 500 instead of a clear 401.
  app.use("/_agent-native/auth/migrate-local-data", migrateLocalDataHandler);
}

// ---------------------------------------------------------------------------
// autoMountAuth — the recommended entry point
// ---------------------------------------------------------------------------

/**
 * Automatically configure auth based on environment and configuration:
 *
 * - **AUTH_MODE=local**: Auth bypassed. `getSession()` returns `{ email: "local@localhost" }`.
 *   This is the explicit escape hatch for solo local development.
 * - **BYOA (custom getSession)**: Template-provided auth callback handles everything.
 * - **AUTH_DISABLED=true**: Auth bypassed (for infrastructure-level auth like Cloudflare Access).
 * - **ACCESS_TOKEN/ACCESS_TOKENS**: Simple token-based auth.
 * - **Default**: Better Auth with email/password, social providers, organizations, and JWT.
 *   Users see an onboarding page to create an account on first visit.
 *
 * Returns true if auth was mounted, false if skipped.
 */
export async function autoMountAuth(
  app: H3App,
  options: AuthOptions = {},
): Promise<boolean> {
  // If auth is already mounted on THIS app (e.g., default plugin ran before
  // custom plugin in the same server boot), don't re-mount routes — but DO
  // update the live config if custom options like googleOnly or loginHtml
  // were provided. createAuthGuardFn() reads from _authGuardConfig on every
  // request, so updating it here takes effect immediately.
  //
  // We gate on `_mountedApp === app` because module-level state survives
  // Vite HMR — without this check, an HMR-restarted Nitro instance (fresh
  // H3 app, empty middleware) would short-circuit here and end up with no
  // auth routes mounted at all.
  if (_authGuardFn && _mountedApp === app) {
    // A custom getSession always wins — even if the default auth plugin
    // mounted first (which happens in production where bootstrapDefaultPlugins
    // can't see the template's server/plugins/ dir and auto-mounts defaults).
    if (options.getSession) {
      customGetSession = options.getSession;
    }
    if (_authGuardConfig) {
      if (options.googleOnly || options.loginHtml || options.marketing) {
        _authGuardConfig.loginHtml =
          options.loginHtml ??
          getOnboardingHtml({
            googleOnly: options.googleOnly,
            marketing: options.marketing,
          });
      }
      if (options.publicPaths) {
        _authGuardConfig.publicPaths = [
          ...(_authGuardConfig.publicPaths ?? []),
          ...options.publicPaths,
        ];
      }
    }
    return true;
  }

  // Fresh app (first boot, or HMR created a new Nitro instance) — reset
  // the guard so the mount path below installs it on the new app.
  _authGuardFn = null;
  _authGuardConfig = null;
  _mountedApp = app;

  if (!app) {
    if ((await isLocalModeEnabled()) || isDevEnvironment()) {
      authDisabledMode = false;
      customGetSession = null;
      return false;
    }
    throw new Error(
      "autoMountAuth: H3 app is required. In Nitro plugins, pass nitroApp.h3App.",
    );
  }

  // Reset globals
  customGetSession = null;
  authDisabledMode = false;
  sessionMaxAge = options.maxAge ?? DEFAULT_MAX_AGE;
  const publicPaths = options.publicPaths ?? [];

  if (options.getSession) {
    customGetSession = options.getSession;
  }

  // AUTH_MODE=local — explicit local-only mode (escape hatch)
  if (await isLocalModeEnabled()) {
    try {
      // Mount the standard auth endpoints and guard even in local mode so the
      // app can switch back to real auth immediately after AUTH_MODE is
      // cleared, without waiting for a server restart/remount.
      await mountBetterAuthRoutes(app, options);
    } catch (err) {
      console.error(
        "[agent-native] Failed to initialize Better Auth in local mode:",
        err,
      );
      mountLocalModeRoutes(app);
    }
    console.log("[agent-native] Auth mode: local (upgrade path enabled).");
    return false;
  }

  // BYOA — custom getSession provider
  if (customGetSession) {
    app.use(
      "/_agent-native/auth/session",
      defineEventHandler(async (event) => {
        if (getMethod(event) !== "GET") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        const session = await getSession(event);
        return session ?? { error: "Not authenticated" };
      }),
    );
    app.use(
      "/_agent-native/auth/login",
      defineEventHandler(() => ({ ok: true })),
    );
    app.use(
      "/_agent-native/auth/logout",
      defineEventHandler(async (event) => {
        const cookie = getCookie(event, COOKIE_NAME);
        if (cookie) await removeSession(cookie);
        deleteCookie(event, COOKIE_NAME, { path: "/" });
        if (isElectronRequest(event)) await clearDesktopSso();
        return { ok: true };
      }),
    );
    app.use("/_agent-native/auth/migrate-local-data", migrateLocalDataHandler);

    const byoaLoginHtml = options.loginHtml ?? TOKEN_LOGIN_HTML;
    _authGuardConfig = { loginHtml: byoaLoginHtml, publicPaths };
    const guardFn = createAuthGuardFn();
    _authGuardFn = guardFn;
    app.use(defineEventHandler(guardFn));

    if (process.env.DEBUG)
      console.log("[agent-native] Auth enabled — custom getSession provider.");
    return true;
  }

  // AUTH_DISABLED — skip auth (infrastructure-level auth)
  if (process.env.AUTH_DISABLED === "true") {
    authDisabledMode = true;
    console.warn(
      "[agent-native] AUTH_DISABLED=true — running without auth. " +
        "Ensure this app is behind infrastructure-level auth (Cloudflare Access, VPN, etc.).",
    );
    mountLocalModeRoutes(app);
    return false;
  }

  // ACCESS_TOKEN-only mode
  const tokens = getAccessTokens();
  if (tokens.length > 0) {
    mountTokenOnlyRoutes(app, tokens, publicPaths);
    if (process.env.DEBUG)
      console.log(
        `[agent-native] Auth enabled — ${tokens.length} access token(s) configured.`,
      );
    return true;
  }

  // Default: Better Auth (account-first)
  try {
    await mountBetterAuthRoutes(app, options);
    if (process.env.DEBUG)
      console.log(
        "[agent-native] Auth enabled — Better Auth (accounts + organizations).",
      );
  } catch (err) {
    console.error("[agent-native] Failed to initialize Better Auth:", err);
    mountAuthFallbackRoutes(app);
    // CRITICAL: Even if Better Auth fails, register the auth guard so
    // unauthenticated users can't access the app. They'll see the login
    // page but won't be able to sign in until the DB is available.
    const loginHtml =
      options.loginHtml ??
      getOnboardingHtml({
        googleOnly: options.googleOnly,
        marketing: options.marketing,
      });
    _authGuardConfig = { loginHtml, publicPaths };
    const guardFn = createAuthGuardFn();
    _authGuardFn = guardFn;
    app.use(defineEventHandler(guardFn));
    console.log(
      "[agent-native] Auth guard registered despite init failure — app is locked.",
    );
  }
  return true;
}

// ---------------------------------------------------------------------------
// Deprecated — kept for backward compat
// ---------------------------------------------------------------------------

/**
 * @deprecated Use `autoMountAuth(app, options?)` instead.
 */
export function mountAuthMiddleware(app: H3App, accessToken: string): void {
  mountTokenOnlyRoutes(app, [accessToken]);
}
