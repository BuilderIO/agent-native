import crypto from "node:crypto";
import {
  defineEventHandler,
  readBody,
  getMethod,
  setResponseHeader,
  setResponseStatus,
  getCookie,
  setCookie,
  deleteCookie,
} from "h3";
import type { App as H3App, H3Event } from "h3";
import { getDbExec, isPostgres, intType, type DbExec } from "../db/client.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuthSession {
  email: string;
  userId?: string;
  token?: string;
}

export interface AuthOptions {
  /** Session max age in seconds. Default: 30 days */
  maxAge?: number;
  /**
   * Custom getSession implementation (for BYOA — Auth.js, Clerk, etc.).
   * When provided, the built-in token auth is bypassed entirely.
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
   * unauthenticated page requests instead of the built-in token login form.
   * Use this for custom login flows (e.g., "Sign in with Google" button).
   */
  loginHtml?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COOKIE_NAME = "an_session";
const DEFAULT_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

// ---------------------------------------------------------------------------
// Session store — SQL-backed
// ---------------------------------------------------------------------------

let _sessionTableReady = false;
let sessionMaxAge = DEFAULT_MAX_AGE;

async function ensureSessionTable(): Promise<void> {
  if (_sessionTableReady) return;
  const client = getDbExec();
  await client.execute(`
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      email TEXT,
      created_at ${intType()} NOT NULL
    )
  `);
  // Migration: add email column to existing tables that lack it
  try {
    await client.execute(`ALTER TABLE sessions ADD COLUMN email TEXT`);
  } catch {
    // Column already exists — ignore
  }
  _sessionTableReady = true;
}

async function pruneExpiredSessions(): Promise<void> {
  await ensureSessionTable();
  const client = getDbExec();
  const cutoff = Date.now() - sessionMaxAge * 1000;
  await client.execute({
    sql: `DELETE FROM sessions WHERE created_at < ?`,
    args: [cutoff],
  });
}

/**
 * Create a new session. Optionally associate it with an email address
 * (used by Google OAuth and other identity-aware auth providers).
 */
export async function addSession(token: string, email?: string): Promise<void> {
  await ensureSessionTable();
  const client = getDbExec();
  await client.execute({
    sql: isPostgres()
      ? `INSERT INTO sessions (token, email, created_at) VALUES (?, ?, ?) ON CONFLICT (token) DO UPDATE SET email=EXCLUDED.email, created_at=EXCLUDED.created_at`
      : `INSERT OR REPLACE INTO sessions (token, email, created_at) VALUES (?, ?, ?)`,
    args: [token, email ?? null, Date.now()],
  });
}

/** Remove a session by token. */
export async function removeSession(token: string): Promise<void> {
  await ensureSessionTable();
  const client = getDbExec();
  await client.execute({
    sql: `DELETE FROM sessions WHERE token = ?`,
    args: [token],
  });
}

/**
 * Look up the email associated with a session token.
 * Returns null if the session doesn't exist, is expired, or has no email.
 */
export async function getSessionEmail(token: string): Promise<string | null> {
  await ensureSessionTable();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT email, created_at FROM sessions WHERE token = ?`,
    args: [token],
  });
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

async function hasSession(token: string): Promise<boolean> {
  await ensureSessionTable();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT created_at FROM sessions WHERE token = ?`,
    args: [token],
  });
  if (rows.length === 0) return false;
  const createdAt = rows[0].created_at as number;
  if (Date.now() - createdAt > sessionMaxAge * 1000) {
    await client.execute({
      sql: `DELETE FROM sessions WHERE token = ?`,
      args: [token],
    });
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Token resolution — supports ACCESS_TOKEN (single) or ACCESS_TOKENS (multi)
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

// ---------------------------------------------------------------------------
// Dev mode detection
// ---------------------------------------------------------------------------

function isDevMode(): boolean {
  // On edge runtimes (e.g. CF Workers), NODE_ENV may not be set.
  // Treat undefined as production — dev mode must be explicitly opted in.
  const env = process.env.NODE_ENV;
  return env === "development" || env === "test";
}

// ---------------------------------------------------------------------------
// getSession — the auth contract
// ---------------------------------------------------------------------------

let customGetSession: ((event: H3Event) => Promise<AuthSession | null>) | null =
  null;
let authDisabledMode = false;

const DEV_SESSION: AuthSession = { email: "local@localhost" };

/**
 * Get the current auth session for a request.
 *
 * - In dev mode: checks for a session cookie first (e.g. from Google OAuth),
 *   so the real email is used when sharing a DB with production.
 *   Falls back to { email: "local@localhost" } if no session cookie.
 * - In production with built-in auth: returns session if cookie is valid
 * - With custom auth (BYOA): delegates to the custom getSession
 */
export async function getSession(event: H3Event): Promise<AuthSession | null> {
  if (isDevMode() || authDisabledMode) {
    // Check for a real session cookie (created by Google OAuth callback)
    // so dev and prod share the same identity on the same DB
    const cookie = getCookie(event, COOKIE_NAME);
    if (cookie) {
      const email = await getSessionEmail(cookie);
      if (email) return { email, token: cookie };
    }
    return DEV_SESSION;
  }

  if (customGetSession) return customGetSession(event);

  const cookie = getCookie(event, COOKIE_NAME);
  if (cookie && (await hasSession(cookie))) {
    return { email: "user", token: cookie };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Constant-time token comparison
// ---------------------------------------------------------------------------

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
// Login page HTML
// ---------------------------------------------------------------------------

const LOGIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
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
    transition: border-color 0.15s;
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
    transition: opacity 0.15s;
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
    const res = await fetch('/api/auth/login', {
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
// mountAuthMiddleware — mounts login/logout/session routes + auth guard
// ---------------------------------------------------------------------------

/**
 * Mount auth middleware + login/logout/session routes onto an H3 app.
 *
 * @deprecated Use `autoMountAuth(app, options?)` instead for automatic
 * dev/prod behavior. This function is kept for backwards compatibility
 * when you need explicit control over the access token.
 */
export function mountAuthMiddleware(app: H3App, accessToken: string): void {
  mountAuthRoutes(app, [accessToken]);
}

function isPublicPath(url: string, publicPaths: string[]): boolean {
  const p = url.split("?")[0];
  return publicPaths.some((pp) => p === pp || p.startsWith(pp + "/"));
}

function mountAuthRoutes(
  app: H3App,
  accessTokens: string[],
  publicPaths: string[] = [],
): void {
  // POST /api/auth/login
  app.use(
    "/api/auth/login",
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
      await addSession(sessionToken);
      setCookie(event, COOKIE_NAME, sessionToken, {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: sessionMaxAge,
      });
      return { ok: true };
    }),
  );

  // POST /api/auth/logout
  app.use(
    "/api/auth/logout",
    defineEventHandler(async (event) => {
      const cookie = getCookie(event, COOKIE_NAME);
      if (cookie) await removeSession(cookie);
      deleteCookie(event, COOKIE_NAME, { path: "/" });
      return { ok: true };
    }),
  );

  // GET /api/auth/session — client session check
  app.use(
    "/api/auth/session",
    defineEventHandler(async (event) => {
      if (getMethod(event) !== "GET") {
        setResponseStatus(event, 405);
        return { error: "Method not allowed" };
      }
      const session = await getSession(event);
      return session ?? { error: "Not authenticated" };
    }),
  );

  // Auth guard — runs before all other handlers
  app.use(
    defineEventHandler(async (event) => {
      const url = event.node?.req?.url ?? event.path ?? "/";
      const p = url.split("?")[0];

      // Skip auth routes
      if (
        p === "/api/auth/login" ||
        p === "/api/auth/logout" ||
        p === "/api/auth/session"
      ) {
        return;
      }

      // Skip public paths
      if (isPublicPath(url, publicPaths)) {
        return;
      }

      // Use getSession() so BYOA custom auth is respected
      const session = await getSession(event);
      if (session) {
        return; // Authenticated
      }

      // Unauthenticated
      if (p.startsWith("/api/")) {
        setResponseStatus(event, 401);
        return { error: "Unauthorized" };
      }

      setResponseStatus(event, 200);
      setResponseHeader(event, "Content-Type", "text/html");
      return LOGIN_HTML;
    }),
  );
}

// ---------------------------------------------------------------------------
// autoMountAuth — the recommended entry point
// ---------------------------------------------------------------------------

/**
 * Automatically configure auth based on the environment:
 *
 * - **Dev mode** (`NODE_ENV !== "production"`): Auth is skipped entirely.
 *   `getSession()` returns `{ email: "local@localhost" }` for all requests.
 *
 * - **Production with ACCESS_TOKEN/ACCESS_TOKENS set**: Auth middleware is
 *   mounted. Unauthenticated requests see a login page. One env var is all
 *   you need.
 *
 * - **Production without tokens and AUTH_DISABLED !== "true"**: Refuses to
 *   start. Logs a clear error explaining what to do.
 *
 * - **Production with AUTH_DISABLED=true**: Auth is skipped (for apps behind
 *   infrastructure-level auth like Cloudflare Access or a VPN).
 *
 * Returns true if auth was mounted, false if skipped.
 */
export function autoMountAuth(app: H3App, options: AuthOptions = {}): boolean {
  // In Nitro 3.0 dev mode, the H3 app may not be available yet.
  // In dev mode auth is bypassed anyway, so we can safely skip.
  if (!app) {
    if (isDevMode()) {
      authDisabledMode = false;
      customGetSession = null;
      return false;
    }
    throw new Error(
      "autoMountAuth: H3 app is required. In Nitro plugins, pass nitroApp.h3App.",
    );
  }

  // Reset globals to avoid stale state from prior calls
  customGetSession = null;
  authDisabledMode = false;
  sessionMaxAge = options.maxAge ?? DEFAULT_MAX_AGE;
  const publicPaths = options.publicPaths ?? [];

  if (options.getSession) {
    customGetSession = options.getSession;
  }

  // Dev mode — skip auth entirely
  if (isDevMode()) {
    // Mount a session endpoint that returns the dev stub
    app.use(
      "/api/auth/session",
      defineEventHandler(async (event) => {
        if (getMethod(event) !== "GET") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        return DEV_SESSION;
      }),
    );

    // Mount no-op login/logout so client code doesn't break
    app.use(
      "/api/auth/login",
      defineEventHandler(() => ({ ok: true })),
    );
    app.use(
      "/api/auth/logout",
      defineEventHandler(() => ({ ok: true })),
    );

    return false;
  }

  // BYOA with custom getSession — skip token check, mount session/guard routes
  if (customGetSession) {
    // Mount session endpoint
    app.use(
      "/api/auth/session",
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
      "/api/auth/login",
      defineEventHandler(() => ({ ok: true })),
    );
    app.use(
      "/api/auth/logout",
      defineEventHandler(async (event) => {
        const cookie = getCookie(event, COOKIE_NAME);
        if (cookie) await removeSession(cookie);
        deleteCookie(event, COOKIE_NAME, { path: "/" });
        return { ok: true };
      }),
    );

    // Mount auth guard that delegates to custom getSession
    const byoaLoginHtml = options.loginHtml ?? LOGIN_HTML;
    app.use(
      defineEventHandler(async (event) => {
        // Use H3's getRequestURL for cross-platform compat (Node + Workers)
        const url = event.node?.req?.url ?? event.path ?? "/";
        const p = url.split("?")[0];
        if (
          p === "/api/auth/login" ||
          p === "/api/auth/logout" ||
          p === "/api/auth/session"
        ) {
          return;
        }
        // Skip public paths
        if (isPublicPath(url, publicPaths)) {
          return;
        }
        const session = await getSession(event);
        if (session) return;
        if (p.startsWith("/api/")) {
          setResponseStatus(event, 401);
          return { error: "Unauthorized" };
        }
        setResponseStatus(event, 200);
        setResponseHeader(event, "Content-Type", "text/html");
        return byoaLoginHtml;
      }),
    );

    console.log("[agent-native] Auth enabled — custom getSession provider.");
    return true;
  }

  // Production — check for tokens
  const tokens = getAccessTokens();

  if (tokens.length === 0) {
    // No tokens set — check if auth is explicitly disabled
    if (process.env.AUTH_DISABLED === "true") {
      authDisabledMode = true;
      console.warn(
        "[agent-native] AUTH_DISABLED=true — running in production without auth. " +
          "Ensure this app is behind infrastructure-level auth (Cloudflare Access, VPN, etc.).",
      );

      // Mount session endpoint — getSession() will return DEV_SESSION
      app.use(
        "/api/auth/session",
        defineEventHandler(async (event) => {
          if (getMethod(event) !== "GET") {
            setResponseStatus(event, 405);
            return { error: "Method not allowed" };
          }
          return DEV_SESSION;
        }),
      );
      app.use(
        "/api/auth/login",
        defineEventHandler(() => ({ ok: true })),
      );
      app.use(
        "/api/auth/logout",
        defineEventHandler(() => ({ ok: true })),
      );

      return false;
    }

    // Refuse to start without auth in production
    const msg =
      "\n" +
      "=".repeat(70) +
      "\n" +
      " ERROR: Running in production without authentication.\n\n" +
      " Set ACCESS_TOKEN=<your-secret> to enable auth, or\n" +
      " set AUTH_DISABLED=true if this app is behind infrastructure auth.\n\n" +
      " For multi-user access: ACCESS_TOKENS=token1,token2,token3\n" +
      "=".repeat(70) +
      "\n";
    console.error(msg);
    process.exit(1);
  }

  // Production with tokens — mount auth
  pruneExpiredSessions().catch(() => {});
  mountAuthRoutes(app, tokens, publicPaths);

  console.log(
    `[agent-native] Auth enabled — ${tokens.length} access token(s) configured.`,
  );
  return true;
}
