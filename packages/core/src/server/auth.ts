import crypto from "node:crypto";
import {
  defineEventHandler,
  readBody,
  getMethod,
  getQuery,
  getRequestIP,
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
// Rate limiting — in-memory, per-IP
// ---------------------------------------------------------------------------

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_MAX = 10; // max attempts per window
const rateLimitMap = new Map<string, RateLimitEntry>();

// Prune stale entries every 5 minutes to prevent unbounded growth
setInterval(
  () => {
    const now = Date.now();
    for (const [key, entry] of rateLimitMap) {
      if (now > entry.resetAt) rateLimitMap.delete(key);
    }
  },
  5 * 60 * 1000,
).unref();

function getClientIp(event: H3Event): string {
  return getRequestIP(event, { xForwardedFor: true }) ?? "unknown";
}

/**
 * Check rate limit for a given key (typically IP + route).
 * Returns null if allowed, or a response object if blocked.
 */
function checkRateLimit(
  event: H3Event,
  key: string,
): { error: string; retryAfter: number } | null {
  const now = Date.now();
  const entry = rateLimitMap.get(key);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return null;
  }

  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    setResponseStatus(event, 429);
    setResponseHeader(event, "Retry-After", retryAfter);
    return {
      error: "Too many attempts. Please try again later.",
      retryAfter,
    };
  }

  return null;
}

/** Reset rate limit on successful auth (so valid users aren't penalized). */
function resetRateLimit(key: string): void {
  rateLimitMap.delete(key);
}

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
    try {
      const cookie = getCookie(event, COOKIE_NAME);
      if (cookie) {
        const email = await getSessionEmail(cookie);
        if (email) return { email, token: cookie };
      }
    } catch {
      // DB not ready yet — fall back to dev session
    }
    return DEV_SESSION;
  }

  if (customGetSession) {
    const session = await customGetSession(event);
    if (session) return session;
    // Fall through to _session query param check (mobile WebView bridge)
  } else {
    const cookie = getCookie(event, COOKIE_NAME);
    if (cookie) {
      const email = await getSessionEmail(cookie);
      if (email) return { email, token: cookie };
    }
  }

  // Mobile WebViews have a separate cookie jar from Safari, so after OAuth
  // completes in Safari the WebView won't have the session cookie.  The mobile
  // app passes the token as a query parameter; if it's valid we promote it to
  // an httpOnly cookie so subsequent requests work normally.
  // This MUST run even with custom auth providers (e.g. createGoogleAuthPlugin).
  const qToken = getQuery(event)?._session as string | undefined;
  if (qToken) {
    const email = await getSessionEmail(qToken);
    if (email) {
      setCookie(event, COOKIE_NAME, qToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: sessionMaxAge,
      });
      return { email, token: qToken };
    }
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
// Password hashing — Web Crypto PBKDF2 (works on Node.js + CF Workers)
// ---------------------------------------------------------------------------

const PBKDF2_ITERATIONS = 100_000;

function toHex(buf: Uint8Array): string {
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const encoded = new TextEncoder().encode(password);
  const keyMaterial = await globalThis.crypto.subtle.importKey(
    "raw",
    encoded.buffer as ArrayBuffer,
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const derived = await globalThis.crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt.buffer as ArrayBuffer,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    256,
  );
  return `${PBKDF2_ITERATIONS}:${toHex(salt)}:${toHex(new Uint8Array(derived))}`;
}

async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [iterStr, saltHex, hashHex] = stored.split(":");
  const iterations = parseInt(iterStr, 10);
  const salt = fromHex(saltHex);
  const expectedHash = fromHex(hashHex);

  const encoded = new TextEncoder().encode(password);
  const keyMaterial = await globalThis.crypto.subtle.importKey(
    "raw",
    encoded.buffer as ArrayBuffer,
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const derived = new Uint8Array(
    await globalThis.crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt: salt.buffer as ArrayBuffer,
        iterations,
        hash: "SHA-256",
      },
      keyMaterial,
      256,
    ),
  );

  if (derived.length !== expectedHash.length) return false;
  // Constant-time comparison
  let diff = 0;
  for (let i = 0; i < derived.length; i++) {
    diff |= derived[i] ^ expectedHash[i];
  }
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Users table — email/password accounts
// ---------------------------------------------------------------------------

let _usersTableReady = false;

async function ensureUsersTable(): Promise<void> {
  if (_usersTableReady) return;
  const client = getDbExec();
  await client.execute(`
    CREATE TABLE IF NOT EXISTS users (
      email TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      created_at ${intType()} NOT NULL
    )
  `);
  _usersTableReady = true;
}

async function createUser(
  email: string,
  password: string,
): Promise<{ ok: boolean; error?: string }> {
  await ensureUsersTable();
  const client = getDbExec();

  // Check if user already exists
  const { rows } = await client.execute({
    sql: `SELECT email FROM users WHERE email = ?`,
    args: [email],
  });
  if (rows.length > 0) {
    return { ok: false, error: "An account with this email already exists" };
  }

  const passwordHash = await hashPassword(password);
  await client.execute({
    sql: `INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?)`,
    args: [email, passwordHash, Date.now()],
  });
  return { ok: true };
}

async function authenticateUser(
  email: string,
  password: string,
): Promise<boolean> {
  await ensureUsersTable();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT password_hash FROM users WHERE email = ?`,
    args: [email],
  });
  if (rows.length === 0) return false;
  return verifyPassword(password, rows[0].password_hash as string);
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
// Email/password auth HTML — combined login + register page
// ---------------------------------------------------------------------------

const EMAIL_AUTH_HTML = `<!DOCTYPE html>
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
    max-width: 380px;
    padding: 2rem;
    background: #141414;
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 12px;
  }
  .tabs {
    display: inline-flex;
    width: 100%;
    padding: 4px;
    margin-bottom: 1.5rem;
    background: rgba(255,255,255,0.06);
    border-radius: 8px;
  }
  .tab {
    flex: 1;
    padding: 0.5rem 0.75rem;
    background: none;
    border: none;
    color: #888;
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
    border-radius: 6px;
  }
  .tab.active {
    background: #1e1e1e;
    color: #fff;
    box-shadow: 0 1px 2px rgba(0,0,0,0.3);
  }
  .tab:hover:not(.active) { color: #bbb; }
  .form { display: none; }
  .form.active { display: block; }
  label { display: block; font-size: 0.8125rem; color: #888; margin-bottom: 0.375rem; }
  input {
    width: 100%;
    padding: 0.5rem 0.75rem;
    background: transparent;
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 6px;
    color: #e5e5e5;
    font-size: 0.875rem;
    outline: none;
    margin-bottom: 0.875rem;
  }
  input:focus { border-color: rgba(255,255,255,0.3); box-shadow: 0 0 0 1px rgba(255,255,255,0.1); }
  input::placeholder { color: #555; }
  button[type="submit"] {
    width: 100%;
    margin-top: 0.25rem;
    padding: 0.5rem;
    background: #fff;
    color: #000;
    border: none;
    border-radius: 6px;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
  }
  button[type="submit"]:hover { background: #e5e5e5; }
  button[type="submit"]:disabled { opacity: 0.5; cursor: not-allowed; }
  .msg { margin-top: 0.75rem; font-size: 0.8125rem; display: none; }
  .msg.error { color: #f87171; }
  .msg.success { color: #4ade80; }
  .msg.show { display: block; }
</style>
</head>
<body>
<div class="card">
  <div class="tabs">
    <button class="tab active" data-tab="login">Sign in</button>
    <button class="tab" data-tab="register">Create account</button>
  </div>
  <form id="login-form" class="form active">
    <label for="l-email">Email</label>
    <input id="l-email" type="email" autocomplete="email" autofocus placeholder="you@example.com" required />
    <label for="l-pass">Password</label>
    <input id="l-pass" type="password" autocomplete="current-password" placeholder="Enter password" required />
    <button type="submit">Sign in</button>
    <p class="msg error" id="l-err"></p>
  </form>
  <form id="register-form" class="form">
    <label for="r-email">Email</label>
    <input id="r-email" type="email" autocomplete="email" placeholder="you@example.com" required />
    <label for="r-pass">Password</label>
    <input id="r-pass" type="password" autocomplete="new-password" placeholder="At least 8 characters" required minlength="8" />
    <label for="r-pass2">Confirm password</label>
    <input id="r-pass2" type="password" autocomplete="new-password" placeholder="Confirm password" required minlength="8" />
    <button type="submit">Create account</button>
    <p class="msg" id="r-msg"></p>
  </form>
</div>
<script>
  const tabs = document.querySelectorAll('.tab');
  const forms = document.querySelectorAll('.form');
  tabs.forEach(t => t.addEventListener('click', () => {
    tabs.forEach(x => x.classList.remove('active'));
    forms.forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    document.getElementById(t.dataset.tab + '-form').classList.add('active');
  }));

  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = document.getElementById('l-err');
    err.classList.remove('show');
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: document.getElementById('l-email').value,
        password: document.getElementById('l-pass').value,
      }),
    });
    if (res.ok) {
      window.location.reload();
    } else {
      const data = await res.json().catch(() => ({}));
      err.textContent = data.error || 'Invalid email or password';
      err.classList.add('show');
    }
  });

  document.getElementById('register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('r-msg');
    msg.classList.remove('show', 'error', 'success');
    const pass = document.getElementById('r-pass').value;
    const pass2 = document.getElementById('r-pass2').value;
    if (pass !== pass2) {
      msg.textContent = 'Passwords do not match';
      msg.classList.add('show', 'error');
      return;
    }
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: document.getElementById('r-email').value,
        password: pass,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      msg.textContent = 'Account created — signing you in...';
      msg.classList.add('show', 'success');
      // Auto-login after registration
      const loginRes = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: document.getElementById('r-email').value,
          password: pass,
        }),
      });
      if (loginRes.ok) {
        window.location.reload();
      }
    } else {
      msg.textContent = data.error || 'Registration failed';
      msg.classList.add('show', 'error');
    }
  });
</script>
</body>
</html>`;

// ---------------------------------------------------------------------------
// mountEmailAuthRoutes — email/password registration + login
// ---------------------------------------------------------------------------

function mountEmailAuthRoutes(app: H3App, publicPaths: string[] = []): void {
  // Also support ACCESS_TOKEN login for backward compat (API callers, scripts)
  const accessTokens = getAccessTokens();

  // POST /api/auth/register
  app.use(
    "/api/auth/register",
    defineEventHandler(async (event) => {
      if (getMethod(event) !== "POST") {
        setResponseStatus(event, 405);
        return { error: "Method not allowed" };
      }

      const ip = getClientIp(event);
      const limited = checkRateLimit(event, `register:${ip}`);
      if (limited) return limited;

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

      const result = await createUser(email, password);
      if (!result.ok) {
        setResponseStatus(event, 409);
        return { error: result.error };
      }

      resetRateLimit(`register:${ip}`);
      return { ok: true };
    }),
  );

  // POST /api/auth/login — email/password or legacy ACCESS_TOKEN
  app.use(
    "/api/auth/login",
    defineEventHandler(async (event) => {
      if (getMethod(event) !== "POST") {
        setResponseStatus(event, 405);
        return { error: "Method not allowed" };
      }

      const ip = getClientIp(event);
      const rateLimitKey = `login:${ip}`;
      const limited = checkRateLimit(event, rateLimitKey);
      if (limited) return limited;

      const body = await readBody(event);

      // Legacy: ACCESS_TOKEN login (for API callers, scripts)
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
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          path: "/",
          maxAge: sessionMaxAge,
        });
        resetRateLimit(rateLimitKey);
        return { ok: true };
      }

      // Email/password login
      const email = body?.email?.trim?.()?.toLowerCase?.();
      const password = body?.password;

      if (!email || !password) {
        setResponseStatus(event, 400);
        return { error: "Email and password are required" };
      }

      const valid = await authenticateUser(email, password);
      if (!valid) {
        setResponseStatus(event, 401);
        return { error: "Invalid email or password" };
      }

      const sessionToken = crypto.randomBytes(32).toString("hex");
      await addSession(sessionToken, email);
      setCookie(event, COOKIE_NAME, sessionToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: sessionMaxAge,
      });
      resetRateLimit(rateLimitKey);
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

  // GET /api/auth/session
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

  // Auth guard
  const loginHtml = EMAIL_AUTH_HTML;
  app.use(
    defineEventHandler(async (event) => {
      const url = event.node?.req?.url ?? event.path ?? "/";
      const p = url.split("?")[0];

      if (
        p === "/api/auth/login" ||
        p === "/api/auth/logout" ||
        p === "/api/auth/session" ||
        p === "/api/auth/register"
      ) {
        return;
      }
      if (isPublicPath(url, publicPaths)) return;

      const session = await getSession(event);
      if (session) return;

      if (p.startsWith("/api/")) {
        setResponseStatus(event, 401);
        return { error: "Unauthorized" };
      }

      setResponseStatus(event, 200);
      setResponseHeader(event, "Content-Type", "text/html");
      return loginHtml;
    }),
  );
}

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

      const ip = getClientIp(event);
      const rateLimitKey = `login:${ip}`;
      const limited = checkRateLimit(event, rateLimitKey);
      if (limited) return limited;

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
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: sessionMaxAge,
      });
      resetRateLimit(rateLimitKey);
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
    // Mount a session endpoint that checks for a real session first
    app.use(
      "/api/auth/session",
      defineEventHandler(async (event) => {
        if (getMethod(event) !== "GET") {
          setResponseStatus(event, 405);
          return { error: "Method not allowed" };
        }
        return await getSession(event);
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

      // Mount session endpoint
      app.use(
        "/api/auth/session",
        defineEventHandler(async (event) => {
          if (getMethod(event) !== "GET") {
            setResponseStatus(event, 405);
            return { error: "Method not allowed" };
          }
          return await getSession(event);
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

    // No access tokens set — enable email/password authentication
    pruneExpiredSessions().catch(() => {});
    mountEmailAuthRoutes(app, publicPaths);

    console.log("[agent-native] Auth enabled — email/password authentication.");
    return true;
  }

  // Production with tokens — mount auth
  pruneExpiredSessions().catch(() => {});
  mountAuthRoutes(app, tokens, publicPaths);

  console.log(
    `[agent-native] Auth enabled — ${tokens.length} access token(s) configured.`,
  );
  return true;
}
