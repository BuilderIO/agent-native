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

  if (/^f[cd]/.test(host) || /^fe[89ab]/.test(host)) return true;
  if (/^ff/i.test(host)) return true;

  const v4mappedDotted = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4mappedDotted) {
    const [a, b, c, d] = v4mappedDotted[1].split(".").map(Number);
    if (isPrivateIpv4(a, b, c, d)) return true;
  }
  if (isPrivateIpv4MappedHex(host)) return true;

  const parts = host.split(".");
  if (parts.length === 4 && parts.every((p) => /^\d+$/.test(p))) {
    const [a, b, c, d] = parts.map(Number);
    if (isPrivateIpv4(a, b, c, d)) return true;
  }

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

function normalizeLookupHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, "");
}

function loopbackHostnameVariants(hostname: string): string[] {
  const normalized = normalizeLookupHostname(hostname);
  if (
    normalized !== "localhost" &&
    normalized !== "127.0.0.1" &&
    normalized !== "::1"
  ) {
    return [normalized];
  }
  return ["localhost", "127.0.0.1", "::1"];
}

function normalizeAllowedPrivateOriginKeys(
  origins: readonly string[],
): Set<string> {
  const keys = new Set<string>();
  for (const origin of origins) {
    try {
      const parsed = new URL(origin);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        continue;
      }
      const port = parsed.port || (parsed.protocol === "https:" ? "443" : "80");
      for (const hostname of loopbackHostnameVariants(parsed.hostname)) {
        keys.add(`${hostname}:${port}`);
      }
    } catch {
      // coercion-ok: malformed deployment configuration is omitted, preserving the fail-closed private-IP guard.
    }
  }
  return keys;
}

function normalizeAllowedPrivateOriginOriginKeys(
  origins: readonly string[],
): Set<string> {
  const keys = new Set<string>();
  for (const origin of origins) {
    try {
      const parsed = new URL(origin);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        continue;
      }
      const port = parsed.port || (parsed.protocol === "https:" ? "443" : "80");
      for (const hostname of loopbackHostnameVariants(parsed.hostname)) {
        keys.add(`${parsed.protocol}//${hostname}:${port}`);
      }
    } catch {
      // Ignore malformed deployment configuration and retain the private-IP guard.
    }
  }
  return keys;
}

function allowedPrivateOriginForDestination(
  destinationUrl: string | undefined,
  allowedPrivateOrigins: readonly string[],
): string | undefined {
  if (!destinationUrl) return undefined;
  const destination = new URL(destinationUrl);
  const port =
    destination.port || (destination.protocol === "https:" ? "443" : "80");
  const destinationKey = `${destination.protocol}//${normalizeLookupHostname(destination.hostname)}:${port}`;
  return normalizeAllowedPrivateOriginOriginKeys(allowedPrivateOrigins).has(
    destinationKey,
  )
    ? destination.origin
    : undefined;
}

let sharedSsrfDispatcher: Promise<unknown> | undefined;
const privateSsrfDispatchers = new Map<string, Promise<unknown>>();

async function createSsrfSafeDispatcherUncached(
  allowedPrivateOrigins: readonly string[] = [],
  destinationUrl?: string,
  options: { required?: boolean } = {},
): Promise<unknown> {
  let undici: any;
  let dnsModule: any;
  try {
    const undiciSpecifier = "undici";
    undici = await import(/* @vite-ignore */ undiciSpecifier);
    dnsModule = await import("node:dns");
  } catch (error) {
    if (options.required) {
      throw new Error(
        "SSRF protection is unavailable because the server dispatcher could not be loaded.",
        { cause: error },
      );
    }
    return null;
  }

  const { Agent } = undici;
  const { lookup } = dnsModule;
  const allowedPrivateOriginKeys = normalizeAllowedPrivateOriginKeys(
    allowedPrivateOrigins,
  );
  let destinationPort = "";
  if (destinationUrl) {
    const parsed = new URL(destinationUrl);
    destinationPort =
      parsed.port || (parsed.protocol === "https:" ? "443" : "80");
  }
  if (!Agent || !lookup) {
    if (options.required) {
      throw new Error(
        "SSRF protection is unavailable because the server dispatcher is incomplete.",
      );
    }
    return null;
  }

  return new Agent({
    connect: {
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
              const allowedOrigin = allowedPrivateOriginKeys.has(
                `${normalizeLookupHostname(hostname)}:${destinationPort}`,
              );
              if (isPrivateHost(record.address) && !allowedOrigin) {
                const e = new Error(
                  `Connect blocked: ${hostname} resolved to private address ${record.address}`,
                ) as NodeJS.ErrnoException;
                e.code = "EAI_BLOCKED";
                return callback(e);
              }
            }
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

export async function createSsrfSafeDispatcher(
  allowedPrivateOrigins: readonly string[] = [],
  destinationUrl?: string,
  options: { required?: boolean } = {},
): Promise<unknown> {
  const allowedPrivateOrigin = allowedPrivateOriginForDestination(
    destinationUrl,
    allowedPrivateOrigins,
  );
  if (!allowedPrivateOrigin) {
    sharedSsrfDispatcher ??= createSsrfSafeDispatcherUncached();
    const dispatcher = await sharedSsrfDispatcher;
    if (dispatcher || !options.required) return dispatcher;
    return createSsrfSafeDispatcherUncached([], undefined, options);
  }

  const cacheKey = JSON.stringify([
    allowedPrivateOrigin,
    options.required === true,
  ]);
  let dispatcher = privateSsrfDispatchers.get(cacheKey);
  if (!dispatcher) {
    dispatcher = createSsrfSafeDispatcherUncached(
      [allowedPrivateOrigin],
      destinationUrl,
      options,
    );
    privateSsrfDispatchers.set(cacheKey, dispatcher);
  }

  try {
    const resolved = await dispatcher;
    if (!resolved && privateSsrfDispatchers.get(cacheKey) === dispatcher) {
      privateSsrfDispatchers.delete(cacheKey);
    }
    return resolved;
  } catch (error) {
    if (privateSsrfDispatchers.get(cacheKey) === dispatcher) {
      privateSsrfDispatchers.delete(cacheKey);
    }
    throw error;
  }
}

/**
 * SSRF-safe `fetch` for any server-side request to a user/agent-supplied URL.
 *
 * Applies the same protections the extension proxy uses, so every call site
 * that fetches an untrusted URL gets them without re-implementing the loop:
 *   1. Pre-flight DNS-aware private-address check (isBlockedExtensionUrlWithDns)
 *      on the initial URL and on every redirect hop.
 *   2. A connect-time dispatcher that re-checks the resolved IP at TCP-connect
 *      time (closes the DNS-rebinding TOCTOU) when the runtime supports the
 *      Node dispatcher. Edge runtimes retain preflight DNS checks, literal and
 *      rebinding-domain rejection, and per-hop redirect validation.
 *   3. Manual redirect handling — a public URL cannot 30x-redirect into the
 *      private network because each hop is re-validated before it is followed.
 *
 * Throws an Error whose message starts with "SSRF blocked:" when a target
 * (initial or via redirect) resolves to a private/internal address, or when the
 * redirect limit is exceeded. Otherwise returns the final Response.
 *
 * `httpsOnly` extends the per-hop validation to the URL scheme: redirects are
 * followed only to `https:` targets, so an HTTPS-only caller cannot be
 * downgraded to plain HTTP by a 30x from the (untrusted) origin.
 *
 * `assertUrlAllowed` lets callers layer a stricter destination policy (for
 * example, a credential's origin allowlist) on top of the SSRF checks. It runs
 * before the initial request and before every redirect hop, so sensitive
 * headers and bodies are never forwarded to a destination the caller rejects.
 */
export async function ssrfSafeFetch(
  url: string,
  init: RequestInit = {},
  options: {
    maxRedirects?: number;
    followRedirects?: boolean;
    requireDispatcher?: boolean;
    httpsOnly?: boolean;
    assertUrlAllowed?: (url: string) => void | Promise<void>;
    allowedPrivateOrigins?: readonly string[];
  } = {},
): Promise<Response> {
  const maxRedirects = options.maxRedirects ?? 3;
  let currentInit = init;
  const allowedPrivateOrigins = normalizeAllowedPrivateOriginOriginKeys(
    options.allowedPrivateOrigins ?? [],
  );
  const isAllowedPrivateOrigin = (candidate: string): boolean => {
    if (allowedPrivateOrigins.size === 0) return false;
    try {
      const parsed = new URL(candidate);
      const port = parsed.port || (parsed.protocol === "https:" ? "443" : "80");
      return allowedPrivateOrigins.has(
        `${parsed.protocol}//${normalizeLookupHostname(parsed.hostname)}:${port}`,
      );
    } catch {
      return false;
    }
  };

  let currentUrl = url;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    await options.assertUrlAllowed?.(currentUrl);
    if (options.httpsOnly && new URL(currentUrl).protocol !== "https:") {
      throw new Error(
        `SSRF blocked: refusing to fetch non-HTTPS address (${currentUrl})`,
      );
    }
    if (
      !isAllowedPrivateOrigin(currentUrl) &&
      (await isBlockedExtensionUrlWithDns(currentUrl))
    ) {
      throw new Error(
        `SSRF blocked: refusing to fetch private/internal address (${currentUrl})`,
      );
    }
    const fetchOpts: RequestInit & { dispatcher?: unknown } = {
      ...currentInit,
      redirect: "manual",
    };
    const dispatcher = await createSsrfSafeDispatcher(
      options.allowedPrivateOrigins,
      currentUrl,
      { required: options.requireDispatcher },
    );
    if (dispatcher) fetchOpts.dispatcher = dispatcher;

    const response = await fetch(currentUrl, fetchOpts);
    if (response.status >= 300 && response.status < 400) {
      if (options.followRedirects === false) return response;
      const location = response.headers.get("location");
      if (!location) return response;
      await response.body?.cancel().catch(() => {});
      const nextUrl = new URL(location, currentUrl);
      const method = currentInit.method?.toUpperCase() ?? "GET";
      const rewritesToGet =
        ((response.status === 301 || response.status === 302) &&
          method === "POST") ||
        (response.status === 303 && method !== "GET" && method !== "HEAD");
      let headers = new Headers(currentInit.headers);
      if (rewritesToGet) {
        for (const name of [
          "content-encoding",
          "content-language",
          "content-length",
          "content-location",
          "content-type",
        ]) {
          headers.delete(name);
        }
        currentInit = { ...currentInit, method: "GET", body: undefined };
      }
      if (nextUrl.origin !== new URL(currentUrl).origin) {
        const redirectedMethod = currentInit.method?.toUpperCase() ?? "GET";
        if (redirectedMethod !== "GET" && redirectedMethod !== "HEAD") {
          throw new Error(
            "Refusing to follow a cross-origin redirect with a non-GET request",
          );
        }
        const safeHeaders = new Headers();
        const accept = headers.get("accept");
        if (accept !== null) safeHeaders.set("accept", accept);
        headers = safeHeaders;
      }
      currentInit = { ...currentInit, headers };
      currentUrl = nextUrl.href;
      continue;
    }
    return response;
  }
  throw new Error(
    `SSRF blocked: too many redirects (>${maxRedirects}) while fetching ${url}`,
  );
}

export { isBlockedExtensionUrl as isBlockedToolUrl };
export { isBlockedExtensionUrlWithDns as isBlockedToolUrlWithDns };
export { ssrfSafeFetch as ssrfSafeToolFetch };
