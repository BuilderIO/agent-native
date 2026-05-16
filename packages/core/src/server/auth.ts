import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  defineEventHandler,
  getMethod,
  getQuery,
  getRequestIP,
  sendRedirect,
  setResponseHeader,
  setResponseStatus,
  getCookie,
  setCookie,
  deleteCookie,
  getHeader,
} from "h3";
import type { H3Event } from "h3";
import type { H3AppShim } from "./framework-request-handler.js";

// In h3 v2, `event.req` IS the web Request — but in Nitro's dev server (srvx
// runtime), event.url and event.req share the same underlying URL object.
// When registerMiddleware strips the mount prefix from event.url.pathname, it
// also mutates event.req.url (NodeRequestURL setter updates nodeReq.url).
// Better Auth's router uses new URL(request.url).pathname to extract the
// sub-route, so it must receive the original full URL — not the stripped one.
// registerMiddleware saves the original pathname in event.context so we can
// reconstruct a fresh Request with the correct URL here.
function toWebRequest(event: H3Event): Request {
  const req = (event as any).req as Request;
  const ctx = (event as any).context as
    | { _mountedPathname?: string; _mountPrefix?: string }
    | undefined;
  if (ctx?._mountedPathname && ctx._mountPrefix) {
    try {
      const url = new URL(req.url);
      const mountedPathname = stripAppBasePath(ctx._mountedPathname);
      if (url.pathname !== mountedPathname) {
        url.pathname = mountedPathname;
        const method = req.method.toUpperCase();
        const hasBody = method !== "GET" && method !== "HEAD";
        return new Request(url.href, {
          method: req.method,
          headers: req.headers,
          // Body may already be partially consumed; pass through as-is.
          // GET/HEAD cannot have a body — omit to avoid spec errors.
          ...(hasBody ? { body: req.body, duplex: "half" } : {}),
        } as any);
      }
    } catch {
      // URL reconstruction failed — fall through and use original req.
    }
  }
  return req;
}

type H3App = H3AppShim;
import {
  getDbExec,
  isPostgres,
  intType,
  retryOnDdlRace,
} from "../db/client.js";
import { getBetterAuth, getBetterAuthSync } from "./better-auth-instance.js";
import type { BetterAuthConfig } from "./better-auth-instance.js";
import {
  getAllowedCorsOrigin,
  readCorsAllowedOrigins,
} from "./cors-origins.js";
import { getOnboardingHtml, getResetPasswordHtml } from "./onboarding-html.js";
import type { GoogleAuthMode } from "./google-auth-mode.js";
import { readBody } from "../server/h3-helpers.js";
import {
  readDesktopSso,
  writeDesktopSso,
  clearDesktopSso,
} from "./desktop-sso.js";
import {
  isElectron as isElectronRequest,
  getOrigin,
  getAppBasePath,
  getAppUrl,
  encodeOAuthState,
  decodeOAuthState,
  createOAuthSession,
  oauthCallbackResponse,
  oauthErrorPage,
  resolveOAuthRedirectUri,
  isAllowedOAuthRedirectUri,
} from "./google-oauth.js";
import { safeOAuthReturnUrl } from "./oauth-return-url.js";
import { captureAuthError } from "./sentry.js";
import { extractOAuthStateAppId } from "../shared/oauth-state.js";
import { isValidWorkspaceAppIdFormat } from "../shared/workspace-app-id.js";
import {
  normalizeWorkspaceAppAudience,
  workspaceAppAudienceFromEnv,
  workspaceAppRouteAccessFromEnv,
  type WorkspaceAppAudience,
} from "../shared/workspace-app-audience.js";
import {
  BUILDER_CONNECT_OWNER_COOKIE,
  BUILDER_CONNECT_PARAM,
  BUILDER_STATE_PARAM,
  verifyBuilderCallbackStateAndGetOwner,
  verifyBuilderConnectTokenAndGetOwner,
} from "./builder-browser.js";

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
   * Workspace-level audience for the app.
   *
   * "internal" keeps the existing behavior: every app page requires an
   * authenticated workspace member unless listed in publicPaths.
   *
   * "public" lets unauthenticated visitors load page routes, while framework
   * and API routes remain protected unless explicitly listed in publicPaths.
   */
  workspaceAppAudience?: WorkspaceAppAudience;
  /**
   * Workspace app page paths that anonymous visitors can load.
   * Uses the same prefix matching as publicPaths, but only for page routes:
   * framework, API, and .well-known routes stay protected.
   */
  workspaceAppPublicPaths?: string[];
  /**
   * Workspace app page paths that still require auth when the app audience is
   * public. Useful for public sites with login-only admin/management pages.
   */
  workspaceAppProtectedPaths?: string[];
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
   * Mount the framework's generic Google sign-in routes.
   *
   * Set this to false when a template owns `/_agent-native/google/auth-url`
   * and `/_agent-native/google/callback` itself because it needs broader
   * product scopes and persisted API tokens, not just identity sign-in.
   */
  mountGoogleOAuthRoutes?: boolean;
  /**
   * Additional Google OAuth scopes to request beyond the default identity
   * scopes (`openid`, `email`, `profile`). When set, Better Auth's Google
   * social provider asks for these up front, requests a refresh token
   * (`access_type=offline`), and forces the consent screen so the refresh
   * token is reissued on every sign-in.
   *
   * Tokens land in Better Auth's `account` table, and a database hook
   * mirrors them into `oauth_tokens` so template code (mail's Gmail client,
   * calendar's events fetcher, etc.) can pick them up without a separate
   * "Connect Google" round-trip.
   *
   * Example for the mail template:
   * ```ts
   * googleScopes: [
   *   "https://www.googleapis.com/auth/gmail.readonly",
   *   "https://www.googleapis.com/auth/gmail.send",
   * ],
   * ```
   */
  googleScopes?: string[];
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
    runLocalCommand?: string;
  };
  /**
   * Optional host-scoped notice shown before the built-in Google sign-in
   * redirects to Google.
   */
  googleSignInNotice?: {
    host?: string;
    title: string;
    body: string | string[];
    continueLabel?: string;
    cancelLabel?: string;
  };
  /**
   * Google sign-in flow: `'popup'`, `'redirect'`, or `'auto'` (default).
   *
   * - `'auto'` — popup in normal browsers and Builder web iframes, redirect in
   *   Electron and Builder desktop preview/editor surfaces.
   * - `'popup'` — force popup everywhere.
   * - `'redirect'` — force redirect everywhere.
   *
   * Falls back to the `GOOGLE_AUTH_MODE` env var, then `'auto'`.
   */
  googleAuthMode?: GoogleAuthMode;
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
 *
 * Workspace exception: in workspace mode (`AGENT_NATIVE_WORKSPACE=1`),
 * every app shares the same origin AND the same DB, and cross-app SSO is
 * the desired behavior — signing into Dispatch should mean you're signed
 * in across the workspace's other apps too. Per-app suffixes break that.
 * Use a single workspace-wide cookie so the legacy `an_session_*` token
 * flow set by `setFrameworkSessionCookie` (which the Builder OAuth popup
 * exchange relies on — see `desktop-exchange` and `oauthCallbackResponse`)
 * is recognised by every app in the workspace.
 *
 * Cross-subdomain exception: when `COOKIE_DOMAIN` is set (e.g.
 * `.agent-native.com` for first-party deploys where each app is its own
 * subdomain — mail.agent-native.com, calendar.agent-native.com, …),
 * use the unsuffixed `an_session` and emit `Domain=<COOKIE_DOMAIN>` so
 * the cookie is shared across every subdomain. Signing into one app
 * signs the user into all of them. Per-app suffixes would defeat the
 * shared cookie since each subdomain reads a different name.
 */
function readPackageJsonName(): string {
  try {
    const pkgPath = path.join(process.cwd(), "package.json");
    const raw = fs.readFileSync(pkgPath, "utf8");
    const parsed = JSON.parse(raw) as { name?: unknown };
    return typeof parsed.name === "string" ? parsed.name : "";
  } catch {
    return "";
  }
}

function slugifyAppName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Resolve the per-app cookie suffix.
 *
 * - Explicit `APP_NAME` wins everywhere (prod + dev).
 * - In dev only, fall back to `npm_package_name` (set automatically by
 *   npm/pnpm/yarn/bun when running a script) and then to `package.json:name`
 *   so two templates running side-by-side on `localhost:<portA>` and
 *   `localhost:<portB>` do not stomp on a shared `an_session` cookie.
 *   Browsers scope cookies by host (NOT host+port — RFC 6265), so a single
 *   `an_session` is shared across every `localhost:*` dev server otherwise.
 * - In production this fallback is intentionally disabled — switching a
 *   live deploy from `an_session` to `an_session_<name>` would invalidate
 *   every existing user session (the server only reads `COOKIE_NAME`).
 *   Real prod deploys set `APP_NAME` or `COOKIE_DOMAIN` explicitly.
 */
function resolveAppNameSlug(): string {
  const explicit = process.env.APP_NAME;
  if (explicit) return slugifyAppName(explicit);
  if (process.env.NODE_ENV === "production") return "";
  const fromNpm = process.env.npm_package_name;
  if (fromNpm) return slugifyAppName(fromNpm);
  return slugifyAppName(readPackageJsonName());
}

const APP_NAME_SLUG = resolveAppNameSlug();
const IS_WORKSPACE_MODE = process.env.AGENT_NATIVE_WORKSPACE === "1";

/**
 * When set, the framework session cookie is shared across every subdomain
 * matching this domain (e.g. `.agent-native.com`). Reads `COOKIE_DOMAIN`.
 * Returns undefined when unset so cookies stay scoped to the origin host.
 */
export function getCookieDomain(): string | undefined {
  const raw = process.env.COOKIE_DOMAIN;
  if (!raw) return undefined;
  const trimmed = raw.trim();
  return trimmed || undefined;
}

const HAS_COOKIE_DOMAIN = !!getCookieDomain();

export const COOKIE_NAME = HAS_COOKIE_DOMAIN
  ? "an_session"
  : IS_WORKSPACE_MODE
    ? "an_session_workspace"
    : APP_NAME_SLUG
      ? `an_session_${APP_NAME_SLUG}`
      : "an_session";

/**
 * Cookie prefix used by Better Auth. In prod it stays `"an"` so existing
 * session cookies (`an.session_token`, `an.session_data`, `an.csrf_token`)
 * keep working. In dev with a resolved slug, it becomes `"an_<slug>"`
 * so two templates on `localhost` do not collide.
 */
export const BETTER_AUTH_COOKIE_PREFIX =
  HAS_COOKIE_DOMAIN || IS_WORKSPACE_MODE || !APP_NAME_SLUG
    ? "an"
    : `an_${APP_NAME_SLUG}`;

/**
 * Cookie domain attribute spread into every `setCookie`/`deleteCookie`.
 * Empty when `COOKIE_DOMAIN` isn't set so the cookie stays scoped to the
 * single origin (current production default for non-first-party apps).
 */
export function cookieDomainAttrs(): { domain?: string } {
  const domain = getCookieDomain();
  return domain ? { domain } : {};
}

function getCookieValues(event: H3Event, name: string): string[] {
  const values: string[] = [];
  const raw = getHeader(event, "cookie");

  if (raw) {
    for (const part of String(raw).split(";")) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      if (trimmed.slice(0, eq).trim() !== name) continue;

      let value = trimmed.slice(eq + 1).trim();
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }
      try {
        value = decodeURIComponent(value);
      } catch {
        // Keep the raw cookie value if it was not percent-encoded.
      }
      if (value && !values.includes(value)) values.push(value);
    }
  }

  // H3's cookie parser keeps only the first duplicate name. Preserve it as a
  // fallback for mock/runtime shapes that do not expose the raw Cookie header.
  const parsed = getCookie(event, name);
  if (parsed && !values.includes(parsed)) values.push(parsed);

  return values;
}

function getFrameworkSessionCookieValues(event: H3Event): string[] {
  return getCookieValues(event, COOKIE_NAME);
}

function frameworkSessionCookieNamesToClear(): string[] {
  const names = new Set([COOKIE_NAME]);
  if (APP_NAME_SLUG) names.add(`an_session_${APP_NAME_SLUG}`);
  return [...names];
}

function deleteCookieFromEveryScope(event: H3Event, name: string): void {
  // Clear host-only cookies first. When COOKIE_DOMAIN was introduced, stale
  // host-only `an_session` cookies could shadow the new domain cookie because
  // browsers send older same-path duplicates first.
  deleteCookie(event, name, { path: "/" });
  const domainAttrs = cookieDomainAttrs();
  if (domainAttrs.domain) {
    deleteCookie(event, name, { path: "/", ...domainAttrs });
  }
}

function clearFrameworkSessionCookies(event: H3Event): void {
  for (const name of frameworkSessionCookieNamesToClear()) {
    deleteCookieFromEveryScope(event, name);
  }
}

async function getLegacyCookieSession(
  event: H3Event,
): Promise<AuthSession | null> {
  for (const cookie of getFrameworkSessionCookieValues(event)) {
    const email = await getSessionEmail(cookie);
    if (email) return { email, token: cookie };
  }
  return null;
}
function getOAuthStateAppId(): string | undefined {
  const raw = process.env.APP_NAME || process.env.npm_package_name;
  if (!raw) return undefined;
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || undefined;
}

function oauthDebugFlowId(flowId: unknown): string | undefined {
  return typeof flowId === "string" && flowId ? flowId.slice(-10) : undefined;
}

function oauthDebugUrlPath(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  try {
    const url = new URL(value);
    return url.pathname;
  } catch {
    return undefined;
  }
}

function isBuilderOAuthRequest(event: H3Event): boolean {
  const userAgent = getHeader(event, "user-agent") || "";
  const referer = getHeader(event, "referer") || "";
  return (
    /Electron/i.test(userAgent) ||
    /builder\.(io|my)|builderio\.(xyz|dev)|builder\.codes/i.test(referer)
  );
}

function builderPreviewReturnOrigin(event: H3Event): string | undefined {
  const referer = getHeader(event, "referer") || "";
  if (!referer) return undefined;
  try {
    const url = new URL(referer);
    const hostname = url.hostname.toLowerCase();
    if (
      url.protocol === "https:" &&
      (hostname === "builderio.xyz" ||
        hostname.endsWith(".builderio.xyz") ||
        hostname === "builderio.dev" ||
        hostname.endsWith(".builderio.dev") ||
        hostname === "builder.codes" ||
        hostname.endsWith(".builder.codes") ||
        hostname === "builder.my" ||
        hostname.endsWith(".builder.my"))
    ) {
      return url.origin;
    }
  } catch {}
  return undefined;
}

function logGoogleOAuthDebug(
  event: H3Event,
  phase: string,
  details: Record<string, unknown> = {},
): void {
  const { flowId, ...rest } = details;
  const reqUrl = event.node?.req?.url ?? event.path ?? "";
  const path = reqUrl.split("?")[0] || undefined;
  const userAgent = getHeader(event, "user-agent") || "";
  const referer = getHeader(event, "referer") || "";
  console.info("[agent-native][google-oauth]", {
    phase,
    app: getOAuthStateAppId(),
    path,
    flow: oauthDebugFlowId(flowId),
    electron: /Electron/i.test(userAgent),
    agentNativeDesktop: /AgentNativeDesktop/i.test(userAgent),
    builderReferrer:
      /builder\.(io|my)|builderio\.(xyz|dev)|builder\.codes/i.test(referer),
    ...rest,
  });
}
const DEFAULT_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

// ---------------------------------------------------------------------------
// Environment helpers
// ---------------------------------------------------------------------------

/**
 * Check if we're in a development/test environment.
 * Used for cookie security settings, not for auth bypass.
 */
export function isDevEnvironment(): boolean {
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

/**
 * Read the desktop-SSO broker file, but only if the request is plausibly
 * from the Electron desktop app *and* coming from the local machine.
 *
 * The broker file lives in the user's home directory and trusts the local
 * trust boundary — a non-loopback request that pretends to be Electron
 * via User-Agent must NEVER be allowed to read it. We additionally refuse
 * any read in production builds: the desktop app launches with
 * `NODE_ENV=development` (or unset), and any web-hosted production deploy
 * has no business consulting a per-user file on the server's homedir
 * even if one exists.
 *
 * Returns null when the safety checks fail or the file isn't present.
 */
async function readDesktopSsoSafely(
  event: H3Event,
): Promise<Awaited<ReturnType<typeof readDesktopSso>>> {
  if (process.env.NODE_ENV === "production") return null;
  if (!isElectronRequest(event)) return null;
  // Loopback-only: 127.0.0.1, ::1, and the IPv4-mapped form.
  let ip: string | undefined;
  try {
    ip = getRequestIP(event) ?? undefined;
  } catch {
    ip = undefined;
  }
  // Strip an optional zone id (e.g. "fe80::1%en0") before comparing.
  const normalised = (ip ?? "").split("%")[0];
  const isLoopback =
    normalised === "127.0.0.1" ||
    normalised === "::1" ||
    normalised === "::ffff:127.0.0.1" ||
    normalised.startsWith("127.");
  if (!isLoopback) return null;
  return await readDesktopSso();
}

/**
 * Extract the framework session token from a Better Auth response's
 * Set-Cookie headers, if any. Used by the password-reset path to skip
 * the freshly-minted session when revoking sibling sessions for the
 * user. Returns undefined if no session cookie was minted (the common
 * case — Better Auth's reset doesn't auto-sign-in by default).
 */
function extractSessionTokenFromSetCookies(
  response: Response,
): string | undefined {
  try {
    // Headers may have multiple Set-Cookie entries; iterate via getSetCookie
    // when available (Node 20+ / undici), else fall back to comma split.
    const headers = response.headers as Headers & {
      getSetCookie?: () => string[];
    };
    const setCookies =
      typeof headers.getSetCookie === "function"
        ? headers.getSetCookie()
        : (headers.get("set-cookie") ?? "")
            .split(/,(?=[^;]+=)/)
            .map((s) => s.trim())
            .filter(Boolean);
    for (const sc of setCookies) {
      // Better Auth's session cookie name is configurable but defaults to
      // `<prefix>.session_token`. Match either the Better Auth default or
      // our COOKIE_NAME (`an_session`) on the same line.
      const match = sc.match(
        /(?:^|\s|;)(an_session|[\w.-]*session_token)=([^;]+)/i,
      );
      if (match) return match[2];
    }
  } catch {
    // Best-effort; treat as no token.
  }
  return undefined;
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

function getBearerSessionToken(event: H3Event): string | undefined {
  const auth = getHeader(event, "authorization");
  if (!auth) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
  return match?.[1]?.trim() || undefined;
}

async function getBearerLegacySession(
  event: H3Event,
): Promise<AuthSession | null> {
  const bearerToken = getBearerSessionToken(event);
  if (!bearerToken) return null;
  const email = await getSessionEmail(bearerToken);
  return email ? { email, token: bearerToken } : null;
}

function shouldExposeSessionTokenInBody(event: H3Event): boolean {
  const origin = getHeader(event, "origin");
  if (origin && DESKTOP_AUTH_TOKEN_BODY_ORIGINS.has(origin)) return true;

  // Some native WebViews do not consistently emit an Origin header for
  // programmatic fetches. The desktop app marks same-server requests with
  // X-Request-Source; browsers can only use that cross-origin after our CORS
  // allowlist has approved the origin, and same-origin pages already receive
  // an equivalent httpOnly session cookie on successful login.
  return !origin && getHeader(event, "x-request-source") === "clips-desktop";
}

function authLoginResponse(
  event: H3Event,
  token: string,
  email?: string,
): { ok: true; token?: string; email?: string } {
  if (!shouldExposeSessionTokenInBody(event)) return { ok: true };
  return email ? { ok: true, token, email } : { ok: true, token };
}

/**
 * Bad-credential / already-registered errors are normal user behavior, not
 * bugs we want to investigate. Filtering them out keeps Sentry signal
 * actionable — a real anomaly (DB error, Better Auth init crash, missing
 * table) shows up clearly because it doesn't match any of these patterns.
 */
const EXPECTED_AUTH_FAILURE_PATTERNS: RegExp[] = [
  /invalid\s+(email|password|credentials)/i,
  /password.*incorrect/i,
  /user\s+(not\s+found|already\s+exists)/i,
  /email\s+already/i,
  /already\s+(exists|registered|in\s+use)/i,
  /not\s+verified/i,
];

function isExpectedAuthFailure(error: unknown): boolean {
  const msg = (error as { message?: unknown })?.message;
  if (typeof msg !== "string") return false;
  return EXPECTED_AUTH_FAILURE_PATTERNS.some((re) => re.test(msg));
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

/**
 * Mutable config for the auth guard. Stored separately from the guard function
 * so that a custom auth plugin can update the login HTML / public paths even
 * after the default plugin has already installed the middleware (a race that
 * occurs in production serverless environments where the default plugin is
 * auto-mounted before the template's custom auth plugin runs).
 */
interface AuthGuardConfig {
  loginHtml: string;
  getLoginHtml?: (event: H3Event, rawPath: string) => string;
  publicPaths: string[];
  workspaceAppAudience: WorkspaceAppAudience;
  workspaceAppPublicPaths: string[];
  workspaceAppProtectedPaths: string[];
}
let _authGuardConfig: AuthGuardConfig | null = null;
const _genericGoogleOAuthRoutesEnabled = new WeakMap<object, boolean>();

function resolveWorkspaceAppAudience(
  options: Pick<AuthOptions, "workspaceAppAudience"> = {},
): WorkspaceAppAudience {
  return normalizeWorkspaceAppAudience(
    options.workspaceAppAudience ?? workspaceAppAudienceFromEnv(),
  );
}

function resolveWorkspaceAppRouteAccess(
  options: Pick<
    AuthOptions,
    "workspaceAppPublicPaths" | "workspaceAppProtectedPaths"
  > = {},
): { publicPaths: string[]; protectedPaths: string[] } {
  const env = workspaceAppRouteAccessFromEnv();
  return {
    publicPaths: options.workspaceAppPublicPaths ?? env.publicPaths,
    protectedPaths: options.workspaceAppProtectedPaths ?? env.protectedPaths,
  };
}

function setGenericGoogleOAuthRoutesEnabled(
  app: H3App,
  enabled: boolean,
): void {
  if (app && typeof app === "object") {
    _genericGoogleOAuthRoutesEnabled.set(app, enabled);
  }
}

function areGenericGoogleOAuthRoutesEnabled(app: H3App): boolean {
  return _genericGoogleOAuthRoutesEnabled.get(app as object) !== false;
}

// Desktop OAuth exchange store — holds session tokens keyed by a unique flow
// ID so native apps (Tauri, Electron) that open OAuth in the system browser
// can retrieve the token after the callback completes on the server.
//
// Primary: in-memory Map (fast, works for single-instance dev/preview builds).
// Fallback: sessions table with a "dex:" prefixed key for cross-instance
// durability (Cloudflare Workers, multi-region deployments). The value stored
// in the `email` column is "{realToken}::{userEmail}" so both can be recovered
// from a single DB lookup.
export interface DesktopExchangeErrorPayload {
  message: string;
  code?: string;
  accountId?: string;
  existingOwner?: string;
  attemptedOwner?: string;
}

type DesktopExchangeEntry =
  | { token: string; email: string; expiresAt: number }
  | { error: DesktopExchangeErrorPayload; expiresAt: number };
type DesktopExchangeStoredEntry =
  | { token: string; email: string }
  | { error: DesktopExchangeErrorPayload };

const _desktopExchanges = new Map<string, DesktopExchangeEntry>();
const DESKTOP_EXCHANGE_ERROR_PREFIX = "__error__::";
const DESKTOP_AUTH_TOKEN_BODY_ORIGINS = new Set([
  "tauri://localhost",
  "http://localhost:1420",
]);

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
  // Persist to DB so the token survives cross-instance routing (e.g. when
  // templates call this helper directly instead of going through the OAuth
  // callback path).
  void persistDesktopExchangeToDB(flowId, token, email);
}

export function setDesktopExchangeError(
  flowId: string,
  error: DesktopExchangeErrorPayload,
) {
  _desktopExchanges.set(flowId, {
    error,
    expiresAt: Date.now() + DESKTOP_EXCHANGE_TTL_MS,
  });
  void persistDesktopExchangeErrorToDB(flowId, error);
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

async function persistDesktopExchangeErrorToDB(
  flowId: string,
  error: DesktopExchangeErrorPayload,
): Promise<void> {
  try {
    const payload = Buffer.from(JSON.stringify(error)).toString("base64url");
    await addSession(
      `dex:${flowId}`,
      `${DESKTOP_EXCHANGE_ERROR_PREFIX}${payload}`,
    );
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
): Promise<DesktopExchangeStoredEntry | null> {
  try {
    // Atomic DELETE...RETURNING prevents token replay: two concurrent polls
    // cannot both retrieve the token because only one DELETE will match the row.
    // SQLite ≥3.35 and PostgreSQL both support this syntax.
    // The created_at predicate enforces the 5-minute TTL so stale DB entries
    // (e.g. the desktop app never polled) are rejected rather than silently
    // redeemed with the session table's default 30-day TTL.
    const client = getDbExec();
    const { rows } = await client.execute({
      sql: `DELETE FROM sessions WHERE token = ? AND created_at > ? RETURNING email`,
      args: [`dex:${flowId}`, Date.now() - DESKTOP_EXCHANGE_TTL_MS],
    });
    if (rows.length === 0) return null;
    const packed = (rows[0].email ?? rows[0][0]) as string | null;
    if (!packed) return null;
    if (packed.startsWith(DESKTOP_EXCHANGE_ERROR_PREFIX)) {
      const raw = packed.slice(DESKTOP_EXCHANGE_ERROR_PREFIX.length);
      return {
        error: JSON.parse(Buffer.from(raw, "base64url").toString()),
      };
    }
    const sepIdx = packed.indexOf("::");
    if (sepIdx === -1) return null;
    return { token: packed.slice(0, sepIdx), email: packed.slice(sepIdx + 2) };
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
function applyCorsHeaders(event: H3Event): {
  hasOrigin: boolean;
  allowed: boolean;
} {
  // Framework-level CORS. The auth guard runs before any of the app's own
  // route handlers, so we need to set CORS here too — otherwise a 401
  // response would be missing the Allow-Origin header and the browser
  // blocks the response body (making it look like a network error
  // rather than "unauthenticated").
  const origin = getHeader(event, "origin");
  if (!origin) return { hasOrigin: false, allowed: true };
  const allowedOrigin = getAllowedCorsOrigin(origin, {
    allowedOrigins: readCorsAllowedOrigins(),
    allowLocalhostWhenNoAllowlist: true,
  });
  if (!allowedOrigin) return { hasOrigin: true, allowed: false };
  setResponseHeader(event, "Access-Control-Allow-Origin", allowedOrigin);
  setResponseHeader(event, "Vary", "Origin");
  setResponseHeader(event, "Access-Control-Allow-Credentials", "true");
  setResponseHeader(
    event,
    "Access-Control-Allow-Methods",
    "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS",
  );
  setResponseHeader(
    event,
    "Access-Control-Allow-Headers",
    "Content-Type,Authorization,X-Requested-With,X-Request-Source,X-Agent-Native-CSRF",
  );
  return { hasOrigin: true, allowed: true };
}

function createAuthCorsHandler() {
  return defineEventHandler((event) => {
    const cors = applyCorsHeaders(event);
    if (getMethod(event) !== "OPTIONS") return;

    if (cors.hasOrigin && !cors.allowed) {
      setResponseStatus(event, 403);
      return "";
    }

    setResponseStatus(event, 204);
    return "";
  });
}

function mountAuthCorsMiddleware(app: H3App): void {
  const handler = createAuthCorsHandler();
  app.use("/_agent-native/auth", handler);
  app.use("/_agent-native/google", handler);
}

function isWorkspaceOAuthCallbackRelayEnabled(): boolean {
  return (
    process.env.AGENT_NATIVE_WORKSPACE === "1" ||
    process.env.VITE_AGENT_NATIVE_WORKSPACE === "1"
  );
}

function isFrameworkOAuthCallbackPath(pathname: string): boolean {
  return (
    pathname.startsWith("/_agent-native/") &&
    (pathname.endsWith("/callback") || pathname.includes("/callback/"))
  );
}

function getRequestPathAndSearch(event: H3Event): {
  rawPath: string;
  search: string;
} {
  const mountedPathname = (event as any).context?._mountedPathname;
  if (typeof mountedPathname === "string" && mountedPathname) {
    return { rawPath: mountedPathname, search: event.url?.search || "" };
  }
  const url = event.node?.req?.url ?? event.path ?? "/";
  const queryStart = url.indexOf("?");
  return {
    rawPath: queryStart >= 0 ? url.slice(0, queryStart) : url,
    search: queryStart >= 0 ? url.slice(queryStart) : "",
  };
}

function workspaceOAuthCallbackRelayResponse(
  event: H3Event,
): Response | undefined {
  const { rawPath, search } = getRequestPathAndSearch(event);
  const normalizedPath = stripAppBasePath(rawPath);
  const basePath = getAppBasePath();
  if (
    !basePath ||
    !isWorkspaceOAuthCallbackRelayEnabled() ||
    !isFrameworkOAuthCallbackPath(normalizedPath) ||
    rawPath === `${basePath}/_agent-native` ||
    rawPath.startsWith(`${basePath}/_agent-native/`)
  ) {
    return undefined;
  }

  const state = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search,
  ).get("state");
  const appId = extractOAuthStateAppId(state);
  if (
    !appId ||
    appId === getOAuthStateAppId() ||
    !isValidWorkspaceAppIdFormat(appId)
  ) {
    return undefined;
  }

  return new Response("", {
    status: 302,
    headers: { Location: `/${appId}${normalizedPath}${search}` },
  });
}

function verifiedBuilderConnectOwnerFromUrl(url: string): string | null {
  const queryStart = url.indexOf("?");
  if (queryStart < 0) return null;
  const token = new URLSearchParams(url.slice(queryStart + 1)).get(
    BUILDER_CONNECT_PARAM,
  );
  return verifyBuilderConnectTokenAndGetOwner(token);
}

function shouldBypassAuthForBuilderConnect(event: H3Event, p: string): boolean {
  if (p === "/_agent-native/builder/connect") {
    const url = event.node?.req?.url ?? event.path ?? "/";
    return Boolean(verifiedBuilderConnectOwnerFromUrl(url));
  }

  if (p === "/_agent-native/builder/callback") {
    const url = event.node?.req?.url ?? event.path ?? "/";
    const queryStart = url.indexOf("?");
    const state =
      queryStart >= 0
        ? new URLSearchParams(url.slice(queryStart + 1)).get(
            BUILDER_STATE_PARAM,
          )
        : null;
    // The signed `_an_state` only authenticates the popup back to our app
    // when the redirect chain through Builder dropped the session cookie
    // (preview hosts, third-party-cookie blockers, etc). It is NOT a
    // bearer credential that should let *any* request through. We bypass
    // the auth guard only when no session exists (the legitimate
    // session-lost popup case) — when a session IS present, the normal
    // guard runs and the callback handler cross-checks the state owner
    // against the session.
    const hasSession = Boolean(getCookie(event, COOKIE_NAME));
    if (hasSession) return false;
    return Boolean(
      verifyBuilderCallbackStateAndGetOwner(state) ||
      verifyBuilderConnectTokenAndGetOwner(
        getCookie(event, BUILDER_CONNECT_OWNER_COOKIE),
      ),
    );
  }

  return false;
}

function createAuthGuardFn(): (
  event: H3Event,
) => Promise<Response | object | string | void> {
  return async (event: H3Event) => {
    const config = _authGuardConfig;
    if (!config) return;
    const { publicPaths } = config;

    const url = event.node?.req?.url ?? event.path ?? "/";
    const queryStart = url.indexOf("?");
    const rawPath = queryStart >= 0 ? url.slice(0, queryStart) : url;
    const loginHtml = config.getLoginHtml?.(event, rawPath) ?? config.loginHtml;
    const p = stripAppBasePath(rawPath);
    const normalizedUrl = queryStart >= 0 ? `${p}${url.slice(queryStart)}` : p;
    const callbackRelay = workspaceOAuthCallbackRelayResponse(event);
    if (callbackRelay) return callbackRelay;

    // Emit CORS headers on every request the guard sees so that even
    // error responses (401) reach the browser.
    const cors = applyCorsHeaders(event);
    // Preflight short-circuit: the browser sends OPTIONS before the real
    // credentialed request. Must return success without invoking auth.
    if (getMethod(event) === "OPTIONS") {
      if (cors.hasOrigin && !cors.allowed) {
        setResponseStatus(event, 403);
        return "";
      }
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

    // Internal processor endpoint for the integration webhook fanout. The
    // webhook handler enqueues a task to SQL and dispatches a fresh HTTP POST
    // to this endpoint so the agent loop runs in its own function execution
    // (cross-platform serverless-safe — see `integrations/webhook-handler.ts`).
    // Authenticity is verified via an HMAC token signed with A2A_SECRET, plus
    // an atomic SQL claim that prevents duplicate processing.
    if (p === "/_agent-native/integrations/process-task") {
      return;
    }

    // Internal processor endpoint for deferred A2A continuations created by
    // integration tasks. It uses the same HMAC internal-token scheme as the
    // primary integration processor, so it must bypass cookie/session auth.
    if (p === "/_agent-native/integrations/process-a2a-continuation") {
      return;
    }

    // A2A endpoint verifies authenticity via JWT signed with the org's A2A
    // secret (or the global A2A_SECRET fallback), not via session cookies.
    if (p === "/_agent-native/a2a") {
      return;
    }

    // Internal processor endpoint for the A2A async-mode fanout. Mirrors the
    // integration webhook fanout: when `message/send` is called with
    // `async: true`, the JSON-RPC handler enqueues to a2a_tasks and self-
    // fires a POST here so the handler runs in a fresh function execution.
    // Authenticity is verified via an HMAC token signed with A2A_SECRET
    // (same scheme as /_agent-native/integrations/process-task).
    if (p === "/_agent-native/a2a/_process-task") {
      return;
    }

    // A2A secret receive endpoint — verifies authenticity via JWT signed
    // with the calling app's A2A secret, not via session cookies. Used to
    // sync the org A2A secret across connected apps.
    if (p === "/_agent-native/org/a2a-secret/receive") {
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
      const queryStr = queryStart >= 0 ? url.slice(queryStart + 1) : "";
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

    // Auth entry pages are framework-owned pages, not app routes. When a user
    // already has a session, redirect them back to the mounted app instead of
    // letting React Router try to render /login.
    if (p === "/login" || p === "/signup") {
      const session = await getSession(event);
      if (session) {
        return new Response("", {
          status: 302,
          headers: { Location: getAppBasePath() || "/" },
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

    // React Router 7's lazy route discovery fetches `/__manifest?p=...` to
    // resolve manifest patches for `<Link>`s the user might click. The
    // auth fallback returning loginHtml here makes RR fail to parse the
    // body as RSC, surfacing as a console error and (when the visitor
    // already errored elsewhere) blocking the app from rendering. Let it
    // through — it returns a tiny RSC-encoded manifest of the public
    // route tree, no per-user data.
    if (p === "/__manifest") return;
    if (isPublicPath(normalizedUrl, publicPaths)) return;
    if (shouldBypassAuthForBuilderConnect(event, p)) return;
    if (isPublicWorkspacePageRequest(event, p, config)) {
      return;
    }

    const session = await getSession(event);
    if (session) return;

    if (p.startsWith("/api/") || p.startsWith("/_agent-native/")) {
      setResponseStatus(event, 401);
      return { error: "Unauthorized" };
    }

    // Local-dev convenience: on the first page GET of a freshly-scaffolded
    // app, transparently create + sign in `dev@local` instead of showing the
    // sign-up form. Gated on NODE_ENV=development AND no real users in the
    // DB, so production and any app that has ever had a real signup are
    // unaffected. See maybeAutoCreateDevSession for full conditions.
    if (getMethod(event) === "GET") {
      const autoSession = await maybeAutoCreateDevSession(event, url);
      if (autoSession) return autoSession;
    }

    return new Response(loginHtml, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  };
}

const AUTO_DEV_ACCOUNT_EMAIL = "dev@local";
const AUTO_DEV_ACCOUNT_PASSWORD = "local-dev-account";

/**
 * Local-dev convenience: skip the sign-up wall on first run.
 *
 * When NODE_ENV=development AND the `user` table has no rows for any
 * email other than `dev@local`, transparently sign up (or sign back in
 * to) the auto-managed dev account and return a 302 to the original URL
 * with a session cookie set. A developer who just ran `pnpm dev` lands
 * in the app immediately instead of being asked to fill in name + email
 * + password to try the framework.
 *
 * Auto-create fires exactly once per local DB: as soon as `dev@local`
 * (or any real user) exists in the `user` table, the helper returns
 * null and the normal login flow takes over. Signing out then leaves
 * the user on the regular sign-in form; without this guard the
 * post-logout reload would silently re-create the session.
 *
 * The fixed password is intentional: it means a developer who signs
 * out can sign back in with `dev@local` / `local-dev-account` from
 * the regular login form. To get the auto-flow back, drop the user
 * row or wipe the local DB. Set
 * `AGENT_NATIVE_DISABLE_AUTO_DEV_ACCOUNT=1` to opt out entirely
 * (useful for tests that exercise the unauthenticated branch). This
 * is local-only — the helper is gated on NODE_ENV.
 */
async function maybeAutoCreateDevSession(
  event: H3Event,
  redirectTo: string,
): Promise<Response | null> {
  if (!isDevEnvironment()) return null;
  if (process.env.AGENT_NATIVE_DISABLE_AUTO_DEV_ACCOUNT === "1") return null;

  try {
    const db = getDbExec();
    const { rows: realUsers } = await db.execute({
      sql: 'SELECT 1 FROM "user" WHERE email != ? LIMIT 1',
      args: [AUTO_DEV_ACCOUNT_EMAIL],
    });
    if (realUsers.length > 0) return null;

    // If `dev@local` already exists, this is not a freshly-scaffolded
    // app — the user has been through the auto-create flow at least
    // once. Skip auto-create so signing out actually works: without
    // this guard, the post-logout reload immediately re-creates the
    // session and the user is stuck in dev@local forever (or has to
    // set AGENT_NATIVE_DISABLE_AUTO_DEV_ACCOUNT=1). To get the demo
    // experience back, drop the row or wipe the local DB.
    const { rows: devUsers } = await db.execute({
      sql: 'SELECT 1 FROM "user" WHERE email = ? LIMIT 1',
      args: [AUTO_DEV_ACCOUNT_EMAIL],
    });
    if (devUsers.length > 0) return null;

    const auth = await getBetterAuth();
    if (!auth) return null;

    // Idempotent sign-up: succeeds on first run, throws an "already exists"
    // failure on subsequent runs (which we swallow before falling through
    // to the sign-in path below).
    try {
      await auth.api.signUpEmail({
        body: {
          email: AUTO_DEV_ACCOUNT_EMAIL,
          password: AUTO_DEV_ACCOUNT_PASSWORD,
          name: "Dev",
        },
      });
    } catch (e) {
      if (!isExpectedAuthFailure(e)) throw e;
    }

    const result = await auth.api.signInEmail({
      body: {
        email: AUTO_DEV_ACCOUNT_EMAIL,
        password: AUTO_DEV_ACCOUNT_PASSWORD,
      },
    });
    if (!result?.token) return null;

    setFrameworkSessionCookie(event, result.token);
    await addSession(result.token, AUTO_DEV_ACCOUNT_EMAIL);

    return new Response("", {
      status: 302,
      headers: { Location: redirectTo },
    });
  } catch (e) {
    // Local-dev only — log to console for debugging, but don't surface
    // through Sentry. Falling back to the regular login form is the
    // correct user-facing behavior when this path fails.
    console.warn("[agent-native] auto dev account skipped:", e);
    return null;
  }
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
 * 1. ACCESS_TOKEN → check legacy cookie-based token sessions
 * 2. BYOA custom getSession → delegate to template callback
 * 3. Bearer legacy session → check Authorization: Bearer against sessions
 * 4. Better Auth → check session via Better Auth API (cookie or Bearer)
 * 5. Legacy cookie → check an_session cookie in legacy sessions table
 * 6. Desktop SSO broker (Electron loopback only)
 * 7. Mobile _session query param → promote to cookie
 *
 * Returns `null` for unauthenticated requests. There is no dev-mode bypass:
 * local development uses the same Better Auth signup flow as production. The
 * onboarding/sign-in page is served by `runAuthGuard` for any unauthenticated
 * page load.
 */
export async function getSession(event: H3Event): Promise<AuthSession | null> {
  // 1. ACCESS_TOKEN check (programmatic/agent access)
  const accessTokens = getAccessTokens();
  if (accessTokens.length > 0) {
    const cookieSession = await getLegacyCookieSession(event);
    if (cookieSession) return cookieSession;
  }

  // 2. BYOA custom getSession
  if (customGetSession) {
    const session = await customGetSession(event);
    if (session) return session;

    const bearerSession = await getBearerLegacySession(event);
    if (bearerSession) return bearerSession;

    // Desktop SSO broker: even with BYOA auth, fall back to the broker
    // for Electron requests so cross-template SSO works for custom-auth
    // templates too. Gated on `readDesktopSsoSafely` so a non-loopback
    // request that spoofs `User-Agent: ... Electron/...` cannot read the
    // home-dir broker file (and so production builds never consult it).
    const sso = await readDesktopSsoSafely(event);
    if (sso?.email) return { email: sso.email, token: sso.token };
    // Fall through to mobile _session check
  } else {
    // 3. Bearer legacy session. Desktop/native clients can persist a session
    // token outside the WebView cookie jar and attach it to all app requests.
    const bearerSession = await getBearerLegacySession(event);
    if (bearerSession) return bearerSession;

    // 4. Better Auth session (cookie or Bearer token)
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
    } catch (e) {
      console.error("[auth] ba.api.getSession error:", e);
    }

    // 5. Legacy cookie fallback (for sessions created before migration)
    const cookieSession = await getLegacyCookieSession(event);
    if (cookieSession) return cookieSession;

    // 6. Desktop SSO broker fallback.
    // Each template in the Electron desktop app has its own database, so
    // a session token created by one template doesn't resolve in another.
    // When an Electron request has no resolvable session, trust the
    // home-dir SSO record written by whichever template the user signed
    // into. Gated on `readDesktopSsoSafely`: requires Electron User-Agent,
    // a loopback (127.0.0.1 / ::1) source IP, and a non-production NODE_ENV
    // — anything else is rejected so a hostile network request cannot
    // impersonate whichever email last signed into the desktop app.
    const sso = await readDesktopSsoSafely(event);
    if (sso?.email) {
      return { email: sso.email, token: sso.token };
    }
  }

  // 7. Mobile WebView bridge — _session query param
  const querySession = await promoteQuerySession(event);
  if (querySession) return querySession;

  return null;
}

async function promoteQuerySession(
  event: H3Event,
): Promise<AuthSession | null> {
  const qToken = getQuery(event)?._session as string | undefined;
  if (!qToken) return null;
  const email = await getSessionEmail(qToken);
  if (!email) return null;
  setFrameworkSessionCookie(event, qToken);
  setResponseHeader(event, "Referrer-Policy", "no-referrer");
  return { email, token: qToken };
}

function isReadMethod(event: H3Event): boolean {
  const method = getMethod(event);
  return method === "GET" || method === "HEAD";
}

/**
 * Cookie attributes that work in both same-site and third-party iframe
 * contexts. Over HTTPS we emit `SameSite=None; Secure; Partitioned` —
 * `None`+`Secure` is required by browsers to ship the cookie back inside a
 * cross-origin iframe at all; `Partitioned` keeps the cookie working under
 * Chrome's third-party-cookie deprecation by binding it to the embedding
 * site's storage partition. (Better Auth already sets the same trio on its
 * own session cookie; this matches so the framework's legacy cookie —
 * which the Builder OAuth popup exchange writes via
 * `setFrameworkSessionCookie` — survives iframe contexts too.) Plain-HTTP
 * dev keeps the default `SameSite=Lax`; `None` requires Secure, and
 * `Partitioned` only takes effect alongside `Secure`.
 */
function crossSiteCookieAttrs(event: H3Event): {
  sameSite: "lax" | "none";
  secure: boolean;
  partitioned?: boolean;
} {
  return isHttpsRequest(event)
    ? { sameSite: "none", secure: true, partitioned: true }
    : { sameSite: "lax", secure: false };
}

export function setFrameworkSessionCookie(event: H3Event, token: string): void {
  clearFrameworkSessionCookies(event);
  setCookie(event, COOKIE_NAME, token, {
    httpOnly: true,
    ...crossSiteCookieAttrs(event),
    ...cookieDomainAttrs(),
    path: "/",
    maxAge: sessionMaxAge,
  });
}

function isHttpsRequest(event: H3Event): boolean {
  try {
    const xfProto = getHeader(event, "x-forwarded-proto");
    if (xfProto && String(xfProto).split(",")[0].trim() === "https") {
      return true;
    }
    const req: any = (event as any).req ?? event.node?.req;
    const url: string | undefined = req?.url;
    if (typeof url === "string" && url.startsWith("https://")) return true;
    const appUrl = process.env.APP_URL || process.env.BETTER_AUTH_URL || "";
    if (appUrl.startsWith("https://")) return true;
  } catch {
    // ignore
  }
  return false;
}

// ---------------------------------------------------------------------------
// Public path matching
// ---------------------------------------------------------------------------

function isPublicPath(url: string, publicPaths: string[]): boolean {
  const p = url.split("?")[0];
  return matchesPathList(p, publicPaths);
}

function matchesPathList(path: string, paths: string[]): boolean {
  return paths.some((candidate) => {
    const normalized =
      candidate.length > 1 && candidate.endsWith("/")
        ? candidate.slice(0, -1)
        : candidate;
    return path === normalized || path.startsWith(normalized + "/");
  });
}

function isPublicWorkspacePageRequest(
  event: H3Event,
  path: string,
  config: AuthGuardConfig,
): boolean {
  if (!isReadMethod(event)) return false;
  if (
    path === "/_agent-native" ||
    path.startsWith("/_agent-native/") ||
    path === "/api" ||
    path.startsWith("/api/") ||
    path === "/.well-known" ||
    path.startsWith("/.well-known/")
  ) {
    return false;
  }
  if (matchesPathList(path, config.workspaceAppProtectedPaths)) return false;
  if (matchesPathList(path, config.workspaceAppPublicPaths)) return true;
  return config.workspaceAppAudience === "public";
}

function stripAppBasePath(pathname: string): string {
  const basePath = getAppBasePath();
  if (!basePath) return pathname;
  if (pathname === basePath) return "/";
  if (pathname.startsWith(`${basePath}/`)) {
    return pathname.slice(basePath.length) || "/";
  }
  return pathname;
}

// ---------------------------------------------------------------------------
// Login page HTML (ACCESS_TOKEN mode)
// ---------------------------------------------------------------------------

function inferWorkspaceBasePathFromRequest(requestPath?: string): string {
  if (
    process.env.AGENT_NATIVE_WORKSPACE !== "1" &&
    process.env.VITE_AGENT_NATIVE_WORKSPACE !== "1"
  ) {
    return "";
  }
  if (!requestPath || !requestPath.startsWith("/")) return "";
  const firstSegment = requestPath.split(/[/?#]/)[1];
  if (!firstSegment) return "";
  const reservedRootPaths = new Set([
    "_agent-native",
    ".well-known",
    "api",
    "login",
    "signup",
    "apps",
    "new-app",
    "approval",
    "extensions",
  ]);
  if (reservedRootPaths.has(firstSegment)) return "";
  if (!isValidWorkspaceAppIdFormat(firstSegment)) return "";
  return `/${firstSegment}`;
}

function getTokenLoginHtml(options: { requestPath?: string } = {}): string {
  const configuredBasePath =
    getAppBasePath() || inferWorkspaceBasePathFromRequest(options.requestPath);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<title>Private app</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    color-scheme: dark;
    --bg: #09090b;
    --panel: #141417;
    --panel-soft: #1b1b20;
    --border: rgba(255,255,255,0.1);
    --border-strong: rgba(255,255,255,0.18);
    --text: #f4f4f5;
    --muted: #a1a1aa;
    --subtle: #71717a;
    --error: #fca5a5;
    --error-bg: rgba(127,29,29,0.18);
    --success: #86efac;
    --success-bg: rgba(20,83,45,0.2);
    --info: #c4b5fd;
    --info-bg: rgba(76,29,149,0.18);
  }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background:
      radial-gradient(circle at top left, rgba(63,63,70,0.24), transparent 32rem),
      linear-gradient(180deg, #111114 0%, var(--bg) 58%);
    color: var(--text);
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    padding: 1rem;
  }
  .card {
    width: 100%;
    max-width: 420px;
    padding: 2rem;
    background: color-mix(in srgb, var(--panel) 94%, transparent);
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow: 0 24px 80px rgba(0,0,0,0.35);
  }
  .eyebrow {
    display: inline-flex;
    align-items: center;
    min-height: 1.5rem;
    padding: 0 0.625rem;
    margin-bottom: 1rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    color: var(--muted);
    background: rgba(255,255,255,0.04);
    font-size: 0.75rem;
    font-weight: 500;
  }
  h1 {
    font-size: 1.375rem;
    line-height: 1.2;
    font-weight: 650;
    margin-bottom: 0.5rem;
    color: var(--text);
    letter-spacing: 0;
  }
  .intro {
    margin-bottom: 1.5rem;
    color: var(--muted);
    font-size: 0.9375rem;
    line-height: 1.55;
  }
  label {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.75rem;
    font-size: 0.8125rem;
    color: var(--muted);
    margin-bottom: 0.375rem;
  }
  label span:last-child {
    color: var(--subtle);
    font-size: 0.75rem;
  }
  .input-wrap { position: relative; }
  input {
    width: 100%;
    min-height: 2.75rem;
    padding: 0.625rem 0.75rem;
    background: #0f0f12;
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text);
    font-size: 0.9375rem;
    outline: none;
  }
  input:focus {
    border-color: var(--border-strong);
    box-shadow: 0 0 0 3px rgba(255,255,255,0.08);
  }
  input::placeholder { color: #52525b; }
  button {
    width: 100%;
    min-height: 2.75rem;
    margin-top: 1rem;
    padding: 0.625rem 0.875rem;
    background: var(--text);
    color: #000;
    border: none;
    border-radius: 8px;
    font-size: 0.9375rem;
    font-weight: 600;
    cursor: pointer;
    transition: transform 120ms ease, opacity 120ms ease, background 120ms ease;
  }
  button:hover:not(:disabled) { background: #e4e4e7; transform: translateY(-1px); }
  button:disabled { opacity: 0.55; cursor: wait; }
  .hint {
    margin-top: 0.75rem;
    color: var(--subtle);
    font-size: 0.8125rem;
    line-height: 1.45;
  }
  .msg {
    display: none;
    margin-top: 0.875rem;
    padding: 0.75rem;
    border-radius: 8px;
    font-size: 0.8125rem;
    line-height: 1.45;
  }
  .msg.show { display: block; }
  .msg.error {
    color: var(--error);
    background: var(--error-bg);
    border: 1px solid rgba(248,113,113,0.22);
  }
  .msg.success {
    color: var(--success);
    background: var(--success-bg);
    border: 1px solid rgba(74,222,128,0.18);
  }
  .msg.info {
    color: var(--info);
    background: var(--info-bg);
    border: 1px solid rgba(167,139,250,0.2);
  }
  details {
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px solid var(--border);
  }
  summary {
    cursor: pointer;
    color: var(--muted);
    font-size: 0.8125rem;
    font-weight: 600;
  }
  details p {
    margin-top: 0.75rem;
    color: var(--subtle);
    font-size: 0.8125rem;
    line-height: 1.5;
  }
  code {
    color: #e4e4e7;
    background: var(--panel-soft);
    border: 1px solid var(--border);
    border-radius: 5px;
    padding: 0.075rem 0.25rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.78rem;
  }
  @media (max-width: 480px) {
    .card { padding: 1.5rem; }
    h1 { font-size: 1.25rem; }
  }
</style>
</head>
<body>
<div class="card">
  <div class="eyebrow">Private deployment</div>
  <h1>This app is private</h1>
  <p class="intro">Enter the shared app access token to continue. This is the value configured for this app, not your deploy provider account token.</p>
  <form id="form">
    <label for="token"><span>App ACCESS_TOKEN</span><span>Required</span></label>
    <div class="input-wrap">
      <input id="token" type="password" autocomplete="current-password" autofocus placeholder="Paste the shared app token" />
    </div>
    <button id="submit" type="submit">Continue</button>
    <p class="hint">If someone sent you this app, ask them for the shared app token. If you own the deploy, use the exact value saved as <code>ACCESS_TOKEN</code> or one of <code>ACCESS_TOKENS</code>.</p>
    <p class="msg error" id="msg" role="alert"></p>
  </form>
  <details>
    <summary>Where do I find this?</summary>
    <p>Create or copy the app's shared token from your deployment environment variables. The key should be <code>ACCESS_TOKEN</code> for one token or <code>ACCESS_TOKENS</code> for a comma-separated list. Redeploy after changing it.</p>
  </details>
</div>
<script>
  var configuredBasePath = ${JSON.stringify(configuredBasePath)};
  function __anBasePath() {
    if (
      configuredBasePath &&
      (window.location.pathname === configuredBasePath ||
        window.location.pathname.indexOf(configuredBasePath + '/') === 0)
    ) {
      return configuredBasePath;
    }
    var marker = '/_agent-native';
    var idx = window.location.pathname.indexOf(marker);
    return idx > 0 ? window.location.pathname.slice(0, idx) : '';
  }
  function __anPath(path) {
    return __anBasePath() + path;
  }
  function setMessage(kind, text) {
    var msg = document.getElementById('msg');
    msg.textContent = text;
    msg.className = 'msg ' + kind + ' show';
  }
  function clearMessage() {
    var msg = document.getElementById('msg');
    msg.textContent = '';
    msg.className = 'msg error';
  }
  function setBusy(isBusy) {
    var button = document.getElementById('submit');
    var input = document.getElementById('token');
    button.disabled = isBusy;
    input.disabled = isBusy;
    button.textContent = isBusy ? 'Checking...' : 'Continue';
  }
  async function readJsonSafely(res) {
    try {
      return await res.json();
    } catch (_err) {
      return null;
    }
  }
  async function verifySession() {
    var res = await fetch(__anPath('/_agent-native/auth/session'), {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) return false;
    var data = await readJsonSafely(res);
    return !!data && !data.error;
  }
  document.getElementById('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    var token = document.getElementById('token').value.trim();
    if (!token) {
      setMessage('error', 'Paste the shared app token to continue.');
      return;
    }
    clearMessage();
    setBusy(true);
    setMessage('info', 'Checking the app token...');
    try {
      var res = await fetch(__anPath('/_agent-native/auth/login'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        credentials: 'same-origin',
        body: JSON.stringify({ token: token }),
      });
      if (!res.ok) {
        var badTokenMessage = 'That token was not accepted. Use this app\\'s shared ACCESS_TOKEN, not your deploy provider account token.';
        if (res.status === 404) {
          badTokenMessage = 'Could not reach this app\\'s auth endpoint. If this app is mounted under a path, confirm APP_BASE_PATH and VITE_APP_BASE_PATH match the deploy path.';
        }
        setMessage('error', badTokenMessage);
        setBusy(false);
        return;
      }
      var hasSession = await verifySession();
      if (!hasSession) {
        setMessage('error', 'The token was accepted, but the browser did not keep the session cookie. Try opening the app in a new tab, or check cookie restrictions for this domain.');
        setBusy(false);
        return;
      }
      setMessage('success', 'Signed in. Opening the app...');
      window.location.replace(window.location.href);
    } catch (_err) {
      setMessage('error', 'Could not contact the auth endpoint. Check the deploy status, then try again.');
      setBusy(false);
    }
  });
</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// mountBetterAuthRoutes — Better Auth powered auth with backward-compat routes
// ---------------------------------------------------------------------------

async function mountBetterAuthRoutes(
  app: H3App,
  options: AuthOptions,
): Promise<void> {
  const publicPaths = [...(options.publicPaths ?? [])];
  const workspaceAppAudience = resolveWorkspaceAppAudience(options);
  const workspaceAppRouteAccess = resolveWorkspaceAppRouteAccess(options);

  // The A2A agent card is part of an open protocol — other agents must be
  // able to discover it without auth. Same for favicons and similar probes.
  for (const pp of ["/.well-known", "/favicon.ico", "/favicon.png"]) {
    if (!publicPaths.includes(pp)) publicPaths.push(pp);
  }

  // Auto-add Google OAuth routes when credentials are configured. Templates
  // that need broader product scopes (mail/calendar) opt out and provide
  // their own Nitro routes at these paths.
  if (
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    options.mountGoogleOAuthRoutes !== false
  ) {
    setGenericGoogleOAuthRoutesEnabled(app, true);
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
        if (!areGenericGoogleOAuthRoutesEnabled(app)) return undefined;
        if (getMethod(event) !== "GET") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        // Validate the user-supplied `redirect_uri` against the framework's
        // server-side allowlist (must be same-origin and under
        // `/_agent-native/...`). Reject anything else so an attacker can't
        // smuggle a different already-registered redirect URI past Google's
        // host-prefix matching. See HIGH-1 in 09-oauth-session.md.
        const redirectUri = resolveOAuthRedirectUri(event);
        if (redirectUri === null) {
          setResponseStatus(event, 400);
          return { error: "Invalid redirect_uri" };
        }
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
          typeof returnQuery === "string"
            ? safeOAuthReturnUrl(returnQuery, {
                allowDefaultLoopback: isBuilderOAuthRequest(event),
                allowedOrigins: [builderPreviewReturnOrigin(event)],
              })
            : "/";
        const returnUrl = validated !== "/" ? validated : undefined;
        const state = encodeOAuthState({
          redirectUri,
          desktop,
          addAccount: false,
          app: getOAuthStateAppId(),
          returnUrl,
          flowId,
        });
        logGoogleOAuthDebug(event, "auth-url", {
          flowId,
          desktop,
          redirectPath: oauthDebugUrlPath(redirectUri),
          returnUrl,
          redirect: q.redirect === "1",
          workspace:
            process.env.AGENT_NATIVE_WORKSPACE === "1" ||
            process.env.VITE_AGENT_NATIVE_WORKSPACE === "1",
        });
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
        if (!areGenericGoogleOAuthRoutesEnabled(app)) return undefined;
        if (getMethod(event) !== "GET") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        const callbackRelay = workspaceOAuthCallbackRelayResponse(event);
        if (callbackRelay) return callbackRelay;
        let callbackFlowId: string | undefined;
        let callbackDesktop = false;
        try {
          const query = getQuery(event);
          const code = query.code as string;
          const { redirectUri, desktop, returnUrl, flowId } = decodeOAuthState(
            query.state as string | undefined,
            getAppUrl(event, "/_agent-native/google/callback"),
          );
          callbackFlowId = flowId;
          callbackDesktop = desktop;
          logGoogleOAuthDebug(event, "callback-start", {
            flowId,
            desktop,
            redirectPath: oauthDebugUrlPath(redirectUri),
            hasCode: !!code,
            returnUrl,
          });
          if (!code) {
            const providerError =
              typeof query.error === "string" && query.error
                ? query.error
                : undefined;
            const providerDescription =
              typeof query.error_description === "string" &&
              query.error_description
                ? query.error_description
                : undefined;
            const msg =
              providerDescription ||
              providerError ||
              "Missing authorization code";
            if (flowId) {
              setDesktopExchangeError(flowId, {
                message: `Google sign-in failed: ${msg}`,
                code: providerError || "missing_authorization_code",
              });
            }
            logGoogleOAuthDebug(event, "callback-error", {
              flowId,
              desktop,
              message: msg,
              code: providerError,
            });
            return oauthErrorPage(`Connection failed: ${msg}`);
          }
          // Defence in depth: the state is HMAC-signed, but if the signing
          // key ever leaked an attacker could mint state with their own
          // redirect_uri. Re-validate against the same allowlist used at
          // auth-url time so the token exchange is always sent to a URI we
          // own.
          if (!isAllowedOAuthRedirectUri(redirectUri, event)) {
            const msg =
              "Invalid Google OAuth redirect URI in state. Restart sign-in from this app.";
            if (flowId) {
              setDesktopExchangeError(flowId, {
                message: msg,
                code: "invalid_redirect_uri",
              });
            }
            logGoogleOAuthDebug(event, "callback-error", {
              flowId,
              desktop,
              message: msg,
            });
            return oauthErrorPage(`Connection failed: ${msg}`);
          }

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
          // Reject unverified Google addresses. Google returns
          // `verified_email: false` for accounts where ownership of the
          // address hasn't been proven (rare on consumer accounts but
          // reachable on Workspace tenants that allow it). Without this
          // check, an attacker could sign up as `victim@example.com` on
          // Google without controlling the inbox and take over a local
          // password account that already exists at that address (Better
          // Auth's accountLinking auto-merges trusted-provider sign-ins).
          if (user.verified_email !== true) {
            throw new Error(
              "Google account email is not verified. Please verify your email with Google and try again.",
            );
          }

          const { sessionToken } = await createOAuthSession(event, email, {
            hasProductionSession: false,
            desktop,
          });
          logGoogleOAuthDebug(event, "callback-session-created", {
            flowId,
            desktop,
            hasSessionToken: !!sessionToken,
            emailDomain: email.split("@")[1] || "",
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
            logGoogleOAuthDebug(event, "callback-exchange-stored", {
              flowId,
              desktop,
            });
          }

          return oauthCallbackResponse(event, email, {
            sessionToken,
            desktop,
            returnUrl,
            flowId,
          });
        } catch (error: any) {
          const msg = error.message || "Unknown error";
          if (callbackFlowId) {
            setDesktopExchangeError(callbackFlowId, {
              message: `Google sign-in failed: ${msg}`,
              code: "callback_error",
            });
          }
          logGoogleOAuthDebug(event, "callback-error", {
            flowId: callbackFlowId,
            desktop: callbackDesktop,
            message: msg,
          });
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
      const query = getQuery(event);
      const flowId = query.flow_id as string | undefined;
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
          // Don't log on the pending path — clients poll every second for up
          // to 5 minutes, so logging here floods telemetry. The auth-url,
          // callback-start, callback-session-created, exchange-success, and
          // exchange-error breadcrumbs already cover every meaningful state
          // transition.
          return { pending: true, flow: oauthDebugFlowId(flowId) };
        }
        entry =
          "error" in fromDb
            ? { error: fromDb.error, expiresAt: Date.now() + 1 }
            : {
                token: fromDb.token,
                email: fromDb.email,
                expiresAt: Date.now() + 1,
              };
      }
      _desktopExchanges.delete(flowId);
      // Also wipe the DB-persisted entry so it cannot be replayed via the
      // DB fallback path after in-memory consumption.
      void removeSession(`dex:${flowId}`);
      if ("error" in entry) {
        logGoogleOAuthDebug(event, "exchange-error", {
          flowId,
          message: entry.error.message,
          code: entry.error.code,
        });
        return { error: entry.error.message, ...entry.error };
      }
      // Make the exchange itself establish the app session. Older clients
      // still make a follow-up /auth/session?_session=... request, but the
      // OAuth handoff should not depend on that second request succeeding.
      setFrameworkSessionCookie(event, entry.token);
      setResponseHeader(event, "Referrer-Policy", "no-referrer");
      logGoogleOAuthDebug(event, "exchange-success", {
        flowId,
        emailDomain: entry.email.split("@")[1] || "",
      });
      return { token: entry.token, email: entry.email };
    }),
  );

  const accessTokens = getAccessTokens();

  // Initialize Better Auth. Forward `googleScopes` into the BetterAuthConfig
  // so the social provider requests the broader product scopes (Gmail,
  // Calendar, etc.) up front during the primary sign-in — eliminating the
  // need for a separate "Connect Google" page.
  const betterAuthConfig: BetterAuthConfig = {
    ...(options.betterAuth ?? {}),
    ...(options.googleScopes ? { googleScopes: options.googleScopes } : {}),
  };
  const auth = await getBetterAuth(betterAuthConfig);

  // Mount Better Auth catch-all handler at /_agent-native/auth/ba/*
  app.use(
    "/_agent-native/auth/ba",
    defineEventHandler(async (event) => {
      const reqPath = event.url?.pathname ?? event.path ?? "";
      const isResetPassword =
        reqPath.includes("reset-password") && getMethod(event) === "POST";

      // Pre-read the body for reset-password so we can auto-verify the
      // user's email after they save the new password. CRUCIAL: clone
      // the Request first — h3 v2 `event.req` is the live web Request,
      // and `.text()`/`.json()` consume the stream. The same `event.req`
      // is handed to Better Auth below; without the clone, Better Auth
      // sees an empty body, fails Zod validation, and returns 400 —
      // which the reset page renders as "the link may have expired".
      let resetToken: string | undefined;
      let resetUserId: string | undefined;
      if (isResetPassword) {
        try {
          const cloned = (event.req as Request).clone();
          const body = (await cloned.json().catch(() => undefined)) as
            | { token?: string }
            | undefined;
          resetToken = body?.token;
        } catch {
          // ignore — Better Auth will handle validation
        }
        // Look up userId BEFORE calling auth.handler — Better Auth deletes
        // the verification row as part of the reset, so by the time the
        // handler returns 200 the row is gone and we can't recover the user.
        if (resetToken) {
          try {
            const { getDbExec } = await import("../db/client.js");
            const db = getDbExec();
            const rows = await db.execute({
              sql: "SELECT value FROM verification WHERE identifier = ?",
              args: [`reset-password:${resetToken}`],
            });
            resetUserId = rows.rows[0]?.value as string | undefined;
          } catch {
            // Best-effort — if we can't read the verification row we just
            // skip auto-verify; the user can verify normally.
          }
        }
      }

      const response = await auth.handler(toWebRequest(event));
      const isResponse =
        response != null &&
        typeof (response as any).status === "number" &&
        typeof (response as any).headers?.get === "function";

      // After email verification, add ?verified=1 to the redirect so the
      // login page can show "Email verified!". MUTATE the response in
      // place — `new Response(null, { headers: new Headers(response.headers) })`
      // collapses multiple Set-Cookie headers into one comma-joined value,
      // which browsers reject. With `autoSignInAfterVerification: true`
      // Better Auth emits 2–3 Set-Cookie headers (session token + cookie
      // cache + dontRememberToken); losing them strands the user on the
      // login page even though verification succeeded.
      if (
        reqPath.includes("verify-email") &&
        isResponse &&
        (response as Response).status >= 300 &&
        (response as Response).status < 400
      ) {
        const loc = response.headers.get("location");
        if (loc && !/[?&]verified=/.test(loc)) {
          const sep = loc.includes("?") ? "&" : "?";
          response.headers.set("location", loc + sep + "verified=1");
        }
      }

      // Auto-verify email after a successful password reset. The user
      // proved email ownership by receiving and using the reset link, so
      // we don't want them stuck behind `requireEmailVerification` after
      // resetting — that's the exact escape hatch they just used.
      if (
        isResetPassword &&
        resetUserId &&
        isResponse &&
        (response as Response).status >= 200 &&
        (response as Response).status < 300
      ) {
        try {
          const { getDbExec } = await import("../db/client.js");
          const db = getDbExec();
          // Use boolean literals for cross-dialect portability: Postgres
          // stores `email_verified` as BOOLEAN and rejects integer 1/0,
          // SQLite accepts TRUE/FALSE as aliases for 1/0 (since 3.23).
          // Quote `"user"` because it's a reserved keyword in Postgres.
          await db.execute({
            sql: 'UPDATE "user" SET email_verified = TRUE WHERE id = ? AND (email_verified = FALSE OR email_verified IS NULL)',
            args: [resetUserId],
          });

          // Revoke every existing session for this user so a stolen
          // cookie doesn't outlive the password it was paired with. We
          // do this AFTER Better Auth's response has been generated so
          // the freshly-minted post-reset session (if any) is captured
          // by the response's Set-Cookie header — but `auth.handler` for
          // reset-password does not auto-sign-in by default, so the
          // common path is "wipe everything; user signs in with new
          // password." The legacy `sessions` table is also wiped by
          // joining through the `user.email` column.
          //
          // Skip the freshly-minted Better Auth session id when present
          // (auto-sign-in plugins / future config). Reading it from the
          // response avoids racing against Better Auth's own writes.
          const newSessionToken = extractSessionTokenFromSetCookies(
            response as Response,
          );

          // 1. Better Auth `session` table — keyed by user_id.
          if (newSessionToken) {
            await db.execute({
              sql: 'DELETE FROM "session" WHERE user_id = ? AND token <> ?',
              args: [resetUserId, newSessionToken],
            });
          } else {
            await db.execute({
              sql: 'DELETE FROM "session" WHERE user_id = ?',
              args: [resetUserId],
            });
          }

          // 2. Legacy `sessions` table — keyed by `email` column. The
          // reset-password verification row holds the user's id, not
          // their email, so we look up the email first. Best-effort —
          // skip silently if the lookup fails so the response still ships.
          try {
            const { rows } = await db.execute({
              sql: 'SELECT email FROM "user" WHERE id = ?',
              args: [resetUserId],
            });
            const userEmail = (rows[0]?.email ?? rows[0]?.[0]) as
              | string
              | undefined;
            if (userEmail) {
              if (newSessionToken) {
                await db.execute({
                  sql: "DELETE FROM sessions WHERE email = ? AND token <> ?",
                  args: [userEmail, newSessionToken],
                });
              } else {
                await db.execute({
                  sql: "DELETE FROM sessions WHERE email = ?",
                  args: [userEmail],
                });
              }
            }
          } catch {
            // Best-effort — don't block the response
          }
        } catch {
          // Best-effort — don't block the response
        }
      }

      return response;
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
        setFrameworkSessionCookie(event, sessionToken);
        return authLoginResponse(event, sessionToken, "user");
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
          setFrameworkSessionCookie(event, result.token);
          await addSession(result.token, email);
          if (isElectronRequest(event)) {
            await writeDesktopSso({
              email,
              token: result.token,
              expiresAt: Date.now() + sessionMaxAge * 1000,
            });
          }
          return authLoginResponse(event, result.token, email);
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
        if (!isExpectedAuthFailure(e)) {
          captureAuthError(e, { route: "login", email });
        }
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
      const callbackURL =
        typeof body?.callbackURL === "string"
          ? safeReturnPath(body.callbackURL)
          : "/";

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
          body: { email, password, name: email.split("@")[0], callbackURL },
        });
        return { ok: true };
      } catch (e: any) {
        if (!isExpectedAuthFailure(e)) {
          captureAuthError(e, { route: "signup", email });
        }
        setResponseStatus(event, 409);
        return { error: e?.message || "Registration failed" };
      }
    }),
  );

  // Backward-compat: POST /_agent-native/auth/logout
  app.use(
    "/_agent-native/auth/logout",
    defineEventHandler(async (event) => {
      for (const cookie of getFrameworkSessionCookieValues(event)) {
        await removeSession(cookie);
      }
      const bearerToken = getBearerSessionToken(event);
      if (bearerToken) await removeSession(bearerToken);
      clearFrameworkSessionCookies(event);

      try {
        await auth.api.signOut({ headers: event.headers });
      } catch {
        // Ignore if no Better Auth session
      }

      if (isElectronRequest(event)) await clearDesktopSso();

      return { ok: true };
    }),
  );

  // POST /_agent-native/auth/logout-all — revoke every session row for
  // the authenticated user across both auth tables. Companion to the
  // password-reset session-revocation logic; lets a user sign out
  // everywhere from one device. Requires an authenticated session.
  app.use(
    "/_agent-native/auth/logout-all",
    defineEventHandler(async (event) => {
      if (getMethod(event) !== "POST") {
        setResponseStatus(event, 405);
        return { error: "Method not allowed" };
      }
      const session = await getSession(event);
      if (!session?.email) {
        setResponseStatus(event, 401);
        return { error: "Not authenticated" };
      }
      try {
        const db = getDbExec();
        // 1. Resolve user_id from email so we can wipe Better Auth sessions
        // by their FK column.
        let userId: string | undefined;
        try {
          const { rows } = await db.execute({
            sql: 'SELECT id FROM "user" WHERE email = ?',
            args: [session.email],
          });
          userId = (rows[0]?.id ?? rows[0]?.[0]) as string | undefined;
        } catch {
          // User table may not exist on token-only deployments — skip.
        }
        if (userId) {
          try {
            await db.execute({
              sql: 'DELETE FROM "session" WHERE user_id = ?',
              args: [userId],
            });
          } catch {
            // Best-effort.
          }
        }

        // 2. Legacy `sessions` table — keyed by `email` column.
        try {
          await db.execute({
            sql: "DELETE FROM sessions WHERE email = ?",
            args: [session.email],
          });
        } catch {
          // Best-effort.
        }

        // 3. Drop the current request's cookie and best-effort sign out
        // of Better Auth (so the response sets the proper expiry header).
        clearFrameworkSessionCookies(event);
        try {
          await auth.api.signOut({ headers: event.headers });
        } catch {
          // Ignore — sessions are already gone in DB.
        }

        if (isElectronRequest(event)) await clearDesktopSso();
        return { ok: true };
      } catch (e: any) {
        setResponseStatus(event, 500);
        return { error: e?.message || "Failed to revoke sessions" };
      }
    }),
  );

  // GET /_agent-native/auth/session
  app.use(
    "/_agent-native/auth/session",
    defineEventHandler(async (event) => {
      if (!isReadMethod(event)) {
        setResponseStatus(event, 405);
        return { error: "Method not allowed" };
      }
      const session = await getSession(event);
      return session ?? { error: "Not authenticated" };
    }),
  );

  // GET /_agent-native/auth/reset — HTML page shown when a user clicks the
  // reset link in their email. Reads ?token=... and POSTs to Better Auth's
  // /reset-password endpoint on submit.
  app.use(
    "/_agent-native/auth/reset",
    defineEventHandler((event) => {
      if (!isReadMethod(event)) {
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
      googleSignInNotice: options.googleSignInNotice,
      googleAuthMode: options.googleAuthMode,
    });
  _authGuardConfig = {
    loginHtml,
    publicPaths,
    workspaceAppAudience,
    workspaceAppPublicPaths: workspaceAppRouteAccess.publicPaths,
    workspaceAppProtectedPaths: workspaceAppRouteAccess.protectedPaths,
  };
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
  workspaceAppAudience = resolveWorkspaceAppAudience(),
  workspaceAppRouteAccess = resolveWorkspaceAppRouteAccess(),
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
      setFrameworkSessionCookie(event, sessionToken);
      return authLoginResponse(event, sessionToken, "user");
    }),
  );

  app.use(
    "/_agent-native/auth/logout",
    defineEventHandler(async (event) => {
      for (const cookie of getFrameworkSessionCookieValues(event)) {
        await removeSession(cookie);
      }
      const bearerToken = getBearerSessionToken(event);
      if (bearerToken) await removeSession(bearerToken);
      clearFrameworkSessionCookies(event);
      if (isElectronRequest(event)) await clearDesktopSso();
      return { ok: true };
    }),
  );

  app.use(
    "/_agent-native/auth/session",
    defineEventHandler(async (event) => {
      if (!isReadMethod(event)) {
        setResponseStatus(event, 405);
        return { error: "Method not allowed" };
      }
      const session = await getSession(event);
      return session ?? { error: "Not authenticated" };
    }),
  );

  _authGuardConfig = {
    loginHtml: getTokenLoginHtml(),
    getLoginHtml: (_event, rawPath) =>
      getTokenLoginHtml({ requestPath: rawPath }),
    publicPaths,
    workspaceAppAudience,
    workspaceAppPublicPaths: workspaceAppRouteAccess.publicPaths,
    workspaceAppProtectedPaths: workspaceAppRouteAccess.protectedPaths,
  };
  const guardFn = createAuthGuardFn();
  _authGuardFn = guardFn;
  app.use(defineEventHandler(guardFn));
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
          setFrameworkSessionCookie(event, result.token);
          await addSession(result.token, email);
          if (isElectronRequest(event)) {
            await writeDesktopSso({
              email,
              token: result.token,
              expiresAt: Date.now() + sessionMaxAge * 1000,
            });
          }
          return authLoginResponse(event, result.token, email);
        }
        setResponseStatus(event, 403);
        return {
          error:
            "Email not verified. Check your inbox for a verification link.",
        };
      } catch (e: any) {
        if (!isExpectedAuthFailure(e)) {
          captureAuthError(e, { route: "login", email });
        }
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
        if (!isExpectedAuthFailure(e)) {
          captureAuthError(e, { route: "signup", email });
        }
        setResponseStatus(event, 409);
        return { error: e?.message || "Registration failed" };
      }
    }),
  );

  app.use(
    "/_agent-native/auth/logout",
    defineEventHandler(async (event) => {
      for (const cookie of getFrameworkSessionCookieValues(event)) {
        await removeSession(cookie);
      }
      const bearerToken = getBearerSessionToken(event);
      if (bearerToken) await removeSession(bearerToken);
      clearFrameworkSessionCookies(event);

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
    "/_agent-native/auth/session",
    defineEventHandler(async (event) => {
      if (!isReadMethod(event)) {
        setResponseStatus(event, 405);
        return { error: "Method not allowed" };
      }
      const session = await getSession(event);
      return session ?? { error: "Not authenticated" };
    }),
  );
}

// ---------------------------------------------------------------------------
// autoMountAuth — the recommended entry point
// ---------------------------------------------------------------------------

/**
 * Automatically configure auth based on environment and configuration:
 *
 * - **BYOA (custom getSession)**: Template-provided auth callback handles everything.
 * - **ACCESS_TOKEN/ACCESS_TOKENS**: Simple token-based auth.
 * - **Default**: Better Auth with email/password, social providers, organizations, and JWT.
 *   Users see an onboarding page to create an account on first visit.
 *
 * Local development uses the same Better Auth flow as production. Email
 * verification is automatically skipped in dev/test environments and when
 * no email provider is configured (see `shouldSkipEmailVerification`), so a
 * fresh local clone only needs an email + password to get started.
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
    if (options.mountGoogleOAuthRoutes === false) {
      setGenericGoogleOAuthRoutesEnabled(app, false);
    }
    // A custom getSession always wins — even if the default auth plugin
    // mounted first (which happens in production where bootstrapDefaultPlugins
    // can't see the template's server/plugins/ dir and auto-mounts defaults).
    if (options.getSession) {
      customGetSession = options.getSession;
    }
    if (_authGuardConfig) {
      if (
        options.googleOnly ||
        options.loginHtml ||
        options.marketing ||
        options.googleSignInNotice
      ) {
        _authGuardConfig.loginHtml =
          options.loginHtml ??
          getOnboardingHtml({
            googleOnly: options.googleOnly,
            marketing: options.marketing,
            googleSignInNotice: options.googleSignInNotice,
            googleAuthMode: options.googleAuthMode,
          });
      }
      if (options.publicPaths) {
        _authGuardConfig.publicPaths = [
          ...(_authGuardConfig.publicPaths ?? []),
          ...options.publicPaths,
        ];
      }
      if (options.workspaceAppAudience) {
        _authGuardConfig.workspaceAppAudience =
          resolveWorkspaceAppAudience(options);
      }
      if (options.workspaceAppPublicPaths) {
        _authGuardConfig.workspaceAppPublicPaths =
          options.workspaceAppPublicPaths;
      }
      if (options.workspaceAppProtectedPaths) {
        _authGuardConfig.workspaceAppProtectedPaths =
          options.workspaceAppProtectedPaths;
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
    if (isDevEnvironment()) {
      customGetSession = null;
      return false;
    }
    throw new Error(
      "autoMountAuth: H3 app is required. In Nitro plugins, pass nitroApp.h3App.",
    );
  }

  // Reset globals
  customGetSession = null;
  sessionMaxAge = options.maxAge ?? DEFAULT_MAX_AGE;
  const publicPaths = options.publicPaths ?? [];
  const workspaceAppAudience = resolveWorkspaceAppAudience(options);
  const workspaceAppRouteAccess = resolveWorkspaceAppRouteAccess(options);

  mountAuthCorsMiddleware(app);

  if (options.getSession) {
    customGetSession = options.getSession;
  }

  // BYOA — custom getSession provider
  if (customGetSession) {
    app.use(
      "/_agent-native/auth/session",
      defineEventHandler(async (event) => {
        if (!isReadMethod(event)) {
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
        for (const cookie of getFrameworkSessionCookieValues(event)) {
          await removeSession(cookie);
        }
        const bearerToken = getBearerSessionToken(event);
        if (bearerToken) await removeSession(bearerToken);
        clearFrameworkSessionCookies(event);
        if (isElectronRequest(event)) await clearDesktopSso();
        return { ok: true };
      }),
    );

    const byoaLoginHtml = options.loginHtml ?? getTokenLoginHtml();
    _authGuardConfig = {
      loginHtml: byoaLoginHtml,
      ...(options.loginHtml
        ? {}
        : {
            getLoginHtml: (_event, rawPath) =>
              getTokenLoginHtml({ requestPath: rawPath }),
          }),
      publicPaths,
      workspaceAppAudience,
      workspaceAppPublicPaths: workspaceAppRouteAccess.publicPaths,
      workspaceAppProtectedPaths: workspaceAppRouteAccess.protectedPaths,
    };
    const guardFn = createAuthGuardFn();
    _authGuardFn = guardFn;
    app.use(defineEventHandler(guardFn));

    if (process.env.DEBUG)
      console.log("[agent-native] Auth enabled — custom getSession provider.");
    return true;
  }

  // ACCESS_TOKEN-only mode
  const tokens = getAccessTokens();
  if (tokens.length > 0) {
    mountTokenOnlyRoutes(
      app,
      tokens,
      publicPaths,
      workspaceAppAudience,
      workspaceAppRouteAccess,
    );
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
        googleSignInNotice: options.googleSignInNotice,
        googleAuthMode: options.googleAuthMode,
      });
    _authGuardConfig = {
      loginHtml,
      publicPaths,
      workspaceAppAudience,
      workspaceAppPublicPaths: workspaceAppRouteAccess.publicPaths,
      workspaceAppProtectedPaths: workspaceAppRouteAccess.protectedPaths,
    };
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
