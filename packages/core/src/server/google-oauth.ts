/**
 * Shared Google OAuth utilities for all templates.
 *
 * Handles platform detection (desktop/mobile), state encoding,
 * session token creation, and deep-link responses — the logic
 * that was previously copy-pasted across every template's
 * google-auth.ts handler.
 */

import crypto from "node:crypto";
import { getHeader, setCookie, sendRedirect, type H3Event } from "h3";
import { addSession, getSession } from "./auth.js";

// ─── Platform Detection ─────────────────────────────────────────────────────

/** Detect requests from the Electron desktop app webview. */
export function isElectron(event: H3Event): boolean {
  return /Electron/i.test(getHeader(event, "user-agent") || "");
}

/** Detect requests from a mobile browser (iOS/Android). */
export function isMobile(event: H3Event): boolean {
  return /iPhone|iPad|iPod|Android/i.test(getHeader(event, "user-agent") || "");
}

/** Get the origin from forwarded headers or Host. */
export function getOrigin(event: H3Event): string {
  const host = getHeader(event, "x-forwarded-host") || getHeader(event, "host");
  const proto = getHeader(event, "x-forwarded-proto") || "http";
  return `${proto}://${host}`;
}

// ─── OAuth State ─────────────────────────────────────────────────────────────

export interface OAuthStatePayload {
  redirectUri: string;
  owner?: string;
  desktop?: boolean;
  addAccount?: boolean;
}

/**
 * Encode OAuth state into a base64url string.
 * Carries the redirect URI, owner, and platform flags through Google's
 * OAuth redirect so the callback can recover them in cookie-less contexts
 * (system browser, mobile Safari).
 */
export function encodeOAuthState(
  redirectUri: string,
  owner?: string,
  desktop?: boolean,
  addAccount?: boolean,
): string {
  const nonce = crypto.randomBytes(8).toString("hex");
  const payload: Record<string, string | boolean> = {
    n: nonce,
    r: redirectUri,
  };
  if (owner) payload.o = owner;
  if (desktop) payload.d = true;
  if (addAccount) payload.a = true;
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

/**
 * Decode OAuth state from the callback's state query parameter.
 * Falls back to the provided URI if decoding fails.
 */
export function decodeOAuthState(
  stateParam: string | undefined,
  fallbackUri: string,
): OAuthStatePayload {
  if (stateParam) {
    try {
      const parsed = JSON.parse(
        Buffer.from(stateParam, "base64url").toString(),
      );
      return {
        redirectUri: parsed.r || fallbackUri,
        owner: parsed.o || undefined,
        desktop: !!parsed.d,
        addAccount: !!parsed.a,
      };
    } catch {}
  }
  return { redirectUri: fallbackUri };
}

// ─── Session Creation ────────────────────────────────────────────────────────

export interface OAuthOwnerResult {
  owner: string | undefined;
  isDevSession: boolean;
  hasProductionSession: boolean;
}

/**
 * Determine the token owner from the current session and OAuth state.
 * Call this BEFORE exchangeCode to get the owner parameter.
 */
export async function resolveOAuthOwner(
  event: H3Event,
  stateOwner?: string,
): Promise<OAuthOwnerResult> {
  const existingSession = await getSession(event);
  const isDevSession = existingSession?.email === "local@localhost";
  const hasProductionSession = !!(existingSession?.email && !isDevSession);

  const owner = isDevSession
    ? "local@localhost"
    : hasProductionSession
      ? existingSession!.email
      : stateOwner || undefined;

  return { owner, isDevSession, hasProductionSession };
}

export interface OAuthSessionResult {
  sessionToken: string | undefined;
}

/**
 * Create a session token after a successful OAuth exchange.
 *
 * Desktop and mobile apps have separate cookie jars from the system
 * browser, so they always get a fresh session token (even if the browser
 * already has one). The token is then passed via deep link so the native
 * app can inject it.
 */
export async function createOAuthSession(
  event: H3Event,
  email: string,
  opts: {
    hasProductionSession: boolean;
    desktop?: boolean;
  },
): Promise<OAuthSessionResult> {
  const mobile = isMobile(event);
  const needsDeepLink = opts.desktop || mobile;

  let sessionToken: string | undefined;
  if (!opts.hasProductionSession || needsDeepLink) {
    sessionToken = crypto.randomBytes(32).toString("hex");
    await addSession(sessionToken, email);
    setCookie(event, "an_session", sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });
  }

  return { sessionToken };
}

// ─── Callback Responses ──────────────────────────────────────────────────────

/**
 * Return the appropriate response after a successful OAuth callback.
 *
 * Handles mobile deep links, desktop deep links, add-account close-tab
 * pages, and plain web redirects — so templates don't have to.
 */
export function oauthCallbackResponse(
  event: H3Event,
  email: string,
  opts: {
    sessionToken?: string;
    desktop?: boolean;
    addAccount?: boolean;
  },
): Response | Promise<Response> {
  const mobile = isMobile(event);

  // Mobile: deep link back to native app
  if (mobile) {
    const deepLink = opts.sessionToken
      ? `agentnative://oauth-complete?token=${opts.sessionToken}`
      : `agentnative://oauth-complete`;
    return new Response(
      `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Connected</title></head><body style="background:#111;color:#aaa;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><p>Connected! Returning to app…</p><script>window.location.href=${JSON.stringify(deepLink)};setTimeout(function(){window.location.href="/"},1500)</script></body></html>`,
      { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }

  // Desktop: deep link back to Electron app
  if (opts.desktop) {
    return desktopSuccessPage(email, opts.sessionToken);
  }

  // Add-account web flow: close-tab page
  if (opts.addAccount) {
    const safeEmail = JSON.stringify(email);
    return new Response(
      `<!DOCTYPE html><html><body><script>
        window.close();
        var p = document.createElement('p');
        p.style.cssText = 'font-family:system-ui;text-align:center;margin-top:40vh';
        p.textContent = 'Connected ' + ${safeEmail} + '! You can close this tab.';
        document.body.appendChild(p);
      </script></body></html>`,
      { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }

  // Web: redirect to app home
  return sendRedirect(event, "/") as unknown as Response;
}

/** HTML error page for OAuth failures. */
export function oauthErrorPage(message: string): string {
  return `<!DOCTYPE html><html><body>
    <div style="font-family:system-ui;max-width:420px;margin:30vh auto;text-align:center">
      <p style="font-size:15px;color:#e55">${message}</p>
      <p style="margin-top:16px;font-size:13px;color:#888"><a href="/" style="color:#888">Back to login</a></p>
    </div>
  </body></html>`;
}

// ─── Internal ────────────────────────────────────────────────────────────────

function desktopSuccessPage(email?: string, sessionToken?: string): Response {
  const msg = email ? `Connected ${email}!` : "Connected!";
  if (sessionToken) {
    const deepLink = `agentnative://oauth-complete?token=${sessionToken}`;
    return new Response(
      `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Connected</title></head><body style="background:#111;color:#ccc;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;gap:12px"><p style="font-size:16px">${msg}</p><a href=${JSON.stringify(deepLink)} style="display:inline-block;margin-top:8px;padding:10px 24px;background:#fff;color:#000;border-radius:8px;text-decoration:none;font-size:14px;font-weight:500">Open Agent Native</a><p style="font-size:12px;color:#666;margin-top:4px">If the app didn\u2019t open automatically, click the button above.</p><script>window.location.href=${JSON.stringify(deepLink)}</script></body></html>`,
      { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }
  return new Response(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Connected</title></head><body style="background:#111;color:#ccc;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;gap:8px"><p style="font-size:16px">${msg}</p><p style="font-size:13px;color:#888">You can close this tab and return to Agent Native.</p></body></html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}
