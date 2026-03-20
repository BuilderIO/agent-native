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
  getRequestURL,
} from "h3";
import type { App as H3App } from "h3";

const COOKIE_NAME = "an_session";

// In-memory session store — maps random session tokens to their creation time
const activeSessions = new Set<string>();

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

/**
 * Mount auth middleware + login/logout routes onto an H3 app.
 *
 * - POST /api/auth/login  — validates token, sets HttpOnly session cookie
 * - POST /api/auth/logout — clears session cookie
 * - All other routes: redirects/blocks unauthenticated requests
 */
export function mountAuthMiddleware(app: H3App, accessToken: string): void {
  // Login route
  app.use(
    "/api/auth/login",
    defineEventHandler(async (event) => {
      if (getMethod(event) !== "POST") {
        setResponseStatus(event, 405);
        return { error: "Method not allowed" };
      }
      const body = await readBody(event);
      if (body?.token !== accessToken) {
        setResponseStatus(event, 401);
        return { error: "Invalid token" };
      }
      const sessionToken = crypto.randomBytes(32).toString("hex");
      activeSessions.add(sessionToken);
      setCookie(event, COOKIE_NAME, sessionToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 30, // 30 days
      });
      return { ok: true };
    }),
  );

  // Logout route
  app.use(
    "/api/auth/logout",
    defineEventHandler((event) => {
      const session = getCookie(event, COOKIE_NAME);
      if (session) activeSessions.delete(session);
      deleteCookie(event, COOKIE_NAME, { path: "/" });
      return { ok: true };
    }),
  );

  // Auth guard middleware (runs before all other handlers)
  app.use(
    defineEventHandler((event) => {
      const url = event.node.req.url ?? "/";
      const path = url.split("?")[0];

      // Skip auth check for login/logout routes
      if (path === "/api/auth/login" || path === "/api/auth/logout") {
        return;
      }

      const session = getCookie(event, COOKIE_NAME);
      if (session && activeSessions.has(session)) {
        return; // Authenticated — continue
      }

      // Unauthenticated — API routes get 401, all others get login page
      if (path.startsWith("/api/")) {
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
