const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const PROBE_TIMEOUT_MS = 2_500;
const CACHE_TTL_MS = 10 * 60 * 1_000;

/**
 * Google rejects a misconfigured authorization request before it ever shows a
 * consent screen, so the browser lands on an error page instead of the deck it
 * came from. These are the rejections an operator can actually act on; anything
 * else is reported as `unknown` rather than guessed at.
 */
const REJECTION_CODES = [
  "redirect_uri_mismatch",
  "invalid_client",
  "deleted_client",
  "invalid_request",
  "unauthorized_client",
  "org_internal",
  "admin_policy_enforced",
  "access_denied",
] as const;

export type GoogleOAuthRejectionCode = (typeof REJECTION_CODES)[number];

export type GoogleOAuthPreflight =
  /** Google accepted the authorization request and would show a consent screen. */
  | { status: "ok" }
  /** Google refused the request itself — no user can complete this flow. */
  | { status: "rejected"; code: GoogleOAuthRejectionCode | "unrecognized" }
  /**
   * The probe could not reach a verdict. Distinct from `ok` on purpose: callers
   * must not present an unverified flow as a verified-working one, and must not
   * disable a working export just because the probe was blocked.
   */
  | { status: "unknown"; reason: string };

interface CacheEntry {
  expiresAt: number;
  value: GoogleOAuthPreflight;
}

const cache = new Map<string, CacheEntry>();

/** Exposed for tests; production callers rely on the TTL. */
export function clearGoogleOAuthPreflightCache(): void {
  cache.clear();
}

function decodeAuthError(authError: string): string | null {
  // The payload is a protobuf blob whose first field is the error code; the
  // code is the only ASCII run before the human-readable description.
  const decoded = Buffer.from(authError, "base64").toString("utf8");
  return decoded.match(/[a-z][a-z0-9_]{4,}/)?.[0] ?? null;
}

function classifyLocation(location: string): GoogleOAuthPreflight {
  let url: URL;
  try {
    url = new URL(location, AUTHORIZE_URL);
  } catch {
    return { status: "unknown", reason: "unparsable-redirect" };
  }
  if (!url.pathname.includes("/signin/oauth/error")) return { status: "ok" };

  const authError = url.searchParams.get("authError");
  const code = authError ? decodeAuthError(authError) : null;
  if (!code) return { status: "rejected", code: "unrecognized" };
  return {
    status: "rejected",
    code: (REJECTION_CODES as readonly string[]).includes(code)
      ? (code as GoogleOAuthRejectionCode)
      : "unrecognized",
  };
}

async function probe(
  clientId: string,
  redirectUri: string,
  scopes: readonly string[],
): Promise<GoogleOAuthPreflight> {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: scopes.join(" "),
  });
  let response: Response;
  try {
    response = await fetch(`${AUTHORIZE_URL}?${params.toString()}`, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  } catch (error) {
    return {
      status: "unknown",
      reason: error instanceof Error ? error.name : "probe-failed",
    };
  }

  const location = response.headers.get("location");
  if (!location) {
    return { status: "unknown", reason: `no-redirect-http-${response.status}` };
  }
  return classifyLocation(location);
}

/**
 * Asks Google whether it would accept this app's authorization request, without
 * a user session. A `redirect_uri` that is not registered in the Google Cloud
 * Console is only detectable here: the flow starts as a top-level navigation, so
 * the failure happens on Google's domain where the app can never observe it.
 *
 * Cached per client/redirect/scope so a broken deployment costs one outbound
 * request per TTL rather than one per page load.
 */
export async function checkGoogleOAuthPreflight(input: {
  clientId: string;
  redirectUri: string;
  scopes: readonly string[];
}): Promise<GoogleOAuthPreflight> {
  const key = `${input.clientId}|${input.redirectUri}|${input.scopes.join(" ")}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const value = await probe(input.clientId, input.redirectUri, input.scopes);
  // An inconclusive probe is not worth a full TTL of stickiness, but retrying it
  // on every request would put a Google round trip on the editor's load path.
  const ttl = value.status === "unknown" ? 30_000 : CACHE_TTL_MS;
  cache.set(key, { expiresAt: Date.now() + ttl, value });
  return value;
}
