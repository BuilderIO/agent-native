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

function isPrivateIpv4(a: number, b: number): boolean {
  if (a === 127) return true;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 0) return true;
  return false;
}

function isPrivateIpv4MappedHex(host: string): boolean {
  const mapped = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (!mapped) return false;
  const high = Number.parseInt(mapped[1], 16);
  const low = Number.parseInt(mapped[2], 16);
  if (!Number.isFinite(high) || !Number.isFinite(low)) return false;
  const a = (high >> 8) & 0xff;
  const b = high & 0xff;
  return isPrivateIpv4(a, b);
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

  // IPv6 ULA/link-local.
  if (/^f[cd]/.test(host) || /^fe[89ab]/.test(host)) return true;

  // IPv4-mapped IPv6. URL parsing may preserve dotted form in some runtimes
  // or normalize it to hex, e.g. [::ffff:127.0.0.1] -> ::ffff:7f00:1.
  const v4mappedDotted = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4mappedDotted) {
    const [a, b] = v4mappedDotted[1].split(".").map(Number);
    if (isPrivateIpv4(a, b)) return true;
  }
  if (isPrivateIpv4MappedHex(host)) return true;

  // Dotted IPv4. URL parsing normalizes shorthand/octal/hex IPv4 forms to
  // dotted decimal before we reach this point.
  const parts = host.split(".");
  if (parts.length === 4 && parts.every((p) => /^\d+$/.test(p))) {
    const [a, b] = parts.map(Number);
    if (isPrivateIpv4(a, b)) return true;
  }

  // Decimal integer IPv4.
  if (/^\d+$/.test(host)) {
    const num = Number(host);
    if (num >= 0 && num <= 0xffffffff) {
      const a = (num >>> 24) & 0xff;
      const b = (num >>> 16) & 0xff;
      if (isPrivateIpv4(a, b)) return true;
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
