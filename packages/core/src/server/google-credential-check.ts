import {
  describeGoogleSignInCredentialPairs,
  getActiveGoogleSignInCredentials,
  resolveGoogleSignInCredentials,
} from "./google-oauth-credentials.js";

const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

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
  /** Google accepted the client id and secret. */
  | "valid"
  /** Google rejected the client id or secret — sign-in is broken. */
  | "invalid"
  /** No sign-in credentials are configured on this deploy. */
  | "unconfigured"
  /** Google could not be reached, or answered something unrecognised. */
  | "unknown";

export interface GoogleCredentialCheck {
  status: GoogleCredentialStatus;
  clientId: string | null;
  /** Both credential pairs are set to different Google clients. */
  mismatchedPairs: boolean;
  /**
   * Where the probed pair came from. `active` is the pair Better Auth wired to
   * the provider; `preferred` means auth had not initialised yet and this fell
   * back to the preferred pair, which a scoped template may not use.
   */
  credentialSource: "active" | "preferred";
  /** Google's `error` field, or the transport failure, when there was one. */
  reason: string | null;
  checkedAt: number;
}

let cached: { value: GoogleCredentialCheck; expiresAt: number } | null = null;

/** Test seam: drop the memoised result. */
export function resetGoogleCredentialCheckCache(): void {
  cached = null;
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
    // Unreachable is not the same as wrong. Reporting "valid" here would
    // recreate the exact blind spot this check exists to remove.
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

/**
 * Ask Google whether this deploy's sign-in credentials still authenticate.
 *
 * The app's own callback collapses every Google failure into one error page,
 * so a wrong secret is invisible from outside. This is the signal a monitor
 * can read: it needs no browser, no consent grant, and no access to the secret
 * beyond the process that already holds it.
 */
export async function checkGoogleSignInCredential(options?: {
  ttlMs?: number;
  now?: () => number;
}): Promise<GoogleCredentialCheck> {
  const now = options?.now ?? Date.now;
  const ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;
  const at = now();
  if (cached && cached.expiresAt > at) return cached.value;

  const pairs = describeGoogleSignInCredentialPairs();
  // Prefer what Better Auth actually wired up. A template requesting broader
  // scopes runs on GOOGLE_CLIENT_*, so re-deriving the preferred pair here
  // would test a credential the callback never touches.
  const active = getActiveGoogleSignInCredentials();
  const credentials = active.recorded
    ? active.credentials
    : resolveGoogleSignInCredentials();
  const credentialSource: "active" | "preferred" = active.recorded
    ? "active"
    : "preferred";

  const value: GoogleCredentialCheck = credentials
    ? {
        ...(await probeGoogle(credentials.clientId, credentials.clientSecret)),
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
        checkedAt: at,
      };

  // Only memoise answers Google actually gave. Caching a transport failure for
  // five minutes would hide a recovery for five minutes.
  if (value.status !== "unknown") {
    cached = { value, expiresAt: at + ttlMs };
  }
  return value;
}
