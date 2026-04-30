const METADATA_HOSTS = [
  "metadata.google.internal",
  "metadata.google.internal.",
];

const DNS_REBIND_SUFFIXES = [
  ".nip.io",
  ".sslip.io",
  ".xip.io",
  ".localtest.me",
  ".lvh.me",
];

function isPrivateIpv4(a: number, b: number, c = 0, d = 0): boolean {
  if (![a, b, c, d].every((part) => part >= 0 && part <= 255)) return true;
  if (a === 127) return true;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 0) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 192 && b === 0) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 192 && b === 0 && c === 2) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateIpv4MappedHex(host: string): boolean {
  const mapped = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (!mapped) return false;
  const high = Number.parseInt(mapped[1], 16);
  const low = Number.parseInt(mapped[2], 16);
  if (high < 0 || high > 0xffff || low < 0 || low > 0xffff) return false;
  const a = (high >> 8) & 0xff;
  const b = high & 0xff;
  const c = (low >> 8) & 0xff;
  const d = low & 0xff;
  return isPrivateIpv4(a, b, c, d);
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host === "::1" ||
    host === "::0" ||
    host === "::"
  ) {
    return true;
  }
  if (METADATA_HOSTS.includes(host)) return true;

  // IPv6 ULA/link-local/multicast.
  if (/^f[cd]/.test(host) || /^fe[89ab]/.test(host)) return true;
  if (/^ff/i.test(host)) return true;

  // IPv4-mapped IPv6. URL parsing may preserve dotted form in some runtimes
  // or normalize it to hex, e.g. [::ffff:127.0.0.1] -> ::ffff:7f00:1.
  const v4mappedDotted = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4mappedDotted) {
    const [a, b, c, d] = v4mappedDotted[1].split(".").map(Number);
    if (isPrivateIpv4(a, b, c, d)) return true;
  }
  if (isPrivateIpv4MappedHex(host)) return true;

  // Dotted IPv4. URL parsing normalizes shorthand/octal/hex IPv4 forms to
  // dotted decimal before we reach this point.
  const parts = host.split(".");
  if (parts.length === 4 && parts.every((p) => /^\d+$/.test(p))) {
    const [a, b, c, d] = parts.map(Number);
    if (isPrivateIpv4(a, b, c, d)) return true;
  }

  // Decimal integer IPv4.
  if (/^\d+$/.test(host)) {
    const num = Number(host);
    if (num >= 0 && num <= 0xffffffff) {
      const a = (num >>> 24) & 0xff;
      const b = (num >>> 16) & 0xff;
      const c = (num >>> 8) & 0xff;
      const d = num & 0xff;
      if (isPrivateIpv4(a, b, c, d)) return true;
    }
  }

  return false;
}

export function isBlockedToolUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return true;
    }
    const host = parsed.hostname.toLowerCase();
    if (isPrivateHost(host)) return true;
    if (
      DNS_REBIND_SUFFIXES.some((suffix) => {
        const bare = suffix.slice(1);
        return host === bare || host.endsWith(suffix);
      })
    ) {
      return true;
    }
  } catch {
    return true;
  }
  return false;
}

function isIpLiteralHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host.includes(":")) return true;
  const parts = host.split(".");
  return parts.length === 4 && parts.every((p) => /^\d+$/.test(p));
}

/**
 * Async SSRF guard for environments that can resolve DNS. The synchronous
 * guard catches literals and known rebinding domains; this closes the common
 * "public hostname resolves to a private address" gap before dispatch.
 */
export async function isBlockedToolUrlWithDns(url: string): Promise<boolean> {
  if (isBlockedToolUrl(url)) return true;

  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return true;
  }
  if (!hostname || isIpLiteralHost(hostname)) return false;

  try {
    const { lookup } = await import("node:dns/promises");
    const records = await lookup(hostname, { all: true, verbatim: true });
    return records.some((record) => isPrivateHost(record.address));
  } catch {
    // Some edge runtimes do not expose DNS lookup. Keep the deterministic
    // parser-based protections instead of failing every outbound request.
    return false;
  }
}
