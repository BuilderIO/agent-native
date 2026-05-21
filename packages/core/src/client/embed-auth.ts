import {
  EMBED_MODE_QUERY_PARAM,
  EMBED_START_PATH,
  EMBED_TARGET_HEADER,
  EMBED_TOKEN_QUERY_PARAM,
} from "../shared/embed-auth.js";

let installed = false;
let memoryToken: string | null = null;
const EMBED_TOKEN_STORAGE_KEY = "agent-native:embed-auth-token";

const AUTH_FAILURE_COOLDOWN_MS = 60_000;
const GUARDED_METHODS = new Set(["GET", "HEAD"]);
const AUTH_FAILURE_HEADER = "x-agent-native-auth-circuit-breaker";

type AuthFailureRecord = {
  status: number;
  statusText: string;
  headers: [string, string][];
  body: string | null;
  expiresAt: number;
};

const authFailureCache = new Map<string, AuthFailureRecord>();
let embedAuthFailure: AuthFailureRecord | null = null;

function browserWindow(): Window | null {
  return typeof window === "undefined" ? null : window;
}

function readTokenFromUrl(win: Window): string | null {
  try {
    const url = new URL(win.location.href);
    return url.searchParams.get(EMBED_TOKEN_QUERY_PARAM);
  } catch {
    return null;
  }
}

function storedToken(win: Window): string | null {
  try {
    return win.sessionStorage?.getItem(EMBED_TOKEN_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

function storeToken(token: string, win: Window): void {
  memoryToken = token;
  try {
    win.sessionStorage?.setItem(EMBED_TOKEN_STORAGE_KEY, token);
  } catch {
    // Session storage may be unavailable in some sandboxed hosts. The
    // in-memory fallback still covers the normal single-page boot path.
  }
}

export function getEmbedAuthToken(): string | null {
  const win = browserWindow();
  if (!win) return null;
  const fromUrl = readTokenFromUrl(win);
  if (fromUrl) {
    storeToken(fromUrl, win);
    return fromUrl;
  }
  return memoryToken ?? storedToken(win);
}

export function isEmbedAuthActive(): boolean {
  const win = browserWindow();
  if (!win) return false;
  if (getEmbedAuthToken()) return true;
  try {
    const url = new URL(win.location.href);
    const mode = url.searchParams.get(EMBED_MODE_QUERY_PARAM);
    return mode === "1" || mode === "true";
  } catch {
    return false;
  }
}

function stripTokenFromUrl(win: Window): void {
  try {
    const url = new URL(win.location.href);
    if (!url.searchParams.has(EMBED_TOKEN_QUERY_PARAM)) return;
    url.searchParams.delete(EMBED_TOKEN_QUERY_PARAM);
    win.history.replaceState(
      win.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  } catch {
    // best effort only
  }
}

function currentEmbedTarget(win: Window): string {
  return `${win.location.pathname}${win.location.search}`;
}

function inputUrl(input: RequestInfo | URL, win: Window): URL | null {
  try {
    return input instanceof Request
      ? new URL(input.url)
      : new URL(String(input), win.location.origin);
  } catch {
    return null;
  }
}

function sameOrigin(input: RequestInfo | URL, win: Window): boolean {
  const url = inputUrl(input, win);
  return !!url && url.origin === win.location.origin;
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  return (
    init?.method ??
    (input instanceof Request ? input.method : undefined) ??
    "GET"
  ).toUpperCase();
}

function authFailureKey(method: string, url: URL): string {
  return `${method} ${url.href}`;
}

function isAuthFailureStatus(status: number): boolean {
  return status === 401 || status === 403;
}

function shouldGuardAuthFailure(method: string, url: URL): boolean {
  if (!GUARDED_METHODS.has(method)) return false;
  if (url.pathname === EMBED_START_PATH) return false;
  if (url.pathname === "/_agent-native/sign-in") return false;
  return true;
}

function activeAuthFailure(
  record: AuthFailureRecord | null | undefined,
): AuthFailureRecord | null {
  if (!record) return null;
  if (record.expiresAt > Date.now()) return record;
  return null;
}

function getCachedAuthFailure(
  key: string,
  useEmbedWideFailure: boolean,
): AuthFailureRecord | null {
  const cached = activeAuthFailure(authFailureCache.get(key));
  if (cached) return cached;
  authFailureCache.delete(key);

  if (!useEmbedWideFailure) return null;
  const embedCached = activeAuthFailure(embedAuthFailure);
  if (embedCached) return embedCached;
  embedAuthFailure = null;
  return null;
}

function authFailureResponse(record: AuthFailureRecord): Response {
  const headers = new Headers(record.headers);
  headers.set(AUTH_FAILURE_HEADER, "1");
  if (!headers.has("retry-after")) {
    headers.set(
      "retry-after",
      String(Math.max(1, Math.ceil((record.expiresAt - Date.now()) / 1000))),
    );
  }
  return new Response(record.body, {
    status: record.status,
    statusText: record.statusText,
    headers,
  });
}

async function recordAuthFailure(
  key: string,
  response: Response,
  useEmbedWideFailure: boolean,
): Promise<void> {
  let body: string | null = null;
  try {
    body = await response.clone().text();
  } catch {
    body = null;
  }

  const headers: [string, string][] = [];
  response.headers.forEach((value, name) => {
    const lower = name.toLowerCase();
    if (
      lower === "content-encoding" ||
      lower === "content-length" ||
      lower === "transfer-encoding"
    ) {
      return;
    }
    headers.push([name, value]);
  });

  const record: AuthFailureRecord = {
    status: response.status,
    statusText: response.statusText,
    headers,
    body,
    expiresAt: Date.now() + AUTH_FAILURE_COOLDOWN_MS,
  };
  authFailureCache.set(key, record);
  if (useEmbedWideFailure) embedAuthFailure = record;
}

function clearAuthFailure(key: string, useEmbedWideFailure: boolean): void {
  authFailureCache.delete(key);
  if (useEmbedWideFailure) embedAuthFailure = null;
}

function withEmbedAuthHeaders(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  token: string,
  win: Window,
): [RequestInfo | URL, RequestInit | undefined] {
  const headers = new Headers(
    init?.headers ?? (input instanceof Request ? input.headers : undefined),
  );
  if (!headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  if (!headers.has(EMBED_TARGET_HEADER)) {
    headers.set(EMBED_TARGET_HEADER, currentEmbedTarget(win));
  }

  if (input instanceof Request) {
    return [new Request(input, { ...init, headers }), undefined];
  }
  return [input, { ...init, headers }];
}

function requestUrlAndKey(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  win: Window,
):
  | {
      key: string;
      shouldGuard: boolean;
    }
  | undefined {
  const url = inputUrl(input, win);
  if (!url || url.origin !== win.location.origin) return undefined;
  const method = requestMethod(input, init);
  return {
    key: authFailureKey(method, url),
    shouldGuard: shouldGuardAuthFailure(method, url),
  };
}

export function ensureEmbedAuthFetchInterceptor(): void {
  const win = browserWindow();
  if (!win) return;

  const urlToken = readTokenFromUrl(win);
  if (urlToken) {
    storeToken(urlToken, win);
    stripTokenFromUrl(win);
  }

  if (installed) return;
  if (typeof win.fetch !== "function") return;
  installed = true;

  const originalFetch = win.fetch.bind(win);
  win.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = requestUrlAndKey(input, init, win);
    const embedMode = isEmbedAuthActive();
    if (request?.shouldGuard) {
      const cached = getCachedAuthFailure(request.key, embedMode);
      if (cached) return authFailureResponse(cached);
    }

    const token = getEmbedAuthToken();
    let fetchInput = input;
    let fetchInit = init;
    if (token && sameOrigin(input, win)) {
      [fetchInput, fetchInit] = withEmbedAuthHeaders(input, init, token, win);
    }

    const response = await originalFetch(fetchInput as any, fetchInit as any);
    if (request?.shouldGuard && isAuthFailureStatus(response.status)) {
      await recordAuthFailure(request.key, response, embedMode || !!token);
    } else if (request?.shouldGuard && response.ok) {
      clearAuthFailure(request.key, embedMode || !!token);
    }
    return response;
  }) as typeof fetch;
}
