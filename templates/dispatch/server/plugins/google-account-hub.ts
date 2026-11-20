/**
 * Google account hub.
 *
 * Dispatch holds a person's Google accounts as workspace connections. A
 * hosted app on its own database asks here for a short-lived access token
 * instead of keeping Google refresh tokens of its own:
 *
 *   1. The app signs a two-minute assertion with its own federation secret
 *      (`AGENT_NATIVE_IDENTITY_FEDERATION_SECRET_<APP>` here), naming the
 *      person, its `app_id`, and its origin as issuer.
 *   2. Dispatch checks the assertion against that app's registration, finds
 *      the person's connections for the requested provider that are granted
 *      to that app, and refreshes each one's Google token with only that
 *      provider's scopes.
 *   3. The app gets the access tokens (about an hour each) and calls Google
 *      directly. The refresh token never leaves Dispatch, and removing an
 *      app's grant cuts it off at its next request.
 */

import { verifyA2AToken } from "@agent-native/core/a2a";
import { getWorkspaceConnectionProvider } from "@agent-native/core/connections";
import { GOOGLE_ACCOUNT_HUB_SCOPE } from "@agent-native/core/google-account-hub";
import { getOAuthTokens } from "@agent-native/core/oauth-tokens";
import { resolveOrgIdForEmail } from "@agent-native/core/org";
import {
  getH3App,
  resolveGoogleProviderCredentialCandidatesWithReader,
  resolveSecret,
  runWithRequestContext,
} from "@agent-native/core/server";
import {
  resolveWorkspaceConnectionsForApp,
  type WorkspaceConnectionForApp,
} from "@agent-native/core/workspace-connections";
import { defineEventHandler, getHeader, getMethod, readBody } from "h3";
import type { H3Event } from "h3";

import {
  getIdentitySsoAppRegistry,
  normalizeIdentityAuthority,
} from "../lib/identity-sso.js";

export const GOOGLE_ACCOUNT_HUB_PATH = "/_agent-native/google-accounts/token";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const REFRESH_TIMEOUT_MS = 10_000;
const PERMANENT_REFRESH_ERRORS = new Set([
  "invalid_grant",
  "unauthorized_client",
  "invalid_client",
]);

/** Providers whose connections share Dispatch's Google token row. */
export const GOOGLE_ACCOUNT_HUB_PROVIDERS = new Set([
  "google_calendar",
  "gmail",
  "google_drive",
  "google_docs",
  "google_sheets",
  "google_slides",
]);

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

function bearerToken(event: H3Event): string | null {
  const authorization = getHeader(event, "authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  return match?.[1] ?? null;
}

/** The registered app that signed this assertion, and the person it names. */
async function verifyAppAssertion(
  event: H3Event,
  token: string,
): Promise<{ appId: string; email: string } | null> {
  for (const registration of getIdentitySsoAppRegistry()) {
    if (!registration.federationSecret) continue;
    const candidate = await verifyA2AToken(token, event, {
      routePrefix: "_agent-native",
      includeClaims: true,
      globalSecretOnly: true,
      verificationSecret: registration.federationSecret,
    });
    const claims = candidate.claims;
    const issuer =
      typeof claims?.iss === "string"
        ? normalizeIdentityAuthority(claims.iss)
        : null;
    if (
      candidate.email &&
      claims?.scope === GOOGLE_ACCOUNT_HUB_SCOPE &&
      claims.app_id === registration.appId &&
      issuer === registration.origin
    ) {
      return {
        appId: registration.appId,
        email: candidate.email.trim().toLowerCase(),
      };
    }
  }
  return null;
}

function splitScopes(value: unknown): string[] {
  return typeof value === "string" ? value.split(/\s+/).filter(Boolean) : [];
}

/**
 * The scopes this app's token may carry: the grant's own list when it has
 * one, else the provider's, kept to what the stored Google token was granted.
 */
function scopesForApp(
  provider: string,
  connection: WorkspaceConnectionForApp,
  grantedOnToken: string[],
): string[] {
  const providerScopes =
    getWorkspaceConnectionProvider(provider)?.oauth?.scopes ?? [];
  const grantScopes = connection.explicitGrant?.scopes ?? [];
  const wanted = grantScopes.length > 0 ? grantScopes : [...providerScopes];
  if (grantedOnToken.length === 0) return wanted;
  const granted = new Set(grantedOnToken);
  return wanted.filter((scope) => granted.has(scope));
}

type MintResult =
  | { ok: true; accessToken: string; expiresIn: number; scope: string }
  | { ok: false; error: string; needsReconnect: boolean };

async function mintScopedAccessToken(
  refreshToken: string,
  scopes: string[],
): Promise<MintResult> {
  const candidates = await resolveGoogleProviderCredentialCandidatesWithReader({
    readCredential: resolveSecret,
    fallbackReadCredential: (key) => process.env[key],
  });
  if (!candidates.length) {
    return {
      ok: false,
      error: "Dispatch has no Google OAuth client.",
      needsReconnect: false,
    };
  }
  let lastError = "refresh_failed";
  for (const credentials of candidates) {
    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        // Google narrows a refreshed access token to a subset of the scopes
        // the refresh token holds.
        scope: scopes.join(" "),
      }),
      signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
    });
    const data = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (response.ok && typeof data.access_token === "string") {
      return {
        ok: true,
        accessToken: data.access_token,
        expiresIn: typeof data.expires_in === "number" ? data.expires_in : 3600,
        scope: typeof data.scope === "string" ? data.scope : scopes.join(" "),
      };
    }
    lastError = typeof data.error === "string" ? data.error : lastError;
    // Another client may own this token; anything else won't change by
    // trying the next one.
    if (!PERMANENT_REFRESH_ERRORS.has(lastError)) break;
  }
  return {
    ok: false,
    error: lastError,
    needsReconnect: PERMANENT_REFRESH_ERRORS.has(lastError),
  };
}

export const googleAccountHubHandler = defineEventHandler(
  async (event: H3Event): Promise<Response> => {
    if (getMethod(event) !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }
    const token = bearerToken(event);
    if (!token) return jsonResponse({ error: "Unauthorized" }, 401);
    const caller = await verifyAppAssertion(event, token);
    if (!caller) return jsonResponse({ error: "Unauthorized" }, 401);

    const body = ((await readBody(event).catch(() => null)) ?? {}) as Record<
      string,
      unknown
    >;
    const provider = typeof body.provider === "string" ? body.provider : "";
    if (!GOOGLE_ACCOUNT_HUB_PROVIDERS.has(provider)) {
      return jsonResponse({ error: "Unsupported provider" }, 400);
    }

    const orgId = (await resolveOrgIdForEmail(caller.email)) ?? undefined;
    const connections = await runWithRequestContext(
      { userEmail: caller.email, ...(orgId ? { orgId } : {}) },
      () =>
        resolveWorkspaceConnectionsForApp({ appId: caller.appId, provider }),
    );

    const accounts: Array<Record<string, unknown>> = [];
    const errors: Array<Record<string, unknown>> = [];
    for (const connection of connections) {
      const accountEmail = connection.accountId?.trim();
      if (connection.status !== "connected" || !accountEmail) continue;
      const stored = await getOAuthTokens(
        "google",
        accountEmail,
        connection.ownerEmail,
      );
      const refreshToken =
        typeof stored?.refresh_token === "string" ? stored.refresh_token : "";
      if (!refreshToken) {
        errors.push({
          account_email: accountEmail,
          connection_id: connection.id,
          error: "no_refresh_token",
          needs_reconnect: true,
        });
        continue;
      }
      const scopes = scopesForApp(
        provider,
        connection,
        splitScopes(stored?.scope),
      );
      if (scopes.length === 0) {
        errors.push({
          account_email: accountEmail,
          connection_id: connection.id,
          error: "missing_scopes",
          needs_reconnect: true,
        });
        continue;
      }
      const minted = await runWithRequestContext(
        { userEmail: connection.ownerEmail, ...(orgId ? { orgId } : {}) },
        () => mintScopedAccessToken(refreshToken, scopes),
      );
      if (!minted.ok) {
        errors.push({
          account_email: accountEmail,
          connection_id: connection.id,
          error: minted.error,
          needs_reconnect: minted.needsReconnect,
        });
        continue;
      }
      accounts.push({
        account_email: accountEmail,
        connection_id: connection.id,
        access_token: minted.accessToken,
        expires_in: minted.expiresIn,
        scope: minted.scope,
      });
    }

    return jsonResponse({ accounts, errors }, 200);
  },
);

export default async (nitroApp: any) => {
  getH3App(nitroApp).use(GOOGLE_ACCOUNT_HUB_PATH, googleAccountHubHandler);
};
