import { getHeader, getRequestIP } from "h3";
import type { H3Event } from "h3";

/**
 * Best-effort client address for rate-limit keys. Edge headers win, then the
 * first `X-Forwarded-For` hop, then the socket peer. Every one of them is
 * client-controlled off a trusted edge, so never use this to grant access.
 */
export function getClientIp(event: H3Event): string | undefined {
  const trusted =
    getHeader(event, "x-nf-client-connection-ip") ??
    getHeader(event, "cf-connecting-ip") ??
    getHeader(event, "true-client-ip") ??
    getHeader(event, "x-real-ip");
  if (trusted && trusted.trim()) return trusted.trim();

  const forwardedFor = getHeader(event, "x-forwarded-for");
  const forwardedClientIp = forwardedFor?.split(",")[0]?.trim();
  if (forwardedClientIp) return forwardedClientIp;

  try {
    return getRequestIP(event) ?? undefined;
    // coercion-ok: an unreadable peer address joins the shared unknown rate-limit bucket; it never grants access.
  } catch {
    return undefined;
  }
}
