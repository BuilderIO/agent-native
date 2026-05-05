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

export function isBlockedExtensionUrl(url: string): boolean {
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
export async function isBlockedExtensionUrlWithDns(
  url: string,
): Promise<boolean> {
  if (isBlockedExtensionUrl(url)) return true;

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

/**
 * Build an undici Dispatcher whose connect-time DNS lookup runs through a
 * private-IP guard. This closes the TOCTOU gap where:
 *   1. We resolve hostname → public IP and pass.
 *   2. Between that lookup and the actual connect, DNS rebinding flips the
 *      record to a private IP.
 *   3. fetch() resolves again and connects to the private IP.
 *
 * With a custom dispatcher, the same lookup that produces the IP also gates
 * the connect: if the IP is in the private set, the connect throws.
 *
 * Returns `null` if undici / node:dns are not available (e.g. some edge
 * runtimes); the caller should fall back to the regular `fetch` path —
 * `isBlockedExtensionUrlWithDns` will still have caught most rebinding cases.
 */
export async function createSsrfSafeDispatcher(): Promise<unknown | null> {
  // Dynamic import + `any`: undici is not a direct dependency, so the type
  // declarations may not resolve. The runtime path is still safe — if the
  // import throws we return null and the caller falls back to plain fetch.
  let undici: any;
  let dnsModule: any;
  try {
    undici = await import("undici" as string);
    dnsModule = await import("node:dns");
  } catch {
    return null;
  }

  const { Agent } = undici;
  const { lookup } = dnsModule;
  if (!Agent || !lookup) return null;

  return new Agent({
    connect: {
      // Override DNS lookup at connect time so the IP we hand to undici's
      // socket is the one we authorized. Reject any record in the private
      // set BEFORE the TCP handshake.
      lookup: (
        hostname: string,
        options: any,
        callback: (
          err: NodeJS.ErrnoException | null,
          address?: string | { address: string; family: number }[],
          family?: number,
        ) => void,
      ) => {
        lookup(
          hostname,
          { all: true, verbatim: true },
          (err: NodeJS.ErrnoException | null, addresses: any) => {
            if (err) return callback(err);
            const list: { address: string; family: number }[] = Array.isArray(
              addresses,
            )
              ? addresses
              : [{ address: addresses, family: 4 }];
            for (const record of list) {
              if (isPrivateHost(record.address)) {
                const e = new Error(
                  `Connect blocked: ${hostname} resolved to private address ${record.address}`,
                ) as NodeJS.ErrnoException;
                e.code = "EAI_BLOCKED";
                return callback(e);
              }
            }
            // Mirror Node's lookup behavior: when `all` is true, return the
            // array; otherwise the first entry. undici's connect honors
            // `options.all`.
            if (options && options.all) {
              return callback(null, list as any);
            }
            const first = list[0];
            return callback(null, first.address, first.family);
          },
        );
      },
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Legacy aliases — predate the Tools → Extensions rename. Templates import
// these via the legacy `@agent-native/core/tools/url-safety` subpath; keep
// the names exported so they keep resolving until every consumer updates.
// ─────────────────────────────────────────────────────────────────────────────

export { isBlockedExtensionUrl as isBlockedToolUrl };
export { isBlockedExtensionUrlWithDns as isBlockedToolUrlWithDns };
