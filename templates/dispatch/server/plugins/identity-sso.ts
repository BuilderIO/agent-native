/**
 * Dispatch identity authority routes.
 *
 * Browser flow:
 *   1. Client -> /authorize?response_type=code&code_challenge=...
 *   2. Dispatch authenticates the existing user and redirects with `code` and
 *      the caller's opaque `state`.
 *   3. Client server -> /token with code + state + PKCE verifier.
 *   4. Dispatch atomically consumes the code and returns a short-lived signed
 *      identity assertion server-to-server.
 *
 * The browser never receives a JWT, password, or reusable identity assertion.
 * The default-off Desktop flag still gates only the packaged Canary path;
 * ordinary browser federation remains controlled by the client's explicit
 * identity-hub configuration.
 */

import { signA2AToken } from "@agent-native/core/a2a";
import {
  hasActiveFeatureFlagRollout,
  isFeatureFlagEnabled,
} from "@agent-native/core/feature-flags";
import { getOrgDomain } from "@agent-native/core/org";
import { getH3App, getSession } from "@agent-native/core/server";
import { signInJourney } from "@agent-native/core/shared";
import { defineEventHandler, getHeader, getMethod, readBody } from "h3";
import type { H3Event } from "h3";

import { DESKTOP_WORKSPACE_SSO_FLAG } from "../../shared/feature-flags.js";
import {
  IDENTITY_AUTHORIZATION_CODE_TTL_MS,
  IDENTITY_SCOPE,
  IDENTITY_SSO_TOKEN_PATH,
  IDENTITY_TOKEN_TTL,
  buildIdentityClaims,
  buildRedirectLocation,
  consumeIdentityAuthorizationCode,
  createIdentityAuthorizationCode,
  isValidSsoState,
  normalizeIdentityAuthority,
  resolveIdentitySsoApp,
} from "../lib/identity-sso.js";

const AVAILABILITY_PATH = "/_agent-native/identity/availability";
const AUTHORIZE_PATH = "/_agent-native/identity/authorize";
const DESKTOP_SSO_CANARY_USER_AGENT = /AgentNativeDesktopSsoCanary\//i;

export function isDesktopWorkspaceSsoRequest(
  userAgent: string | undefined,
): boolean {
  return DESKTOP_SSO_CANARY_USER_AGENT.test(userAgent ?? "");
}

function getRequestUrl(event: H3Event): string {
  return (event as any).node?.req?.url ?? (event as any).path ?? "/";
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Type": "application/json",
      "Referrer-Policy": "no-referrer",
    },
  });
}

function redirect(location: string): Response {
  return new Response("", {
    status: 302,
    headers: {
      Location: location,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}

function resolveAuthority(): string | null {
  return normalizeIdentityAuthority(
    process.env.APP_URL || process.env.BETTER_AUTH_URL,
  );
}

function bodyString(body: unknown, key: string): string | null {
  if (!body || typeof body !== "object") return null;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

async function resolveOrgDomain(
  orgId: string | undefined,
): Promise<string | undefined> {
  if (!orgId) return undefined;
  try {
    return (await getOrgDomain(orgId)) ?? undefined;
  } catch (error) {
    void error;
    return undefined;
  }
}

export async function canAttemptWorkspaceSso(): Promise<boolean> {
  return hasActiveFeatureFlagRollout(DESKTOP_WORKSPACE_SSO_FLAG.key).catch(
    () => false,
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

export const availabilityHandler = defineEventHandler(
  async (event: H3Event): Promise<Response> => {
    const method = getMethod(event);
    if (method !== "GET" && method !== "HEAD") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }
    const session = await getSession(event).catch(() => null);
    const isDesktopRequest = isDesktopWorkspaceSsoRequest(
      getHeader(event, "user-agent"),
    );
    // Anonymous availability is only a Canary hint used by an explicit
    // Desktop settings action. Ordinary browser requests never get a positive
    // answer here, so this endpoint cannot become an anonymous auto-login.
    const available = session?.email
      ? await isWorkspaceSsoEnabledForSession(session)
      : isDesktopRequest
        ? await canAttemptWorkspaceSso()
        : false;
    return jsonResponse({ available }, 200);
  },
);

export const authorizeHandler = defineEventHandler(
  async (event: H3Event): Promise<Response> => {
    const method = getMethod(event);
    if (method !== "GET" && method !== "HEAD") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const rawUrl = getRequestUrl(event);
    let search: URLSearchParams;
    try {
      search = new URL(rawUrl, "http://an.invalid").searchParams;
    } catch (error) {
      void error;
      search = new URLSearchParams();
    }

    const redirectUri = search.get("redirect_uri");
    const appId = search.get("app");
    const clientId = search.get("client_id");
    const state = search.get("state");
    const responseType = search.get("response_type");
    const codeChallenge = search.get("code_challenge");
    const codeChallengeMethod = search.get("code_challenge_method");
    const isDesktopRequest = isDesktopWorkspaceSsoRequest(
      getHeader(event, "user-agent"),
    );

    // Validate every browser-controlled protocol parameter before resolving a
    // Dispatch session or constructing a continuation URL.
    const registration = resolveIdentitySsoApp(appId, clientId, redirectUri);
    if (
      !registration ||
      responseType !== "code" ||
      !isValidSsoState(state) ||
      !isValidSsoState(codeChallenge) ||
      codeChallengeMethod !== "S256"
    ) {
      return jsonResponse(
        {
          error: "invalid_authorization_request",
          error_description:
            "The app, client, callback, state, or PKCE binding is not registered.",
        },
        400,
      );
    }
    const safeRedirectUri = redirectUri as string;
    const safeAppId = appId as string;
    const safeClientId = clientId as string;
    const safeState = state as string;
    const safeCodeChallenge = codeChallenge as string;
    const authority = resolveAuthority();
    if (!authority) {
      return jsonResponse(
        {
          error: "identity_unavailable",
          error_description: "Dispatch identity authority is not configured.",
        },
        503,
      );
    }

    if (isDesktopRequest && !(await canAttemptWorkspaceSso())) {
      return jsonResponse({ error: "not_found" }, 404);
    }

    const session = await getSession(event).catch(() => null);
    if (!session?.email) {
      const queryStart = rawUrl.indexOf("?");
      const authorizePathWithQuery =
        AUTHORIZE_PATH + (queryStart >= 0 ? rawUrl.slice(queryStart) : "");
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

    if (isDesktopRequest && !(await isWorkspaceSsoEnabledForSession(session))) {
      return jsonResponse({ error: "not_found" }, 404);
    }
    if (!process.env.A2A_SECRET) {
      return jsonResponse(
        {
          error: "identity_unavailable",
          error_description: "Dispatch identity signing is not configured.",
        },
        503,
      );
    }

    let code: string;
    try {
      code = await createIdentityAuthorizationCode({
        state: safeState,
        appId: safeAppId,
        clientId: safeClientId,
        redirectUri: safeRedirectUri,
        authority,
        codeChallenge: safeCodeChallenge,
        email: session.email,
        name: session.name,
        orgDomain: await resolveOrgDomain(session.orgId),
      });
    } catch (error) {
      void error;
      return jsonResponse(
        {
          error: "identity_unavailable",
          error_description: "Could not create a one-time sign-in code.",
        },
        503,
      );
    }

    return redirect(buildRedirectLocation(safeRedirectUri, code, safeState));
  },
);

export const tokenHandler = defineEventHandler(
  async (event: H3Event): Promise<Response> => {
    if (getMethod(event) !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }
    const body = await readBody(event).catch((error) => {
      // coercion-ok: unreadable request bodies are rejected as invalid requests below.
      void error;
      return null;
    });
    const grantType = bodyString(body, "grant_type");
    const code = bodyString(body, "code");
    const state = bodyString(body, "state");
    const appId = bodyString(body, "app_id");
    const clientId = bodyString(body, "client_id");
    const redirectUri = bodyString(body, "redirect_uri");
    const codeVerifier = bodyString(body, "code_verifier");
    if (
      grantType !== "authorization_code" ||
      !code ||
      !state ||
      !appId ||
      !clientId ||
      !redirectUri ||
      !codeVerifier
    ) {
      return jsonResponse({ error: "invalid_token_request" }, 400);
    }

    const registration = resolveIdentitySsoApp(appId, clientId, redirectUri);
    if (!registration) {
      return jsonResponse({ error: "invalid_token_request" }, 400);
    }
    const authority = resolveAuthority();
    if (!authority || !process.env.A2A_SECRET) {
      return jsonResponse({ error: "identity_unavailable" }, 503);
    }

    const identity = await consumeIdentityAuthorizationCode({
      code,
      state,
      appId,
      clientId,
      redirectUri,
      authority,
      codeVerifier,
    }).catch((error) => {
      // coercion-ok: an unreadable authorization code is handled as invalid_grant below.
      void error;
      return null;
    });
    if (!identity) return jsonResponse({ error: "invalid_grant" }, 400);

    const claims = buildIdentityClaims({
      email: identity.email,
      name: identity.name,
      orgDomain: identity.orgDomain,
    });
    let assertion: string;
    try {
      assertion = await signA2AToken(
        identity.email,
        identity.orgDomain,
        undefined,
        {
          preferGlobalSecret: true,
          expiresIn: IDENTITY_TOKEN_TTL,
          audience: redirectUri,
          extraClaims: {
            email: claims.email,
            ...(claims.name ? { name: claims.name } : {}),
            scope: IDENTITY_SCOPE,
            jti: identity.jti,
            redirect_uri: redirectUri,
            identity_client_id: clientId,
            identity_authority: authority,
          },
        },
      );
    } catch (error) {
      void error;
      return jsonResponse({ error: "sign_failed" }, 500);
    }

    // This response is server-to-server. It is never redirected through the
    // browser and is intentionally not rendered or logged.
    return jsonResponse(
      {
        assertion,
        token_type: "identity-assertion",
        expires_in: Math.floor(IDENTITY_AUTHORIZATION_CODE_TTL_MS / 1_000),
      },
      200,
    );
  },
);

/** Mount the authority and token endpoints. */
export default async (nitroApp: any) => {
  getH3App(nitroApp).use(AVAILABILITY_PATH, availabilityHandler);
  getH3App(nitroApp).use(AUTHORIZE_PATH, authorizeHandler);
  getH3App(nitroApp).use(IDENTITY_SSO_TOKEN_PATH, tokenHandler);
};
