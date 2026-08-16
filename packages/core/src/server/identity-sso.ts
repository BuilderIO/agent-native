/**
 * Cross-app SSO ("Sign in with Agent-Native") — the CLIENT side.
 *
 * Each hosted app has its own Better Auth store. Dispatch is the identity
 * authority, but the browser only ever carries a short-lived, one-time
 * authorization code. The client keeps the PKCE verifier in an HttpOnly,
 * callback-scoped cookie and redeems the code server-to-server. Only that
 * server-to-server response may contain the signed identity assertion.
 *
 * Direct browser federation uses the canonical Dispatch authority for exact
 * first-party hosted app origins and remains opt-in through
 * `AGENT_NATIVE_IDENTITY_HUB_URL` for self-hosted deployments. The packaged
 * Desktop Canary follows the same canonical-origin boundary.
 */

import { createHash, randomBytes } from "node:crypto";

import type { H3Event } from "h3";
import { deleteCookie, getCookie, getHeader, getMethod, setCookie } from "h3";
import * as jose from "jose";

import {
  GOOGLE_AUTH_REQUIRED_MESSAGE,
  isGoogleSignInRequiredForEmail,
} from "../org/auth-policy.js";
import { SIGN_IN_ENTRY_PATH } from "../shared/sign-in-journey.js";
import { getAppName } from "./app-name.js";
import { getSession, isExpectedAuthFailure, safeReturnPath } from "./auth.js";
import {
  getBetterAuth,
  getBetterAuthInternalAdapter,
} from "./better-auth-instance.js";
import { createOAuthSession, getOrigin } from "./google-oauth.js";
import {
  consumeSsoState,
  createSsoState,
  CANONICAL_IDENTITY_SSO_HUB_URL,
  getIdentityHubUrl,
  identitySsoLoginButtonHtml,
  isCanonicalIdentitySsoClientRequest,
  isDesktopSsoUserAgent,
  isIdentitySsoExplicitlyEnabled,
  isIdentitySsoEnabled,
  isJtiReplayed,
  SSO_STATE_TTL_MS,
} from "./identity-sso-store.js";

export { getIdentityHubUrl, identitySsoLoginButtonHtml, isIdentitySsoEnabled };

export const IDENTITY_SSO_PROVIDER_ID = "agent-native";
export const IDENTITY_SSO_SCOPE = "identity";
export const IDENTITY_SSO_DESKTOP_COMPLETE_PATH =
  "/_agent-native/identity/desktop-complete";
export const IDENTITY_SSO_CALLBACK_PATH = "/_agent-native/identity/callback";
export const IDENTITY_SSO_TOKEN_PATH = "/_agent-native/identity/token";

const DESKTOP_COMPLETION_NONCE = /^[A-Za-z0-9_-]{32,128}$/;
const STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const CODE = /^[A-Za-z0-9_-]{43}$/;
const CODE_VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
const SSO_VERIFIER_COOKIE_PREFIX = "agent_native_sso_verifier_";
const MAX_ASSERTION_AGE_SECONDS = 5 * 60;
const LOCALHOST_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/html; charset=utf-8",
      "Referrer-Policy": "no-referrer",
    },
  });
}

function redirect(event: H3Event, location: string): Response {
  const headers = new Headers({
    "Cache-Control": "no-store",
    Location: location,
    "Referrer-Policy": "no-referrer",
  });
  const staged = (event as any).res?.headers?.getSetCookie?.() ?? [];
  for (const cookie of staged) headers.append("set-cookie", cookie);
  return new Response("", { status: 302, headers });
}

function errorPage(message: string, loginPath: string): Response {
  const safe = message
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const safeHref = loginPath.replace(/"/g, "&quot;");
  return html(
    `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">` +
      `<meta name="viewport" content="width=device-width, initial-scale=1">` +
      `<title>Sign-in failed</title>` +
      `<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;` +
      `background:#09090b;color:#f4f4f5;display:flex;align-items:center;` +
      `justify-content:center;min-height:100vh;margin:0;padding:1rem}` +
      `.card{max-width:420px;padding:2rem;background:#141417;` +
      `border:1px solid rgba(255,255,255,0.1);border-radius:12px;text-align:center}` +
      `h1{font-size:1.15rem;margin:0 0 .5rem}p{color:#a1a1aa;font-size:.9rem;margin:0 0 1.25rem}` +
      `a{color:#f4f4f5;font-weight:600;text-decoration:none;border:1px solid ` +
      `rgba(255,255,255,0.18);border-radius:8px;padding:.6rem 1.1rem;display:inline-block}</style>` +
      `</head><body><div class="card"><h1>Could not sign you in</h1>` +
      `<p>${safe}</p><a href="${safeHref}">Back to sign in</a></div></body></html>`,
    400,
  );
}

function createUnusableSsoCredential(): string {
  return `an-sso_${randomBytes(32).toString("base64url")}`;
}

function normalizeAuthority(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (
      (url.protocol !== "https:" &&
        !(url.protocol === "http:" && LOCALHOST_HOSTS.has(url.hostname))) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return `${url.protocol}//${url.host}${url.pathname}`.replace(/\/+$/, "");
  } catch (error) {
    void error;
    return null;
  }
}

function resolveAppId(event: H3Event): string {
  const configured =
    process.env.AGENT_NATIVE_APP_ID?.trim() ||
    process.env.AGENT_NATIVE_WORKSPACE_APP_ID?.trim();
  if (configured) return configured;
  const name = getAppName();
  if (name && name !== "app") return name;
  try {
    return new URL(getOrigin(event)).hostname.split(".")[0] || "app";
  } catch {
    return "app";
  }
}

function resolveClientId(appId: string): string {
  return process.env.AGENT_NATIVE_SSO_CLIENT_ID?.trim() || appId;
}

function verifierCookieName(state: string): string {
  return `${SSO_VERIFIER_COOKIE_PREFIX}${state}`;
}

function createPkceVerifier(): string {
  return randomBytes(48).toString("base64url");
}

function createPkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function requestUrl(event: H3Event): string {
  return (event as any).node?.req?.url ?? event.path ?? "/";
}

function setPkceVerifierCookie(
  event: H3Event,
  state: string,
  verifier: string,
  secure: boolean,
): void {
  setCookie(event, verifierCookieName(state), verifier, {
    httpOnly: true,
    maxAge: Math.floor(SSO_STATE_TTL_MS / 1_000),
    path: IDENTITY_SSO_CALLBACK_PATH,
    sameSite: "lax",
    secure,
  });
}

function clearPkceVerifierCookie(event: H3Event, state: string): void {
  deleteCookie(event, verifierCookieName(state), {
    path: IDENTITY_SSO_CALLBACK_PATH,
  });
}

interface SsoClientBinding {
  appId: string;
  clientId: string;
  redirectUri: string;
  authority: string;
}

function resolveClientBinding(
  event: H3Event,
  hub: string,
): SsoClientBinding | null {
  const appId = resolveAppId(event);
  const clientId = resolveClientId(appId);
  const redirectUri = `${getOrigin(event)}${IDENTITY_SSO_CALLBACK_PATH}`;
  const authority = normalizeAuthority(hub);
  if (!authority || !appId || !clientId || !redirectUri) return null;
  return { appId, clientId, redirectUri, authority };
}

/**
 * Canonical hosted apps may use Dispatch without per-app hub configuration.
 * Self-hosted apps remain strictly env-gated. The exact-origin check is kept
 * request-scoped so a missing deployment URL cannot broaden the trust set.
 */
export function resolveIdentityHubUrl(event: H3Event): string | undefined {
  const configured = isIdentitySsoExplicitlyEnabled()
    ? getIdentityHubUrl()
    : undefined;
  if (configured) return configured;
  if (
    isCanonicalIdentitySsoClientRequest(
      getHeader(event, "host"),
      getHeader(event, "x-forwarded-proto"),
    )
  ) {
    return CANONICAL_IDENTITY_SSO_HUB_URL;
  }
  if (!isDesktopSsoUserAgent(getHeader(event, "user-agent"))) {
    return undefined;
  }
  try {
    if (
      !isCanonicalIdentitySsoClientRequest(
        getHeader(event, "host"),
        getHeader(event, "x-forwarded-proto"),
      )
    ) {
      return undefined;
    }
    return CANONICAL_IDENTITY_SSO_HUB_URL;
  } catch (error) {
    void error;
    return undefined;
  }
}

interface VerifiedIdentity {
  email: string;
  name: string;
  orgDomain?: string;
  authProvider?: "google";
  sub: string;
  jti: string;
}

/** Verify only the server-to-server assertion returned by Dispatch /token. */
async function verifyIdentityAssertion(
  assertion: string,
  binding: SsoClientBinding,
): Promise<VerifiedIdentity | null> {
  const secret = process.env.A2A_SECRET;
  if (!secret || !assertion) return null;
  try {
    const { payload } = await jose.jwtVerify(
      assertion,
      new TextEncoder().encode(secret),
      { audience: binding.redirectUri },
    );
    if (payload.scope !== IDENTITY_SSO_SCOPE) return null;
    if (payload.identity_client_id !== binding.clientId) return null;
    if (payload.redirect_uri !== binding.redirectUri) return null;
    if (payload.identity_authority !== binding.authority) return null;
    const issuer =
      typeof payload.iss === "string" ? normalizeAuthority(payload.iss) : null;
    if (issuer !== binding.authority) return null;
    const email =
      typeof payload.email === "string" && payload.email.includes("@")
        ? payload.email.trim().toLowerCase()
        : null;
    if (!email) return null;
    const iat = typeof payload.iat === "number" ? payload.iat : null;
    if (
      iat == null ||
      iat > Date.now() / 1_000 + 60 ||
      Date.now() / 1_000 - iat > MAX_ASSERTION_AGE_SECONDS
    ) {
      return null;
    }
    const jti = typeof payload.jti === "string" ? payload.jti : "";
    if (!jti) return null;
    return {
      email,
      name:
        typeof payload.name === "string" && payload.name.trim()
          ? payload.name.trim()
          : "",
      orgDomain:
        typeof payload.org_domain === "string" && payload.org_domain
          ? payload.org_domain
          : undefined,
      authProvider:
        payload.identity_auth_provider === "google" ? "google" : undefined,
      sub: typeof payload.sub === "string" && payload.sub ? payload.sub : email,
      jti,
    };
  } catch (error) {
    void error;
    return null;
  }
}

async function exchangeIdentityCode(
  hub: string,
  binding: SsoClientBinding,
  input: { code: string; state: string; codeVerifier: string },
): Promise<string | null> {
  if (!CODE.test(input.code) || !STATE_PATTERN.test(input.state)) return null;
  if (!CODE_VERIFIER.test(input.codeVerifier)) return null;
  const tokenEndpoint = `${hub}${IDENTITY_SSO_TOKEN_PATH}`;
  try {
    const response = await fetch(tokenEndpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code: input.code,
        state: input.state,
        app_id: binding.appId,
        client_id: binding.clientId,
        redirect_uri: binding.redirectUri,
        code_verifier: input.codeVerifier,
      }),
      redirect: "error",
    });
    if (!response.ok) return null;
    const body = (await response.json().catch((error) => {
      void error;
      return null;
    })) as Record<string, unknown> | null;
    return typeof body?.assertion === "string" ? body.assertion : null;
  } catch (error) {
    void error;
    return null;
  }
}

async function jitLinkIdentity(identity: VerifiedIdentity): Promise<void> {
  const adapter = await getBetterAuthInternalAdapter();
  let existing = adapter
    ? await adapter
        .findUserByEmail(identity.email, { includeAccounts: true })
        .catch((error) => {
          void error;
          return null;
        })
    : null;

  if (!existing) {
    const auth = await getBetterAuth();
    try {
      await auth.api.signUpEmail({
        body: {
          email: identity.email,
          password: createUnusableSsoCredential(),
          name: identity.name || identity.email.split("@")[0] || "User",
        },
      });
    } catch (error) {
      if (!isExpectedAuthFailure(error)) throw error;
    }
    if (adapter) {
      existing = await adapter
        .findUserByEmail(identity.email, { includeAccounts: true })
        .catch((error) => {
          void error;
          return null;
        });
    }
  }

  if (adapter && existing?.user?.id) {
    const accountId = identity.sub || identity.email;
    const alreadyLinked = (existing.accounts ?? []).some(
      (account) =>
        account.providerId === IDENTITY_SSO_PROVIDER_ID &&
        account.accountId === accountId,
    );
    if (!alreadyLinked) {
      try {
        await adapter.linkAccount({
          userId: existing.user.id,
          providerId: IDENTITY_SSO_PROVIDER_ID,
          accountId,
        });
      } catch (error) {
        void error;
        // The verified email already authenticates the user. This inert,
        // additive bookkeeping link must never block session creation.
      }
    }
  }
}

function safeRequestReturnPath(event: H3Event): string {
  try {
    const url = new URL(requestUrl(event), "http://an.invalid");
    return safeReturnPath(url.searchParams.get("return"));
  } catch {
    return "/";
  }
}

export async function handleIdentitySso(
  event: H3Event,
  subpath: string,
): Promise<Response> {
  const method = getMethod(event);
  const sub = ("/" + subpath.replace(/^\/+/, "").replace(/\/+$/, "")).replace(
    /^\/$/,
    "",
  );
  const loginPath = SIGN_IN_ENTRY_PATH;

  // Dispatch is the identity authority, so it has no SSO hub for the
  // browser to federate to. Its authenticated desktop completion page still
  // lives on this route and must be reachable after ordinary sign-in.
  if (sub === "/desktop-complete") {
    if (method !== "GET" && method !== "HEAD") {
      return new Response("Method not allowed", { status: 405 });
    }
    let nonce = "";
    try {
      nonce =
        new URL(requestUrl(event), "http://an.invalid").searchParams.get(
          "nonce",
        ) || "";
    } catch {
      return new Response("Invalid completion request", { status: 400 });
    }
    if (!DESKTOP_COMPLETION_NONCE.test(nonce)) {
      return new Response("Invalid completion request", { status: 400 });
    }
    const current = await getSession(event).catch((error) => {
      void error;
      return null;
    });
    if (!current?.email) {
      return new Response("Authentication required", { status: 401 });
    }
    return new Response(
      '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">' +
        '<meta name="viewport" content="width=device-width,initial-scale=1">' +
        "<title>Signed in</title></head><body>Signed in. You can close this window.</body></html>",
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
          "Content-Security-Policy": "default-src 'none'; style-src 'none'",
          "Content-Type": "text/html; charset=utf-8",
          "Referrer-Policy": "no-referrer",
        },
      },
    );
  }

  const hub = resolveIdentityHubUrl(event);
  if (!hub) return new Response("Not found", { status: 404 });

  if (sub === "/login") {
    if (method !== "GET" && method !== "HEAD") {
      return new Response("Method not allowed", { status: 405 });
    }
    const existing = await getSession(event).catch((error) => {
      void error;
      return null;
    });
    const returnPath = safeRequestReturnPath(event);
    if (existing?.email) return redirect(event, returnPath);

    const binding = resolveClientBinding(event, hub);
    if (!binding)
      return errorPage("Federated sign-in is not configured.", loginPath);
    const verifier = createPkceVerifier();
    const challenge = createPkceChallenge(verifier);
    let state: string;
    try {
      state = await createSsoState({
        returnPath: returnPath === "/" ? null : returnPath,
        ...binding,
        codeChallenge: challenge,
      });
    } catch (error: any) {
      if (error?.message === "RATE_LIMITED") {
        return errorPage(
          "Too many sign-in attempts. Please wait a moment and try again.",
          loginPath,
        );
      }
      return errorPage(
        "Could not start federated sign-in. Please try again.",
        loginPath,
      );
    }

    setPkceVerifierCookie(
      event,
      state,
      verifier,
      binding.redirectUri.startsWith("https://"),
    );
    const authorizeUrl =
      `${hub}/_agent-native/identity/authorize` +
      `?response_type=code` +
      `&app=${encodeURIComponent(binding.appId)}` +
      `&client_id=${encodeURIComponent(binding.clientId)}` +
      `&redirect_uri=${encodeURIComponent(binding.redirectUri)}` +
      `&state=${encodeURIComponent(state)}` +
      `&code_challenge=${encodeURIComponent(challenge)}` +
      `&code_challenge_method=S256`;
    return redirect(event, authorizeUrl);
  }

  if (sub === "/callback") {
    if (method !== "GET" && method !== "HEAD") {
      return new Response("Method not allowed", { status: 405 });
    }
    let code = "";
    let state = "";
    try {
      const url = new URL(requestUrl(event), "http://an.invalid");
      code = url.searchParams.get("code") || "";
      state = url.searchParams.get("state") || "";
    } catch {
      return errorPage("Malformed sign-in response.", loginPath);
    }
    if (!STATE_PATTERN.test(state) || !CODE.test(code)) {
      return errorPage("Malformed sign-in response.", loginPath);
    }

    const binding = resolveClientBinding(event, hub);
    const verifier = getCookie(event, verifierCookieName(state));
    clearPkceVerifierCookie(event, state);
    if (!binding || !verifier) {
      return errorPage(
        "Your sign-in session expired or was already used. Please try again.",
        loginPath,
      );
    }

    const stateResult = await consumeSsoState(state, {
      ...binding,
      codeChallenge: createPkceChallenge(verifier),
    });
    if (!stateResult.ok) {
      return errorPage(
        "Your sign-in session expired or was already used. Please try again.",
        loginPath,
      );
    }

    const assertion = await exchangeIdentityCode(hub, binding, {
      code,
      state,
      codeVerifier: verifier,
    });
    const identity = assertion
      ? await verifyIdentityAssertion(assertion, binding)
      : null;
    if (!identity || (await isJtiReplayed(identity.jti))) {
      return errorPage(
        "We could not verify the sign-in response. Please try again.",
        loginPath,
      );
    }
    if (
      (await isGoogleSignInRequiredForEmail(identity.email)) &&
      identity.authProvider !== "google"
    ) {
      return errorPage(GOOGLE_AUTH_REQUIRED_MESSAGE, loginPath);
    }

    try {
      await jitLinkIdentity(identity);
    } catch {
      return errorPage(
        "Could not finish linking your account. Please try again.",
        loginPath,
      );
    }
    try {
      await createOAuthSession(event, identity.email, {
        hasProductionSession: false,
      });
    } catch {
      return errorPage(
        "Signed in, but could not start your session. Please try again.",
        loginPath,
      );
    }
    return redirect(event, safeReturnPath(stateResult.returnPath));
  }

  return new Response("Not found", { status: 404 });
}

export function isIdentitySsoBypassPath(p: string): boolean {
  if (!isIdentitySsoEnabled()) return false;
  return (
    p === "/_agent-native/identity/login" ||
    p === "/_agent-native/identity/callback"
  );
}
