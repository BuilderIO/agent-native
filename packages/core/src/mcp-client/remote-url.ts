/** URL validation shared by remote MCP storage and OAuth discovery. */

const BLOCKED_HOSTNAME_PATTERNS: RegExp[] = [
  /^localhost$/i,
  /\.localhost$/i,
  /\.local$/i,
  /\.internal$/i,
  /\.nip\.io$/i,
  /\.sslip\.io$/i,
  /\.xip\.io$/i,
  /\.localtest\.me$/i,
  /\.lvh\.me$/i,
  /^metadata\.google\.internal$/i,
  /^instance-data$/i,
];

const BLOCKED_IPS = new Set(["169.254.169.254", "100.100.100.200", "::1"]);

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    const byte = parseInt(part, 10);
    if (isNaN(byte) || byte < 0 || byte > 255) return null;
    n = (n << 8) | byte;
  }
  return n >>> 0;
}

function isPrivateIpv4(hostname: string): boolean {
  const n = ipv4ToInt(hostname);
  if (n === null) return false;
  if ((n & 0xff000000) >>> 0 === 0x0a000000) return true;
  if ((n & 0xfff00000) >>> 0 === 0xac100000) return true;
  if ((n & 0xffff0000) >>> 0 === 0xc0a80000) return true;
  if ((n & 0xffff0000) >>> 0 === 0xa9fe0000) return true;
  if ((n & 0xff000000) >>> 0 === 0x7f000000) return true;
  return false;
}

function isBlockedHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (BLOCKED_IPS.has(normalized)) return true;
  if (isPrivateIpv4(normalized)) return true;
  if (normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (normalized.startsWith("fe80")) return true;
  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice("::ffff:".length);
    if (isPrivateIpv4(mapped)) return true;
    const hexMatch = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(mapped);
    if (hexMatch) {
      const value =
        (parseInt(hexMatch[1], 16) << 16) | parseInt(hexMatch[2], 16);
      const dotted = [
        (value >>> 24) & 0xff,
        (value >>> 16) & 0xff,
        (value >>> 8) & 0xff,
        value & 0xff,
      ].join(".");
      if (isPrivateIpv4(dotted)) return true;
    }
  }
  return BLOCKED_HOSTNAME_PATTERNS.some((pattern) => pattern.test(normalized));
}

/** Reject public-resource URLs that could target an internal network. */
export function validateRemoteUrl(raw: string): {
  ok: boolean;
  url?: URL;
  error?: string;
} {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: "Not a valid URL" };
  }
  if (url.protocol === "https:") {
    if (isBlockedHostname(url.hostname)) {
      return {
        ok: false,
        error: `Host "${url.hostname}" is not allowed (private/internal address)`,
      };
    }
    return { ok: true, url };
  }
  if (url.protocol === "http:") {
    const host = url.hostname;
    if (host === "localhost" || host === "127.0.0.1") {
      return { ok: true, url };
    }
    return { ok: false, error: "Plain http is only allowed for localhost" };
  }
  return { ok: false, error: `Unsupported protocol: ${url.protocol}` };
}
