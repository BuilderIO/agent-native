/**
 * Cross-app SSO ("Sign in with Agent-Native") — the CLIENT side.
 *
 * Each hosted `*.agent-native.com` app has its OWN Better Auth user store
 * (a separate database per app). This module lets an app federate sign-in to
 * an identity authority (Dispatch) so a user logged in there can land in this
 * app without re-entering credentials.
 *
 * Opt-in, OFF by default, fully reversible. Everything here is gated on the
 * single env var `AGENT_NATIVE_IDENTITY_HUB_URL`:
 *
 *   - UNSET  → `isIdentitySsoEnabled()` is false. The route handler 404s, the
 *     auth-guard bypass does not apply, and the login page renders no SSO
 *     button. Existing auth is byte-for-byte unchanged.
 *   - SET    (e.g. `https://dispatch.agent-native.com`) → two routes mount:
 *       GET /_agent-native/identity/login
 *         302 → `<HUB>/_agent-native/identity/authorize?app=<id>
 *                 &redirect_uri=<thisOrigin>/_agent-native/identity/callback
 *                 &state=<single-use CSRF state>`
 *       GET /_agent-native/identity/callback?token=<jwt>&state=<state>
 *         Verifies the hub-issued identity JWT (HS256 over the SHARED A2A
 *         secret — the exact verify path A2A / MCP `verifyAuth` use), checks
 *         `scope:"identity"`, `exp`, single-use CSRF `state`, and (best
 *         effort) `jti` replay, then JIT-links the verified email into this
 *         app's local Better Auth store and mints a normal framework session
 *         the SAME way the Google OAuth callback does.
 *
 * Crypto reuse: the hub signs with `jose.SignJWT(...).sign(A2A_SECRET)` (the
 * existing `signA2AToken` builder). We verify with the identical
 * `jose.jwtVerify(token, A2A_SECRET)` call `mcp/build-server.ts#verifyAuth`
 * uses — no new crypto, no new keys.
 *
 * Session reuse: a NEW email is created via `auth.api.signUpEmail` — the
 * exact Better Auth signup path `maybeAutoCreateDevSession` already uses, so
 * the adapter creates the `user` (+ adapter-managed credential `account`)
 * row schema-correctly and the normal `databaseHooks.user.create.after`
 * (org auto-join, analytics) fires. The framework session is then minted via
 * `createOAuthSession` — the literal Google-OAuth session-mint path
 * (`addSession` + `setFrameworkSessionCookie`). An EXISTING email is never
 * mutated: we only ADD an inert federated-provider `account` row (if absent)
 * and mint the same framework session. Removing the env returns the app to
 * its prior auth with no residue.
 */

import { createHash } from "node:crypto";

import type { H3Event } from "h3";
import { getMethod } from "h3";
import * as jose from "jose";

import { getAppName } from "./app-name.js";
import { getSession, safeReturnPath, isExpectedAuthFailure } from "./auth.js";
import {
  getBetterAuth,
  getBetterAuthInternalAdapter,
} from "./better-auth-instance.js";
import { createOAuthSession, getOrigin } from "./google-oauth.js";
import {
  createSsoState,
  consumeSsoState,
  isJtiReplayed,
  getIdentityHubUrl,
  isIdentitySsoEnabled,
  identitySsoLoginButtonHtml,
} from "./identity-sso-store.js";

export { getIdentityHubUrl, isIdentitySsoEnabled, identitySsoLoginButtonHtml };

/**
 * The provider id recorded on the additive `account` row we link for an
 * EXISTING local user. Must match the value the Dispatch authority agent
 * expects to interoperate with — documented in the report so the two sides
 * stay in sync. Inert when this provider is unused, so removing the env var
 * leaves no behavioural residue.
 */
export const IDENTITY_SSO_PROVIDER_ID = "agent-native";

/**
 * The JWT `scope` claim the hub MUST set on the identity token. The callback
 * rejects any token whose `scope` is not exactly this value, so an A2A
 * delegation JWT (no scope, or `scope:"mcp-connect"`) can never be replayed
 * as an identity assertion.
 */
export const IDENTITY_SSO_SCOPE = "identity";

/** Identity tokens older than this are rejected even if `exp` is generous. */
const MAX_TOKEN_AGE_SECONDS = 10 * 60;

/**
 * A stable id for THIS app, sent to the hub as `?app=` so the authority can
 * record / display which app requested sign-in. Best-effort, non-secret,
 * never trusted for identity. Falls back to the request host.
 */
function resolveAppId(event: H3Event): string {
  const configured =
    process.env.AGENT_NATIVE_APP_ID?.trim() ||
    process.env.AGENT_NATIVE_WORKSPACE_APP_ID?.trim();
  if (configured) return configured;
  const name = getAppName();
  if (name && name !== "app") return name;
  try {
    const origin = getOrigin(event);
    return new URL(origin).hostname.split(".")[0] || "app";
  } catch {
    return "app";
  }
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function redirect(event: H3Event, location: string): Response {
  // Mirror any Set-Cookie staged on the event (e.g. the framework session
  // cookie set by `createOAuthSession`) onto the 302. h3 v2's
  // `prepareResponse` only merges staged Set-Cookie into a *2xx* web
  // Response and drops them for non-2xx — so a bare
  // `new Response("", { status: 302 })` here would silently lose the
  // session cookie and the user would finish "Sign in with Agent-Native"
  // still logged out. This mirrors the framework's `redirectWithStagedCookies`
  // (auth.ts) exactly; it is a no-op when nothing is staged.
  const headers = new Headers({ Location: location });
  const staged = (event as any).res?.headers?.getSetCookie?.() ?? [];
  for (const cookie of staged) headers.append("set-cookie", cookie);
  return new Response("", { status: 302, headers });
}

/**
 * Minimal self-contained error page (same inline-HTML approach as the auth /
 * connect pages). Used when the federated round-trip fails so the user gets
 * an actionable message instead of a raw 4xx. `message` is plain text.
 */
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

/**
 * Derive a strong, deterministic, NEVER-exposed credential for a JIT-created
 * SSO user. Bound to the shared A2A secret + email so it is stable across
 * function executions but unguessable without the deployment secret. Only
 * ever used as the `password` argument to Better Auth's own
 * `signUpEmail` / `signInEmail` — never returned, logged, or sent anywhere.
 */
function deriveSsoCredential(email: string): string {
  const secret = process.env.A2A_SECRET || "";
  // A salted SHA-256 over secret + email: stable across function executions
  // (so the same SSO user always derives the same stand-in password) but
  // unguessable without the deployment secret. This account's only sign-in
  // path is the signature-verified hub token, so the value is never used by
  // anyone but Better Auth's own signUpEmail.
  const digest = createHash("sha256")
    .update(`${secret}:agent-native-sso:${email}`)
    .digest("base64url");
  return `an-sso_${digest}`;
}

/**
 * JIT-link the verified hub identity into THIS app's local Better Auth
 * store, strictly by verified email and strictly additively.
 *
 *   - EXISTING email → the local `user` / `session` / existing `account`
 *     rows are NEVER read-modify-written. We only ADD (if absent) one
 *     federated-provider `account` row via Better Auth's OWN
 *     `internalAdapter.linkAccount` — so id, timestamps, and schema stay
 *     adapter-correct. The row is inert (no template path reads
 *     `provider_id = "agent-native"`), so removing the env var leaves zero
 *     behavioural residue.
 *   - NEW email → created via the SAME `auth.api.signUpEmail` path the app
 *     already uses (`maybeAutoCreateDevSession` uses the identical call), so
 *     the adapter creates the `user` (+ a schema-correct credential
 *     `account`) and `databaseHooks.user.create.after` (org auto-join,
 *     analytics) fires exactly as for a normal first-time signup. Idempotent
 *     under a concurrent create (the "already exists" failure is swallowed).
 *
 * Returns nothing — success is implied by not throwing. Account-link
 * failures for an existing user are swallowed (the verified email already
 * authenticated them; the link row is bookkeeping and must never block the
 * session).
 */
async function jitLinkIdentity(identity: VerifiedIdentity): Promise<void> {
  const adapter = await getBetterAuthInternalAdapter();

  // Look up the local user via Better Auth's own adapter (read-only).
  let existing = adapter
    ? await adapter
        .findUserByEmail(identity.email, { includeAccounts: true })
        .catch(() => null)
    : null;

  if (!existing) {
    // No local user → create via the SAME signup path the app already uses.
    const auth = await getBetterAuth();
    try {
      await auth.api.signUpEmail({
        body: {
          email: identity.email,
          password: deriveSsoCredential(identity.email),
          name: identity.name || identity.email.split("@")[0] || "User",
        },
      });
    } catch (e) {
      // "already exists" (concurrent create / pre-existing user the adapter
      // lookup missed) is expected and fine — fall through to linking.
      if (!isExpectedAuthFailure(e)) throw e;
    }
    if (adapter) {
      existing = await adapter
        .findUserByEmail(identity.email, { includeAccounts: true })
        .catch(() => null);
    }
  }

  // ADD the inert federated-provider link iff a local user resolved and the
  // link is absent. Better Auth's `linkAccount` is the additive, schema-
  // correct API — we never UPDATE/DELETE/RENAME any identity row.
  if (adapter && existing?.user?.id) {
    const accountId = identity.sub || identity.email;
    const alreadyLinked = (existing.accounts ?? []).some(
      (a) =>
        a.providerId === IDENTITY_SSO_PROVIDER_ID && a.accountId === accountId,
    );
    if (!alreadyLinked) {
      try {
        await adapter.linkAccount({
          userId: existing.user.id,
          providerId: IDENTITY_SSO_PROVIDER_ID,
          accountId,
        });
      } catch {
        // Inert bookkeeping row — never block sign-in on a link failure.
      }
    }
  }
}

interface VerifiedIdentity {
  email: string;
  name: string;
  orgDomain?: string;
  sub: string;
  jti?: string;
}

/**
 * Verify the hub-issued identity JWT using the EXACT same path A2A / MCP use:
 * `jose.jwtVerify(token, A2A_SECRET)`. `jwtVerify` enforces `exp`
 * automatically. We additionally require:
 *   - `scope === "identity"` (so an A2A delegation token can't be replayed)
 *   - `aud` is THIS app's callback URL (so a token minted for one app cannot
 *     be replayed against another app's callback with a fresh state)
 *   - a non-empty `email` claim (the join key — comes ONLY from the verified
 *     token, never a query param)
 *   - issued no more than `MAX_TOKEN_AGE_SECONDS` ago (belt-and-braces on top
 *     of `exp` in case the hub mints long-lived tokens)
 *
 * Returns the verified identity, or `null` for ANY failure (bad signature,
 * expired, wrong scope, missing email, malformed). The caller maps `null` to
 * a generic error — it never leaks which check failed.
 */
async function verifyIdentityToken(
  token: string,
  expectedAudience: string,
): Promise<VerifiedIdentity | null> {
  const secret = process.env.A2A_SECRET;
  if (!secret || !token) return null;
  try {
    const { payload } = await jose.jwtVerify(
      token,
      new TextEncoder().encode(secret),
    );
    if (payload.scope !== IDENTITY_SSO_SCOPE) return null;
    const aud = payload.aud;
    const audienceMatches = Array.isArray(aud)
      ? aud.includes(expectedAudience)
      : aud === expectedAudience;
    if (!audienceMatches) return null;
    if (
      typeof payload.redirect_uri === "string" &&
      payload.redirect_uri !== expectedAudience
    ) {
      return null;
    }
    const email =
      typeof payload.email === "string" && payload.email.includes("@")
        ? payload.email.trim().toLowerCase()
        : null;
    if (!email) return null;
    const iat = typeof payload.iat === "number" ? payload.iat : undefined;
    if (iat !== undefined && Date.now() / 1000 - iat > MAX_TOKEN_AGE_SECONDS) {
      return null;
    }
    const sub =
      typeof payload.sub === "string" && payload.sub ? payload.sub : email;
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
      sub,
      jti:
        typeof payload.jti === "string" && payload.jti
          ? payload.jti
          : undefined,
    };
  } catch {
    // Bad signature / expired / malformed — never reveal which.
    return null;
  }
}

// ---------------------------------------------------------------------------
// Route handler — single entry point; the core-routes-plugin dispatches the
// subpath, mirroring `handleMcpConnect`.
// ---------------------------------------------------------------------------

/**
 * Handle a `/_agent-native/identity/*` request. `subpath` is the part after
 * `/identity` (e.g. `/login`, `/callback`). Returns a 404 Response whenever
 * the feature is disabled so an unset env var is a true no-op even if the
 * route somehow gets mounted.
 */
export async function handleIdentitySso(
  event: H3Event,
  subpath: string,
): Promise<Response> {
  const hub = getIdentityHubUrl();
  if (!hub) {
    return new Response("Not found", { status: 404 });
  }

  const method = getMethod(event);
  const sub = ("/" + subpath.replace(/^\/+/, "").replace(/\/+$/, "")).replace(
    /^\/$/,
    "",
  );
  const origin = getOrigin(event);
  const loginPath = "/_agent-native/sign-in";

  // ---- GET /login → 302 to the hub authorize endpoint ------------------
  if (sub === "/login") {
    if (method !== "GET" && method !== "HEAD") {
      return new Response("Method not allowed", { status: 405 });
    }
    // Already signed in here? Skip the round-trip.
    const existing = await getSession(event).catch(() => null);
    let returnPath = "/";
    try {
      const u = new URL(
        (event as any).node?.req?.url ?? event.path ?? "/",
        "http://an.invalid",
      );
      returnPath = safeReturnPath(u.searchParams.get("return"));
    } catch {
      returnPath = "/";
    }
    if (existing?.email) {
      return redirect(event, returnPath);
    }

    let state: string;
    try {
      state = await createSsoState(returnPath === "/" ? null : returnPath);
    } catch (e: any) {
      if (e?.message === "RATE_LIMITED") {
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

    const redirectUri = `${origin}/_agent-native/identity/callback`;
    const authorizeUrl =
      `${hub}/_agent-native/identity/authorize` +
      `?app=${encodeURIComponent(resolveAppId(event))}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${encodeURIComponent(state)}`;
    return redirect(event, authorizeUrl);
  }

  // ---- GET /callback → verify token, JIT-link, mint session ------------
  if (sub === "/callback") {
    if (method !== "GET" && method !== "HEAD") {
      return new Response("Method not allowed", { status: 405 });
    }

    let token = "";
    let stateParam = "";
    try {
      const u = new URL(
        (event as any).node?.req?.url ?? event.path ?? "/",
        "http://an.invalid",
      );
      token =
        u.searchParams.get("token") || u.searchParams.get("id_token") || "";
      stateParam = u.searchParams.get("state") || "";
    } catch {
      return errorPage("Malformed sign-in response.", loginPath);
    }

    // CSRF: the state must be one we minted, unexpired, and never consumed.
    // Consume it FIRST (single-use) so a replayed callback can't pass even
    // with a still-valid token.
    const stateResult = await consumeSsoState(stateParam);
    if (!stateResult.ok) {
      return errorPage(
        "Your sign-in session expired or was already used. Please try again.",
        loginPath,
      );
    }

    // Identity comes ONLY from the signature-verified token. The query
    // `email` (if any) is never trusted.
    const expectedAudience = `${origin}/_agent-native/identity/callback`;
    const identity = await verifyIdentityToken(token, expectedAudience);
    if (!identity) {
      return errorPage(
        "We could not verify the sign-in response. Please try again.",
        loginPath,
      );
    }

    // Replay guard (best-effort, defence in depth on top of single-use
    // state): reject a token whose jti we've already accepted.
    if (await isJtiReplayed(identity.jti)) {
      return errorPage(
        "This sign-in link was already used. Please try again.",
        loginPath,
      );
    }

    // JIT link STRICTLY by verified email — additive only. Existing users
    // are never mutated; new users are created via the app's own signup
    // path; an inert federated `account` link is added via Better Auth's
    // own adapter API. A failure here must not leave the user signed out
    // mid-flow, so surface a retryable error rather than a half state.
    try {
      await jitLinkIdentity(identity);
    } catch {
      return errorPage(
        "Could not finish linking your account. Please try again.",
        loginPath,
      );
    }

    // Mint a normal framework session EXACTLY the way the Google OAuth
    // callback does (`createOAuthSession` → addSession + framework cookie).
    // `hasProductionSession: false` so a fresh session cookie is always set.
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

    // Land the user back where they started (validated same-origin path).
    const dest = safeReturnPath(stateResult.returnPath);
    return redirect(event, dest);
  }

  return new Response("Not found", { status: 404 });
}

/**
 * Whether the given (already base-path-stripped) request path is one of the
 * SSO routes that must bypass the blanket auth guard. Both routes resolve /
 * mint the browser session themselves: `/login` is the unauthenticated entry
 * point, and `/callback` is hit by a user who is (by definition) not yet
 * signed in to THIS app. Returns false when the feature is disabled, so the
 * guard's behaviour is unchanged with the env unset.
 */
export function isIdentitySsoBypassPath(p: string): boolean {
  if (!isIdentitySsoEnabled()) return false;
  return (
    p === "/_agent-native/identity/login" ||
    p === "/_agent-native/identity/callback"
  );
}
