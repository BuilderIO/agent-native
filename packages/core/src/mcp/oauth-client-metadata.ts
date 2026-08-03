import { ssrfSafeFetch } from "../extensions/url-safety.js";

const CLIENT_METADATA_MAX_BYTES = 64 * 1024;
const CLIENT_METADATA_TIMEOUT_MS = 5_000;
const CLIENT_METADATA_MAX_REDIRECTS = 2;
const CLIENT_METADATA_MAX_CACHE_ENTRIES = 128;
const CLIENT_METADATA_MAX_CACHE_TTL_MS = 5 * 60_000;

const DISALLOWED_REDIRECT_SCHEMES = new Set([
  "javascript:",
  "data:",
  "vbscript:",
  "file:",
  "blob:",
  "about:",
]);

export interface OAuthClientMetadataDocument {
  clientId: string;
  clientName: string;
  redirectUris: string[];
  grantTypes: string[];
  responseTypes: string[];
  tokenEndpointAuthMethod: "none";
  applicationType: "native" | "web";
}

interface CachedClientMetadata {
  expiresAt: number;
  metadata: OAuthClientMetadataDocument;
}

const clientMetadataCache = new Map<string, CachedClientMetadata>();

export function isUrlBasedOAuthClientId(clientId: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(clientId);
}

export function validateOAuthClientMetadataUrl(clientId: string): URL {
  if (!clientId || clientId !== clientId.trim() || clientId.length > 2048) {
    throw new Error("Client metadata URL is invalid");
  }
  let url: URL;
  try {
    url = new URL(clientId);
  } catch {
    throw new Error("Client metadata URL is invalid");
  }
  if (
    url.protocol !== "https:" ||
    url.pathname === "/" ||
    !url.pathname ||
    url.hash ||
    url.username ||
    url.password
  ) {
    throw new Error("Client metadata URL must be HTTPS with a non-root path");
  }
  const authorityEnd = clientId.indexOf("/", "https://".length);
  const queryStart = clientId.indexOf("?", authorityEnd);
  const rawPath = clientId.slice(
    authorityEnd,
    queryStart === -1 ? undefined : queryStart,
  );
  if (
    rawPath.split("/").some((segment) => {
      try {
        const decoded = decodeURIComponent(segment);
        return decoded === "." || decoded === "..";
      } catch {
        return true;
      }
    })
  ) {
    throw new Error("Client metadata URL must not contain dot path segments");
  }
  return url;
}

export function isAllowedOAuthRedirectUri(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    if (url.hash || url.username || url.password) return false;
    if (url.protocol === "https:") return true;
    if (url.protocol === "http:") {
      return (
        url.hostname === "localhost" ||
        url.hostname === "127.0.0.1" ||
        url.hostname === "::1" ||
        url.hostname === "[::1]"
      );
    }
    return (
      !DISALLOWED_REDIRECT_SCHEMES.has(url.protocol) &&
      /^[a-z][a-z0-9+.-]*:$/.test(url.protocol)
    );
  } catch {
    return false;
  }
}

function isLoopbackRedirectHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

/**
 * RFC 8252 section 7.3: a native client's loopback redirect URI uses a port
 * chosen at request time, so the authorization server must ignore the port when
 * comparing loopback redirect URIs against the registered set. Non-loopback
 * redirects keep exact matching, so this cannot widen into an open redirect.
 */
export function matchesRegisteredRedirectUri(
  registered: readonly string[],
  redirectUri: string,
  applicationType: "native" | "web",
): boolean {
  let candidate: URL;
  try {
    candidate = new URL(redirectUri);
    // coercion-ok: a malformed candidate is an invalid redirect, not a runtime failure.
  } catch {
    return false;
  }
  if (candidate.hash || candidate.username || candidate.password) return false;
  if (registered.includes(redirectUri)) return true;
  if (
    applicationType !== "native" ||
    candidate.protocol !== "http:" ||
    !isLoopbackRedirectHost(candidate.hostname)
  ) {
    return false;
  }
  return registered.some((value) => {
    let allowed: URL;
    try {
      allowed = new URL(value);
      // coercion-ok: a malformed registration cannot match a valid redirect.
    } catch {
      return false;
    }
    if (allowed.hash || allowed.username || allowed.password) return false;
    return (
      allowed.protocol === candidate.protocol &&
      allowed.hostname === candidate.hostname &&
      allowed.pathname === candidate.pathname &&
      allowed.search === candidate.search
    );
  });
}

export function applicationTypeForRedirectUris(
  redirectUris: string[],
): "native" | "web" {
  return redirectUris.some((value) => {
    const url = new URL(value);
    return (
      url.protocol !== "https:" ||
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "::1" ||
      url.hostname === "[::1]"
    );
  })
    ? "native"
    : "web";
}

function parseStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function validateClientMetadataDocument(
  clientId: string,
  value: unknown,
): OAuthClientMetadataDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Client metadata document must be a JSON object");
  }
  const document = value as Record<string, unknown>;
  if (document.client_id !== clientId) {
    throw new Error(
      "Client metadata document client_id does not match its URL",
    );
  }
  const clientName =
    typeof document.client_name === "string" ? document.client_name.trim() : "";
  if (
    !clientName ||
    clientName.length > 120 ||
    /[\u0000-\u001f\u007f]/.test(clientName)
  ) {
    throw new Error("Client metadata document client_name is invalid");
  }

  const rawRedirectUris = document.redirect_uris;
  const redirectUris = parseStringArray(rawRedirectUris);
  if (
    !Array.isArray(rawRedirectUris) ||
    redirectUris.length === 0 ||
    redirectUris.length > 20 ||
    redirectUris.length !== rawRedirectUris.length ||
    !redirectUris.every(isAllowedOAuthRedirectUri)
  ) {
    throw new Error("Client metadata document redirect_uris are invalid");
  }

  const tokenEndpointAuthMethod =
    typeof document.token_endpoint_auth_method === "string"
      ? document.token_endpoint_auth_method
      : "none";
  if (
    document.token_endpoint_auth_method !== undefined &&
    typeof document.token_endpoint_auth_method !== "string"
  ) {
    throw new Error(
      "Client metadata document token_endpoint_auth_method is invalid",
    );
  }
  if (tokenEndpointAuthMethod !== "none") {
    throw new Error("Only public Client ID Metadata clients are supported");
  }

  const grantTypes = parseStringArray(document.grant_types);
  if (
    (document.grant_types !== undefined &&
      (!Array.isArray(document.grant_types) ||
        grantTypes.length !== document.grant_types.length)) ||
    grantTypes.length > 10 ||
    !grantTypes.every(
      (grant) => grant === "authorization_code" || grant === "refresh_token",
    )
  ) {
    throw new Error("Client metadata document grant_types are unsupported");
  }

  const responseTypes = parseStringArray(document.response_types);
  if (
    (document.response_types !== undefined &&
      (!Array.isArray(document.response_types) ||
        responseTypes.length !== document.response_types.length)) ||
    responseTypes.length > 10 ||
    !responseTypes.every((responseType) => responseType === "code")
  ) {
    throw new Error("Client metadata document response_types are unsupported");
  }

  const requestedApplicationType =
    typeof document.application_type === "string"
      ? document.application_type
      : undefined;
  if (
    (document.application_type !== undefined &&
      typeof document.application_type !== "string") ||
    (requestedApplicationType &&
      requestedApplicationType !== "native" &&
      requestedApplicationType !== "web")
  ) {
    throw new Error("Client metadata document application_type is unsupported");
  }
  const applicationType: "native" | "web" =
    requestedApplicationType === "native" || requestedApplicationType === "web"
      ? requestedApplicationType
      : applicationTypeForRedirectUris(redirectUris);

  return {
    clientId,
    clientName,
    redirectUris: [...new Set(redirectUris)],
    grantTypes: grantTypes.length
      ? [...new Set(grantTypes)]
      : ["authorization_code", "refresh_token"],
    responseTypes: responseTypes.length
      ? [...new Set(responseTypes)]
      : ["code"],
    tokenEndpointAuthMethod: "none",
    applicationType,
  };
}

async function readBoundedResponseBody(response: Response): Promise<string> {
  const contentLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(contentLength) &&
    contentLength > CLIENT_METADATA_MAX_BYTES
  ) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("Client metadata document is too large");
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > CLIENT_METADATA_MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error("Client metadata document is too large");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    reader.releaseLock();
  }
}

function cacheTtlMs(headers: Headers, now: number): number {
  const cacheControl = headers.get("cache-control")?.toLowerCase() ?? "";
  if (/(?:^|,)\s*(?:no-store|no-cache|private)(?:\s|,|$)/.test(cacheControl)) {
    return 0;
  }
  const maxAge = cacheControl.match(/(?:^|,)\s*max-age=(\d+)/)?.[1];
  if (maxAge) {
    return Math.min(Number(maxAge) * 1_000, CLIENT_METADATA_MAX_CACHE_TTL_MS);
  }
  const expiresAt = Date.parse(headers.get("expires") ?? "");
  if (Number.isFinite(expiresAt) && expiresAt > now) {
    return Math.min(expiresAt - now, CLIENT_METADATA_MAX_CACHE_TTL_MS);
  }
  return 0;
}

function cacheClientMetadata(
  clientId: string,
  metadata: OAuthClientMetadataDocument,
  response: Response,
  now: number,
): void {
  const ttlMs = cacheTtlMs(response.headers, now);
  if (ttlMs <= 0) return;
  clientMetadataCache.delete(clientId);
  clientMetadataCache.set(clientId, {
    expiresAt: now + ttlMs,
    metadata,
  });
  while (clientMetadataCache.size > CLIENT_METADATA_MAX_CACHE_ENTRIES) {
    const oldest = clientMetadataCache.keys().next().value;
    if (typeof oldest !== "string") break;
    clientMetadataCache.delete(oldest);
  }
}

async function fetchOAuthClientMetadataDocument(
  clientId: string,
  signal: AbortSignal,
): Promise<{ metadata: OAuthClientMetadataDocument; response: Response }> {
  const response = await ssrfSafeFetch(
    clientId,
    {
      headers: {
        Accept: "application/json, application/client-metadata+json",
      },
      signal,
    },
    {
      maxRedirects: CLIENT_METADATA_MAX_REDIRECTS,
      httpsOnly: true,
    },
  );
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(
      `Client metadata document request failed with ${response.status}`,
    );
  }
  const contentType =
    response.headers.get("content-type")?.split(";", 1)[0]?.trim() ?? "";
  if (
    contentType !== "application/json" &&
    contentType !== "application/client-metadata+json"
  ) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("Client metadata document content type is invalid");
  }

  const body = await readBoundedResponseBody(response);
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error("Client metadata document is not valid JSON");
  }
  return {
    metadata: validateClientMetadataDocument(clientId, parsed),
    response,
  };
}

export async function resolveOAuthClientMetadataDocument(
  clientId: string,
): Promise<OAuthClientMetadataDocument> {
  validateOAuthClientMetadataUrl(clientId);
  const now = Date.now();
  const cached = clientMetadataCache.get(clientId);
  if (cached && cached.expiresAt > now) {
    clientMetadataCache.delete(clientId);
    clientMetadataCache.set(clientId, cached);
    return cached.metadata;
  }
  if (cached) clientMetadataCache.delete(clientId);

  const abort = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const timedOut = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        abort.abort();
        reject(new Error("Client metadata document request timed out"));
      }, CLIENT_METADATA_TIMEOUT_MS);
    });
    const { metadata, response } = await Promise.race([
      fetchOAuthClientMetadataDocument(clientId, abort.signal),
      timedOut,
    ]);
    cacheClientMetadata(clientId, metadata, response, now);
    return metadata;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
