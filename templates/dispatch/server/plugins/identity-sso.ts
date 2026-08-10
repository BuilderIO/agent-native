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
 *      - Not logged in -> 302 to the sign-in href minted by the framework's
 *        `signInJourney`, carrying this authorize path as an opaque
 *        continuation. The framework serves Dispatch's normal login form,
 *        and on success resumes the continuation, re-entering THIS handler
 *        authenticated. No new login UI; we reuse Dispatch's exact
 *        existing auth flow.
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
 *   Dispatch's primary auth plugin receives the exact public paths from
 *   `setupDispatch`. These handlers still resolve the session themselves;
 *   public-path only means the guard does not pre-empt the logged-out bounce.
 */

import { signA2AToken } from "@agent-native/core/a2a";
import {
  getFeatureFlagRules,
  isFeatureFlagEnabled,
  normalizeFeatureFlagRules,
} from "@agent-native/core/feature-flags";
import { getOrgDomain } from "@agent-native/core/org";
import { getH3App, getSession } from "@agent-native/core/server";
import { signInJourney } from "@agent-native/core/shared";
import { defineEventHandler, getMethod } from "h3";
import type { H3Event } from "h3";

import { DESKTOP_WORKSPACE_SSO_FLAG } from "../../shared/feature-flags.js";
import {
  IDENTITY_TOKEN_TTL,
  buildIdentityClaims,
  buildRedirectLocation,
  isAllowedRedirectUri,
} from "../lib/identity-sso.js";

const AVAILABILITY_PATH = "/_agent-native/identity/availability";
const AUTHORIZE_PATH = "/_agent-native/identity/authorize";

function getRequestUrl(event: H3Event): string {
  return (event as any).node?.req?.url ?? (event as any).path ?? "/";
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Type": "application/json",
    },
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

export async function canAttemptWorkspaceSso(): Promise<boolean> {
  const stored = await getFeatureFlagRules(
    DESKTOP_WORKSPACE_SSO_FLAG.key,
    {},
  ).catch(() => null);
  if (!stored) return false;
  const rules = normalizeFeatureFlagRules(stored);
  if (rules.mode === "off") return false;
  if (rules.mode === "on") return true;
  return (
    rules.emails.length > 0 || rules.orgIds.length > 0 || rules.percentage > 0
  );
}

export async function isWorkspaceSsoEnabledForSession(
  session: Awaited<ReturnType<typeof getSession>>,
): Promise<boolean> {
  if (!session?.email) return false;
  return isFeatureFlagEnabled(DESKTOP_WORKSPACE_SSO_FLAG, {
    userEmail: session.email,
    userKey: session.email,
    orgId: session.orgId,
  }).catch(() => false);
}

const availabilityHandler = defineEventHandler(
  async (event: H3Event): Promise<Response> => {
    const method = getMethod(event);
    if (method !== "GET" && method !== "HEAD") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }
    const session = await getSession(event).catch(() => null);
    const available = session?.email
      ? await isWorkspaceSsoEnabledForSession(session)
      : await canAttemptWorkspaceSso();
    return jsonResponse({ available }, 200);
  },
);

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

    if (!(await canAttemptWorkspaceSso())) {
      return jsonResponse({ error: "not_found" }, 404);
    }

    // ---- Resolve the EXISTING Dispatch session --------------------------
    const session = await getSession(event).catch(() => null);

    if (!session?.email) {
      // Logged out: bounce through the framework's one sign-in journey,
      // preserving the FULL authorize path as the continuation so we
      // re-enter here authenticated.
      const queryStart = rawUrl.indexOf("?");
      const authorizePathWithQuery =
        AUTHORIZE_PATH + (queryStart >= 0 ? rawUrl.slice(queryStart) : "");
      // No basePath: this route is registered at the bare, unprefixed path
      // (see the getH3App().use below), so base-path containment would
      // reject its own authorize URL on a base-path deploy. The pathname is
      // a compile-time constant; only the query is request-derived, and
      // signInJourney validates that.
      const { signInHref } = signInJourney({ at: authorizePathWithQuery });
      if (!signInHref) {
        return jsonResponse(
          {
            error: "invalid_authorize_target",
            error_description:
              "The authorize URL is not a valid sign-in continuation.",
          },
          400,
        );
      }
      return redirect(signInHref);
    }

    if (!(await isWorkspaceSsoEnabledForSession(session))) {
      return jsonResponse({ error: "not_found" }, 404);
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
 * Dispatch identity-SSO plugin. The primary Dispatch auth plugin owns the
 * exact public-path registration; this plugin owns only these handlers.
 */
export default async (nitroApp: any) => {
  getH3App(nitroApp).use(AVAILABILITY_PATH, availabilityHandler);
  getH3App(nitroApp).use(AUTHORIZE_PATH, authorizeHandler);
};
