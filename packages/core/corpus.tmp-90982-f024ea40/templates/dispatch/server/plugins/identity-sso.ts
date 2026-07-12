/**
 * `/_agent-native/identity/authorize` — Dispatch as the cross-app identity
 * AUTHORITY ("Sign in with Agent-Native").
 *
 * Flow (single-endpoint, no code-exchange — see "Why no /token" below):
 *
 *   1. A first-party client app (mail, calendar, …) redirects an
 *      unauthenticated visitor here with:
 *        ?app=<id>&redirect_uri=<https url>&state=<opaque>
 *
 *   2. We validate `redirect_uri` against the strict allowlist
 *      (`isAllowedRedirectUri`). An invalid/forbidden value is rejected
 *      with 400 BEFORE any session work — an attacker-controlled
 *      `redirect_uri` must never receive a token. This is the single most
 *      important control on this endpoint.
 *
 *   3. We resolve the EXISTING Dispatch Better Auth session (`getSession`).
 *      - Not logged in -> 302 to the framework's existing sign-in
 *        entrypoint `/_agent-native/sign-in?return=<this authorize URL>`.
 *        The framework serves Dispatch's normal login form, and on success
 *        its post-login reload re-hits `/_agent-native/sign-in`, which 302s
 *        back to `return` (validated same-origin by the framework's
 *        `safeReturnPath`). That re-enters THIS handler authenticated. No
 *        new login UI; we reuse Dispatch's exact existing auth flow.
 *      - Logged in  -> mint + redirect (step 4).
 *
 *   4. Mint a SHORT-LIVED signed identity JWT using the EXISTING A2A signer
 *      (`signA2AToken`, HS256 over the shared `A2A_SECRET`). Claims are
 *      exactly: sub=email, email, name?, org_domain?, scope:"identity",
 *      aud=redirect_uri, redirect_uri, jti, short exp (<= 5 min). 302 to
 *      `redirect_uri` with the token and the caller's UNTOUCHED `state`
 *      appended as query params.
 *
 * Why no `/token` code-exchange endpoint:
 *   The token is already (a) short-lived (<=2 min exp), (b) signature-
 *   verified against the shared A2A secret, and (c) only ever delivered to
 *   an allowlisted first-party https host. Adding a code + exchange
 *   endpoint would add surface (a second unauthenticated route, a code
 *   store) without changing the trust model, since the redirect target is
 *   already constrained. We therefore sign directly and return via the
 *   redirect query — the simplest secure flow.
 *
 * Replay protection:
 *   The short `exp` (<=2 min) + random `jti` + the caller's `state`
 *   echo-check (the client MUST verify `state` it generated) bound the
 *   replay window. We intentionally do NOT add a Dispatch-side jti store:
 *   the core MCP connect-store jti helpers are not importable from a public
 *   `@agent-native/core` subpath, and a bespoke store would be net-new
 *   surface for a token whose window is already <=2 min and single-origin.
 *   This is documented as the chosen trade-off.
 *
 * Auth-guard reachability:
 *   `/_agent-native/*` is 401'd by the core auth guard when there is no
 *   session, which would break the logged-OUT bounce. So this plugin
 *   registers the exact path `/_agent-native/identity/authorize` as a
 *   `publicPath` via a second `createAuthPlugin({ publicPaths })` call.
 *   When two `createAuthPlugin` calls run in the same server boot on the
 *   same Nitro app, the framework APPENDS publicPaths to the live guard
 *   config (it does not clobber Dispatch's googleOnly/marketing/onboarding
 *   — verified in packages/core/src/server/auth.ts). The path is matched
 *   exactly (or as a `/`-segment prefix), so ONLY the authorize endpoint
 *   becomes public; any future `/_agent-native/identity/*` route stays
 *   protected. The handler then resolves the session ITSELF (exactly the
 *   `/_agent-native/open` pattern) — public-path only means "guard does not
 *   pre-empt", not "no auth": logged-out users are still bounced to login,
 *   and a token is only minted for a real session.
 */

import { signA2AToken } from "@agent-native/core/a2a";
import { getOrgDomain } from "@agent-native/core/org";
import {
  createAuthPlugin,
  getH3App,
  getSession,
} from "@agent-native/core/server";
import { defineEventHandler, getMethod } from "h3";
import type { H3Event } from "h3";

import {
  IDENTITY_TOKEN_TTL,
  buildIdentityClaims,
  buildRedirectLocation,
  isAllowedRedirectUri,
} from "../lib/identity-sso.js";

/** Exact path. Registered as a publicPath so the guard does not 401 it. */
const AUTHORIZE_PATH = "/_agent-native/identity/authorize";

function getRequestUrl(event: H3Event): string {
  return (event as any).node?.req?.url ?? (event as any).path ?? "/";
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function redirect(location: string): Response {
  // Native web Response — matches the redirect style used by the core
  // /open + auth routes (avoids h3 v2 sendRedirect behavior differences).
  return new Response("", { status: 302, headers: { Location: location } });
}

/**
 * Resolve the org domain for the active org, best-effort. A missing org
 * just yields a token with no `org_domain` claim (still a valid identity).
 */
async function resolveOrgDomain(
  orgId: string | undefined,
): Promise<string | undefined> {
  if (!orgId) return undefined;
  try {
    return (await getOrgDomain(orgId)) ?? undefined;
  } catch {
    return undefined;
  }
}

const authorizeHandler = defineEventHandler(
  async (event: H3Event): Promise<Response> => {
    const method = getMethod(event);
    if (method !== "GET" && method !== "HEAD") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const rawUrl = getRequestUrl(event);
    let search: URLSearchParams;
    try {
      search = new URL(rawUrl, "http://an.invalid").searchParams;
    } catch {
      search = new URLSearchParams();
    }

    const redirectUri = search.get("redirect_uri");
    const state = search.get("state");

    // ---- Control 1: redirect_uri allowlist (BEFORE any session work) ----
    // An attacker-supplied redirect_uri must never reach the mint path.
    if (!isAllowedRedirectUri(redirectUri)) {
      return jsonResponse(
        {
          error: "invalid_redirect_uri",
          error_description:
            "redirect_uri must be an absolute https URL on an allowed " +
            "first-party host (a localhost http URL is allowed for " +
            "local development).",
        },
        400,
      );
    }
    // Narrowed to string by isAllowedRedirectUri.
    const safeRedirectUri = redirectUri as string;

    // ---- Resolve the EXISTING Dispatch session --------------------------
    const session = await getSession(event).catch(() => null);

    if (!session?.email) {
      // Logged out: bounce through the framework's existing sign-in
      // entrypoint, preserving the FULL authorize URL as the return target
      // so we re-enter here authenticated. `safeReturnPath` (framework
      // side) validates `return` is same-origin, so this cannot be turned
      // into an open redirect.
      const queryStart = rawUrl.indexOf("?");
      const authorizePathWithQuery =
        AUTHORIZE_PATH + (queryStart >= 0 ? rawUrl.slice(queryStart) : "");
      const loc =
        "/_agent-native/sign-in?return=" +
        encodeURIComponent(authorizePathWithQuery);
      return redirect(loc);
    }

    // ---- Mint the short-lived identity token ----------------------------
    if (!process.env.A2A_SECRET) {
      // Without a shared secret, no first-party app could verify the token.
      return jsonResponse(
        {
          error: "identity_unavailable",
          error_description:
            "This Dispatch deployment has no A2A_SECRET configured, so " +
            "identity tokens cannot be signed.",
        },
        503,
      );
    }

    const orgDomain = await resolveOrgDomain(session.orgId);
    const claims = buildIdentityClaims({
      email: session.email,
      name: session.name,
      orgDomain,
    });

    let token: string;
    try {
      // Reuse the EXISTING signer. `sub`/`org_domain` are set by the
      // signer from (email, orgDomain) and CANNOT be overridden via
      // extraClaims (the signer spreads them last), so the extra
      // identity claims here can never spoof identity.
      token = await signA2AToken(session.email, orgDomain, undefined, {
        preferGlobalSecret: true,
        // jose treats a number as an absolute Unix ts; pass the duration
        // string ("2m") so exp is `now + 2m`.
        expiresIn: IDENTITY_TOKEN_TTL,
        extraClaims: {
          email: claims.email,
          ...(claims.name ? { name: claims.name } : {}),
          scope: claims.scope,
          aud: safeRedirectUri,
          redirect_uri: safeRedirectUri,
          jti: claims.jti,
        },
      });
    } catch {
      return jsonResponse(
        {
          error: "sign_failed",
          error_description: "Failed to mint identity token.",
        },
        500,
      );
    }

    return redirect(buildRedirectLocation(safeRedirectUri, token, state));
  },
);

/**
 * Dispatch identity-SSO plugin. Mounts the authorize route and registers
 * its exact path as a public path so the core auth guard does not 401 the
 * logged-out bounce. The `createAuthPlugin({ publicPaths })` call is
 * additive — it appends to the live guard config without disturbing the
 * primary Dispatch auth plugin's googleOnly/marketing/onboarding config.
 */
export default async (nitroApp: any) => {
  getH3App(nitroApp).use(AUTHORIZE_PATH, authorizeHandler);
  return createAuthPlugin({ publicPaths: [AUTHORIZE_PATH] })(nitroApp);
};
