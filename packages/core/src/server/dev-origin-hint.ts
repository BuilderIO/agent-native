import { getHeader } from "h3";
import type { H3Event } from "h3";

/**
 * Dev-only one-line diagnostic for an unauthenticated loopback
 * `/_agent-native/*` request. Session cookies are host-scoped (RFC 6265):
 * `localhost:PORT` and `127.0.0.1:PORT` are different cookie jars to the
 * browser, so a session established on the origin the dev server prints never
 * reaches the other loopback label and every framework call 401s silently.
 *
 * The hint names the label the visitor actually used versus the canonical
 * origin recorded from Vite's printed URL. It must stay one line and never carry
 * session tokens or user data: the caller gates it on `isDevEnvironment()`
 * and `isLoopbackRequest(event)`, so production and remote hosts keep the
 * bare 401.
 */
export function devLoopbackAuthHint(
  event: H3Event,
  canonicalOrigin: string | undefined,
): string {
  const hostHeader = getHeader(event, "host") ?? "";
  let resolvedCanonicalOrigin: string | null = null;
  try {
    const candidate = new URL(canonicalOrigin ?? "");
    if (
      (candidate.protocol === "http:" || candidate.protocol === "https:") &&
      (candidate.hostname === "localhost" ||
        candidate.hostname === "127.0.0.1" ||
        candidate.hostname === "[::1]") &&
      candidate.pathname === "/" &&
      !candidate.search &&
      !candidate.hash
    ) {
      resolvedCanonicalOrigin = candidate.origin;
    }
  } catch {
    resolvedCanonicalOrigin = null;
  }

  const forwardedProto = getHeader(event, "x-forwarded-proto")
    ?.split(",")[0]
    ?.trim()
    .toLowerCase();
  const proto =
    forwardedProto === "http" || forwardedProto === "https"
      ? forwardedProto
      : resolvedCanonicalOrigin
        ? new URL(resolvedCanonicalOrigin).protocol.slice(0, -1)
        : "http";
  let visitingOrigin: string | null = null;
  try {
    visitingOrigin = new URL(`${proto}://${hostHeader}`).origin;
  } catch {
    visitingOrigin = null;
  }

  if (!visitingOrigin || !resolvedCanonicalOrigin) {
    return "No valid session cookie reached this dev server; sign in again on the origin the dev server printed.";
  }

  if (visitingOrigin === resolvedCanonicalOrigin) {
    return `No valid session cookie reached the dev server at ${visitingOrigin}; sign in again on this origin.`;
  }

  return `You are visiting ${visitingOrigin}, which has its own cookie jar; this dev server's canonical origin is ${resolvedCanonicalOrigin}, so sign in or re-open the app there.`;
}
