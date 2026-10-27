import { resolveSecretPair } from "./credential-provider.js";
import {
  describeGoogleSignInCredentialPairs,
  getActiveGoogleSignInCredentials,
  resolveGoogleSignInCredentials,
} from "./google-oauth-credentials.js";

const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_AUTHORIZE_ENDPOINT =
  "https://accounts.google.com/o/oauth2/v2/auth";

/**
 * Google authenticates the client before it looks at the code, so a
 * deliberately invalid code separates the two failures: `invalid_client` means
 * the secret is wrong, `invalid_grant` means the secret authenticated and only
 * the code was rejected. The redirect_uri is never reached and is a constant.
 */
const PROBE_CODE = "agent-native-credential-probe";
const PROBE_REDIRECT_URI = "https://example.com/agent-native-credential-probe";

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;

export type GoogleCredentialStatus =
  | "valid"
  /** Google rejected the client id or secret — sign-in is broken. */
  | "invalid"
  /** No credentials are configured for the requested Google client. */
  | "unconfigured"
  /** Google could not be reached, or answered something unrecognised. */
  | "unknown";

export type GoogleRedirectUriStatus =
  | "registered"
  /** Google's authorize endpoint reported redirect_uri_mismatch. */
  | "mismatched"
  /** No redirect URI was probed, or the response couldn't be classified —
   *  never coerced to "registered". */
  | "unknown";

export interface GoogleCredentialCheck {
  status: GoogleCredentialStatus;
  clientId: string | null;
  mismatchedPairs: boolean;
  credentialSource: "active" | "preferred" | "managed" | "user" | "none";
  reason: string | null;
  /** Whether Google recognizes `redirectUri` as registered for `clientId`.
   *  Structurally cannot detect this from the token-exchange probe above —
   *  see `probeGoogleRedirectUri`. */
  redirectUriStatus: GoogleRedirectUriStatus;
  redirectUri: string | null;
  checkedAt: number;
}

let cached: {
  value: GoogleCredentialCheck;
  expiresAt: number;
  activeCredentialsVersion: number;
  redirectUri: string | undefined;
} | null = null;
let managedCached: {
  value: GoogleCredentialCheck;
  expiresAt: number;
  redirectUri: string | undefined;
} | null = null;
let managedInFlight: Promise<GoogleCredentialCheck> | null = null;

export function resetGoogleCredentialCheckCache(): void {
  cached = null;
  managedCached = null;
  managedInFlight = null;
}

async function probeGoogle(
  clientId: string,
  clientSecret: string,
): Promise<{ status: GoogleCredentialStatus; reason: string | null }> {
  let response: Response;
  try {
    response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: PROBE_CODE,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: PROBE_REDIRECT_URI,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    return {
      status: "unknown",
      reason: error instanceof Error ? error.message : "fetch failed",
    };
  }

  let error: string | null = null;
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body?.error === "string") error = body.error;
  } catch {
    error = null;
  }

  if (error === "invalid_grant") return { status: "valid", reason: error };
  if (error === "invalid_client") return { status: "invalid", reason: error };
  if (response.ok) {
    // A probe code must never mint a token. Something is not the API we think.
    return { status: "unknown", reason: "unexpected token grant" };
  }
  return { status: "unknown", reason: error ?? `http ${response.status}` };
}

function decodeGoogleAuthErrorParam(location: string): string | null {
  try {
    const authError = new URL(location).searchParams.get("authError");
    if (!authError) return null;
    return Buffer.from(authError, "base64url").toString("utf-8");
  } catch {
    // coercion-ok: the decoded text only decorates `detail`; the mismatch
    // verdict comes from the Location path, so an undecodable blob is "no
    // detail", not a hidden failure.
    return null;
  }
}

/**
 * Ask Google's authorization endpoint whether `redirectUri` is registered for
 * `clientId`, without ever completing a sign-in.
 *
 * The token-exchange probe above (`probeGoogle`) uses a constant fake
 * redirect_uri and so structurally cannot see `redirect_uri_mismatch` — the
 * single most common real Google OAuth failure. Google validates redirect_uri
 * at the authorize step and answers via a 302 `Location`, which this reads
 * with `redirect: "manual"` so the redirect is never followed.
 */
export async function probeGoogleRedirectUri(
  clientId: string,
  redirectUri: string,
): Promise<{ status: GoogleRedirectUriStatus; detail: string | null }> {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid",
  });
  let response: Response;
  try {
    response = await fetch(`${GOOGLE_AUTHORIZE_ENDPOINT}?${params}`, {
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    return {
      status: "unknown",
      detail: error instanceof Error ? error.message : "fetch failed",
    };
  }

  const location = response.headers.get("location") ?? "";
  if (location.includes("/signin/oauth/error")) {
    return {
      status: "mismatched",
      detail: decodeGoogleAuthErrorParam(location) ?? location,
    };
  }
  if (
    location.includes("/v3/signin/identifier") ||
    location.includes("/signin/oauth/consent") ||
    location.includes("/o/oauth2/auth/identifier")
  ) {
    return { status: "registered", detail: null };
  }
  return {
    status: "unknown",
    detail: location
      ? `unrecognized redirect: ${location}`
      : `http ${response.status}`,
  };
}

async function probeRedirectUriIfRequested(
  clientId: string,
  redirectUri: string | undefined,
): Promise<{
  redirectUriStatus: GoogleRedirectUriStatus;
  redirectUri: string | null;
}> {
  if (!redirectUri) return { redirectUriStatus: "unknown", redirectUri: null };
  const probe = await probeGoogleRedirectUri(clientId, redirectUri);
  return { redirectUriStatus: probe.status, redirectUri };
}

export async function checkGoogleSignInCredential(options?: {
  ttlMs?: number;
  now?: () => number;
  redirectUri?: string;
}): Promise<GoogleCredentialCheck> {
  const now = options?.now ?? Date.now;
  const ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;
  const at = now();
  // Prefer what Better Auth actually wired up. A template requesting broader
  // scopes runs on GOOGLE_CLIENT_*, so re-deriving the preferred pair here
  // would test a credential the callback never touches.
  const active = getActiveGoogleSignInCredentials();
  if (
    cached &&
    cached.expiresAt > at &&
    cached.activeCredentialsVersion === active.version &&
    cached.redirectUri === options?.redirectUri
  ) {
    return cached.value;
  }

  const pairs = describeGoogleSignInCredentialPairs();
  const credentials = active.recorded
    ? active.credentials
    : resolveGoogleSignInCredentials();
  const credentialSource: "active" | "preferred" = active.recorded
    ? "active"
    : "preferred";

  const value: GoogleCredentialCheck = credentials
    ? {
        ...(await Promise.all([
          probeGoogle(credentials.clientId, credentials.clientSecret),
          probeRedirectUriIfRequested(
            credentials.clientId,
            options?.redirectUri,
          ),
        ]).then(([tokenProbe, redirectProbe]) => ({
          ...tokenProbe,
          ...redirectProbe,
        }))),
        clientId: credentials.clientId,
        mismatchedPairs: pairs.mismatched,
        credentialSource,
        checkedAt: at,
      }
    : {
        status: "unconfigured",
        clientId: null,
        mismatchedPairs: pairs.mismatched,
        credentialSource,
        reason: null,
        redirectUriStatus: "unknown",
        redirectUri: options?.redirectUri ?? null,
        checkedAt: at,
      };

  if (value.status !== "unknown") {
    cached = {
      value,
      expiresAt: at + ttlMs,
      activeCredentialsVersion: active.version,
      redirectUri: options?.redirectUri,
    };
  }
  return value;
}

async function checkGoogleManagedCredentialOnce(
  redirectUri: string | undefined,
): Promise<GoogleCredentialCheck> {
  const checkedAt = Date.now();
  let credentials: [string, string] | null;
  try {
    credentials = await resolveSecretPair([
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
    ]);
  } catch {
    return {
      status: "unknown",
      clientId: null,
      mismatchedPairs: false,
      credentialSource: "managed",
      reason: "credential lookup failed",
      redirectUriStatus: "unknown",
      redirectUri: redirectUri ?? null,
      checkedAt,
    };
  }
  if (!credentials) {
    return {
      status: "unconfigured",
      clientId: null,
      mismatchedPairs: false,
      credentialSource: "managed",
      reason: null,
      redirectUriStatus: "unknown",
      redirectUri: redirectUri ?? null,
      checkedAt,
    };
  }
  const [clientId, clientSecret] = credentials;
  return {
    ...(await Promise.all([
      probeGoogle(clientId, clientSecret),
      probeRedirectUriIfRequested(clientId, redirectUri),
    ]).then(([tokenProbe, redirectProbe]) => ({
      ...tokenProbe,
      ...redirectProbe,
    }))),
    clientId,
    mismatchedPairs: false,
    credentialSource: "managed",
    checkedAt,
  };
}

export async function checkGoogleManagedCredential(options?: {
  redirectUri?: string;
}): Promise<GoogleCredentialCheck> {
  const at = Date.now();
  if (
    managedCached &&
    managedCached.expiresAt > at &&
    managedCached.redirectUri === options?.redirectUri
  ) {
    return managedCached.value;
  }
  if (managedInFlight) return managedInFlight;

  const inFlight = checkGoogleManagedCredentialOnce(options?.redirectUri);
  managedInFlight = inFlight;
  try {
    const value = await inFlight;
    if (value.status !== "unknown") {
      managedCached = {
        value,
        expiresAt: at + DEFAULT_TTL_MS,
        redirectUri: options?.redirectUri,
      };
    }
    return value;
  } finally {
    if (managedInFlight === inFlight) managedInFlight = null;
  }
}
