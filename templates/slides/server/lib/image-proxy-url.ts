import { lookup } from "node:dns/promises";
import net from "node:net";

/**
 * Hostnames that never belong to a legitimate slide image but are classic
 * SSRF targets. Cloud metadata endpoints resolve to a link-local address
 * that `isPrivateAddress` already rejects; they are listed here so the
 * request is refused before a DNS query is issued.
 */
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata",
]);

const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa"];

/** Largest image we are willing to buffer and hand back to the browser. */
export const MAX_PROXIED_IMAGE_BYTES = 15 * 1024 * 1024;

/** Redirect hops to follow. Each hop is re-validated before it is fetched. */
export const MAX_PROXY_REDIRECTS = 3;

/**
 * Whether an IP literal points somewhere inside our own infrastructure.
 * Anything unroutable, loopback, link-local, or RFC1918 is refused, as is
 * any address we cannot parse — unknown means unsafe here.
 */
export function isPrivateAddress(address: string): boolean {
  const version = net.isIP(address);

  if (version === 4) {
    const parts = address.split(".").map((part) => Number(part));
    if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
      return true;
    }
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }

  if (version === 6) {
    const addr = address.toLowerCase();
    if (addr === "::" || addr === "::1") return true;
    // Unique-local (fc00::/7) and link-local (fe80::/10).
    if (/^f[cd]/.test(addr) || addr.startsWith("fe8") || addr.startsWith("fe9"))
      return true;
    if (addr.startsWith("fea") || addr.startsWith("feb")) return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(addr);
    if (mapped) return isPrivateAddress(mapped[1]);
    return false;
  }

  return true;
}

/**
 * Parse a caller-supplied image URL, refusing anything that is not a plain
 * public http(s) resource. Returns null rather than throwing so callers can
 * answer with a single 400.
 */
export function parseProxyableImageUrl(raw: string): URL | null {
  if (!raw) return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // coercion-ok: null is this function's documented "refused" result and
    // the caller answers 400; an unparseable URL carries no other detail.
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  // Credentials in the URL would be replayed by the server on the user's
  // behalf against a host they may not control.
  if (url.username || url.password) return null;

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return null;
  if (BLOCKED_HOSTNAMES.has(host)) return null;
  if (BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) return null;

  const literal = host.startsWith("[") ? host.slice(1, -1) : host;
  if (net.isIP(literal) && isPrivateAddress(literal)) return null;

  return url;
}

/**
 * Resolve the hostname and confirm every address it maps to is public.
 * `parseProxyableImageUrl` alone cannot catch a public name that resolves to
 * 169.254.169.254, which is the usual way SSRF filters get bypassed.
 */
export async function resolvesToPublicAddress(
  hostname: string,
): Promise<boolean> {
  const literal = hostname.startsWith("[")
    ? hostname.slice(1, -1)
    : hostname.toLowerCase().replace(/\.$/, "");

  if (net.isIP(literal)) return !isPrivateAddress(literal);

  try {
    const records = await lookup(literal, { all: true });
    if (records.length === 0) return false;
    return records.every((record) => !isPrivateAddress(record.address));
  } catch {
    // coercion-ok: fail closed. A hostname we cannot resolve is one we cannot
    // prove is public, so it must be refused rather than fetched.
    return false;
  }
}
