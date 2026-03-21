import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
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
  /** Path to the sessions file. Default: data/.sessions.json */
  sessionsPath?: string;
  /**
   * Custom getSession implementation (for BYOA — Auth.js, Clerk, etc.).
   * When provided, the built-in token auth is bypassed entirely.
   */
  getSession?: (event: H3Event) => Promise<AuthSession | null>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COOKIE_NAME = "an_session";
const DEFAULT_MAX_AGE = 60 * 60 * 24 * 30; // 30 days
const DEFAULT_SESSIONS_PATH = "data/.sessions.json";

// ---------------------------------------------------------------------------
// Session store — file-backed
// ---------------------------------------------------------------------------

interface StoredSession {
  token: string;
  createdAt: number;
}

let sessions: Map<string, StoredSession> = new Map();
let sessionsFilePath = DEFAULT_SESSIONS_PATH;
let sessionMaxAge = DEFAULT_MAX_AGE;

function resolveSessionsPath(customPath?: string): string {
  return path.resolve(process.cwd(), customPath ?? DEFAULT_SESSIONS_PATH);
}

function loadSessions(): void {
  try {
    const raw = fs.readFileSync(sessionsFilePath, "utf-8");
    const entries: StoredSession[] = JSON.parse(raw);
    sessions = new Map(entries.map((s) => [s.token, s]));
  } catch {
    sessions = new Map();
  }
}

function saveSessions(): void {
  const dir = path.dirname(sessionsFilePath);
  fs.mkdirSync(dir, { recursive: true });
  const entries = Array.from(sessions.values());
  fs.writeFileSync(sessionsFilePath, JSON.stringify(entries, null, 2));
}

function pruneExpiredSessions(): void {
  const now = Date.now();
  let pruned = false;
  for (const [token, session] of sessions) {
    if (now - session.createdAt > sessionMaxAge * 1000) {
      sessions.delete(token);
      pruned = true;
    }
  }
  if (pruned) saveSessions();
}

function addSession(token: string): void {
  sessions.set(token, { token, createdAt: Date.now() });
  saveSessions();
}

function removeSession(token: string): void {
  sessions.delete(token);
  saveSessions();
}

function hasSession(token: string): boolean {
  const session = sessions.get(token);
  if (!session) return false;
  if (Date.now() - session.createdAt > sessionMaxAge * 1000) {
    sessions.delete(token);
    saveSessions();
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
  return process.env.NODE_ENV !== "production";
}

// ---------------------------------------------------------------------------
// getSession — the auth contract
// ---------------------------------------------------------------------------

let customGetSession: ((event: H3Event) => Promise<AuthSession | null>) | null =
  null;

const DEV_SESSION: AuthSession = { email: "local@localhost" };

/**
 * Get the current auth session for a request.
 *
 * - In dev mode: always returns { email: "local@localhost" }
 * - In production with built-in auth: returns session if cookie is valid
 * - With custom auth (BYOA): delegates to the custom getSession
 */
export async function getSession(event: H3Event): Promise<AuthSession | null> {
  if (isDevMode()) return DEV_SESSION;

  if (customGetSession) return customGetSession(event);

  const cookie = getCookie(event, COOKIE_NAME);
  if (cookie && hasSession(cookie)) {
    return { email: "user", token: cookie };
  }
  return null;
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

function mountAuthRoutes(app: H3App, accessTokens: string[]): void {
  // POST /api/auth/login
  app.use(
    "/api/auth/login",
    defineEventHandler(async (event) => {
      if (getMethod(event) !== "POST") {
        setResponseStatus(event, 405);
        return { error: "Method not allowed" };
      }
      const body = await readBody(event);
      if (!body?.token || !accessTokens.includes(body.token)) {
        setResponseStatus(event, 401);
        return { error: "Invalid token" };
      }
      const sessionToken = crypto.randomBytes(32).toString("hex");
      addSession(sessionToken);
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
    defineEventHandler((event) => {
      const cookie = getCookie(event, COOKIE_NAME);
      if (cookie) removeSession(cookie);
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
    defineEventHandler((event) => {
      const url = event.node.req.url ?? "/";
      const p = url.split("?")[0];

      // Skip auth routes
      if (
        p === "/api/auth/login" ||
        p === "/api/auth/logout" ||
        p === "/api/auth/session"
      ) {
        return;
      }

      const cookie = getCookie(event, COOKIE_NAME);
      if (cookie && hasSession(cookie)) {
        return; // Authenticated
      }

      // Unauthenticated
      if (p.startsWith("/api/")) {
        setResponseStatus(event, 401);
        setResponseHeader(event, "Content-Type", "application/json");
        event.node.res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }

      setResponseHeader(event, "Content-Type", "text/html");
      event.node.res.end(LOGIN_HTML);
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
  // Apply options
  sessionMaxAge = options.maxAge ?? DEFAULT_MAX_AGE;
  sessionsFilePath = resolveSessionsPath(options.sessionsPath);

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

  // Production — check for tokens
  const tokens = getAccessTokens();

  if (tokens.length === 0) {
    // No tokens set — check if auth is explicitly disabled
    if (process.env.AUTH_DISABLED === "true") {
      console.warn(
        "[agent-native] AUTH_DISABLED=true — running in production without auth. " +
          "Ensure this app is behind infrastructure-level auth (Cloudflare Access, VPN, etc.).",
      );

      // Still mount session endpoint returning null
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
  loadSessions();
  pruneExpiredSessions();
  mountAuthRoutes(app, tokens);

  console.log(
    `[agent-native] Auth enabled — ${tokens.length} access token(s) configured.`,
  );
  return true;
}
