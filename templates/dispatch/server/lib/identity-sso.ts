/**
 * Identity-authority logic for "Sign in with Agent-Native".
 *
 * Dispatch is the canonical identity authority. A first-party client app
 * (mail, calendar, analytics, …) bounces an unauthenticated visitor to
 * Dispatch's `/_agent-native/identity/authorize`. Dispatch reuses its EXISTING
 * Better Auth session + login flow, then mints a short-lived signed identity
 * JWT (the existing A2A signer) and 302s back to the client's `redirect_uri`
 * with the token + the caller's untouched `state`.
 *
 * This module holds the pure, side-effect-free pieces so they can be unit
 * tested in isolation:
 *   - `isAllowedRedirectUri`  — the single most important security control.
 *   - `buildIdentityClaims`   — the exact JWT claim set + TTL.
 *   - `buildRedirectLocation` — where the token + state land on the redirect.
 *
 * The HTTP wiring (session resolution, login bounce, signing) lives in
 * `server/plugins/identity-sso.ts` so this file stays trivially testable with
 * no Nitro / crypto / DB dependencies.
 */

import { randomUUID } from "node:crypto";

// Control-char guard (NUL..US + DEL). Defined via codepoints so this source
// file stays plain ASCII (mirrors packages/core/src/server/open-route.ts).
const CONTROL_CHARS = new RegExp("[\\u0000-\\u001f\\u007f]");

/**
 * Identity tokens are auth codes, NOT API tokens. They are exchanged
 * immediately by the client for its own session, so a tight TTL is correct.
 * 5 minutes is the documented upper bound from the build spec; we use 2.
 *
 * NOTE on the type: `signA2AToken` forwards `expiresIn` to
 * `jose.SignJWT.setExpirationTime`. In jose, a NUMBER is interpreted as an
 * ABSOLUTE Unix timestamp (seconds), while a STRING like `"2m"` is parsed
 * as a duration from now. We MUST pass the duration string form, so the
 * canonical constant is the jose duration string; the seconds value is
 * exported alongside it for tests/assertions only.
 */
export const IDENTITY_TOKEN_TTL_SECONDS = 120;
export const IDENTITY_TOKEN_TTL = "2m";

/** JWT `scope` claim marking this as an identity (login) token, not A2A/MCP. */
export const IDENTITY_SCOPE = "identity";

/**
 * Host suffixes that a `redirect_uri` may belong to. This is the core
 * open-redirect / token-theft guard: an attacker-supplied `redirect_uri`
 * pointing anywhere else would exfiltrate the identity token.
 *
 * `.agent-native.com` covers every first-party hosted app
 * (mail.agent-native.com, calendar.agent-native.com, …) — the shared
 * first-party prod-URL registry is exactly the `*.agent-native.com`
 * subdomain space, so a suffix check is both sufficient and the least
 * footgun-prone (no per-app list to keep in sync).
 *
 * These are matched as DOT-prefixed suffixes against the parsed URL
 * hostname, so `agent-native.com.evil.com` does NOT match
 * `.agent-native.com` (it ends in `.evil.com`), and a bare
 * `agent-native.com` apex is intentionally NOT matched (all first-party
 * apps are subdomains; the apex is the marketing site).
 */
export const DEFAULT_ALLOWED_HOST_SUFFIXES: readonly string[] = [
  ".agent-native.com",
];

/** Loopback hosts allowed for local development of the client side. */
const LOCALHOST_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * Read an optional comma-separated extra-host-suffix allowlist from the
 * environment. Used for staging/preview client hosts that are not on
 * `*.agent-native.com`. Each entry is normalised to a lower-case,
 * dot-prefixed suffix so it can only ever broaden by whole-host suffix,
 * never by substring.
 *
 * Deploy-level configuration (not a user credential), so reading it from
 * the environment here is correct and outside the credentials-guard paths.
 */
export function getConfiguredHostSuffixes(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const raw = env.IDENTITY_SSO_ALLOWED_HOST_SUFFIXES;
  if (!raw || typeof raw !== "string") return [];
  return (
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
      .map((s) => (s.startsWith(".") ? s : `.${s}`))
      // Guard against a misconfigured "" / "." that would match everything.
      .filter((s) => s.length > 1 && s !== ".")
  );
}

/**
 * The redirect-URI allowlist. THE critical control on this endpoint.
 *
 * A `redirect_uri` is accepted ONLY when ALL of the following hold:
 *   1. It parses as an absolute URL.
 *   2. Its scheme is exactly `https:`  — EXCEPT loopback dev hosts, where
 *      `http:` is also allowed (TLS is not available on localhost).
 *   3. It has no embedded credentials (`user:pass@host`) — those are an
 *      open-redirect obfuscation vector.
 *   4. Its hostname is either a loopback host, OR ends in one of the
 *      allowed host suffixes (default `.agent-native.com`, plus any
 *      configured via env). The suffix is matched against the FULL parsed
 *      hostname with a leading dot, so `agent-native.com.evil.com` is
 *      rejected (ends in `.evil.com`) and substring spoofs cannot pass.
 *
 * Everything else is rejected. Fragments/queries on the URI are allowed
 * (the client may have its own) — we append our params safely.
 */
export function isAllowedRedirectUri(
  rawRedirectUri: unknown,
  options: { allowedHostSuffixes?: readonly string[] } = {},
): boolean {
  if (typeof rawRedirectUri !== "string" || rawRedirectUri.length === 0) {
    return false;
  }
  // Reject control chars up front (CR/LF header-injection, NUL, etc.).
  if (CONTROL_CHARS.test(rawRedirectUri)) return false;

  let url: URL;
  try {
    url = new URL(rawRedirectUri);
  } catch {
    return false;
  }

  // No embedded credentials — `https://evil@good.agent-native.com` style.
  if (url.username || url.password) return false;

  const hostname = url.hostname.toLowerCase();
  const isLoopback = LOCALHOST_HOSTS.has(hostname);

  // Scheme: https everywhere, http only for loopback dev.
  if (url.protocol === "https:") {
    // ok
  } else if (url.protocol === "http:" && isLoopback) {
    // ok — local dev
  } else {
    return false;
  }

  if (isLoopback) return true;

  const suffixes = [
    ...DEFAULT_ALLOWED_HOST_SUFFIXES,
    ...(options.allowedHostSuffixes ?? getConfiguredHostSuffixes()),
  ];

  // Suffix match against the full hostname, leading-dot anchored so a
  // sibling/parent host can never satisfy a child's suffix:
  //   "mail.agent-native.com".endsWith(".agent-native.com")        -> true
  //   "agent-native.com.evil.com".endsWith(".agent-native.com")    -> false
  //   "evil-agent-native.com".endsWith(".agent-native.com")        -> false
  return suffixes.some((suffix) => hostname.endsWith(suffix));
}

export interface IdentityClaims {
  /** Stable user identifier — the Dispatch account email. */
  sub: string;
  email: string;
  /** Display name when the auth provider supplied one. */
  name?: string;
  /** Resolved org domain when the user has an active org; omitted otherwise. */
  org_domain?: string;
  /** Marks this token as an identity (login) token. */
  scope: typeof IDENTITY_SCOPE;
  /** Random per-token id for replay/debugging. */
  jti: string;
}

/**
 * Build the EXACT claim set for the identity token. No secrets/passwords
 * ever go in here. `sub` and `email` are the same value (the account email)
 * so a verifier can key on either. `org_domain` is included only when known.
 */
export function buildIdentityClaims(input: {
  email: string;
  name?: string | null;
  orgDomain?: string | null;
}): IdentityClaims {
  const claims: IdentityClaims = {
    sub: input.email,
    email: input.email,
    scope: IDENTITY_SCOPE,
    jti: randomUUID(),
  };
  if (input.name && input.name.trim()) claims.name = input.name.trim();
  if (input.orgDomain && input.orgDomain.trim()) {
    claims.org_domain = input.orgDomain.trim();
  }
  return claims;
}

/**
 * Construct the final redirect `Location`: the validated `redirect_uri`
 * with `token` and the caller's untouched `state` appended as QUERY
 * parameters (not the fragment) so a server-side client callback can read
 * them. Preserves any pre-existing query the client put on its
 * `redirect_uri`.
 *
 * The token is placed in `?token=<jwt>` and the opaque caller value in
 * `?state=<state>` — the client MUST echo-check `state` against what it
 * generated before trusting the token.
 *
 * `rawRedirectUri` MUST already have passed `isAllowedRedirectUri`.
 */
export function buildRedirectLocation(
  rawRedirectUri: string,
  token: string,
  state: string | null | undefined,
): string {
  const url = new URL(rawRedirectUri);
  url.searchParams.set("token", token);
  if (typeof state === "string" && state.length > 0) {
    url.searchParams.set("state", state);
  }
  return url.toString();
}
