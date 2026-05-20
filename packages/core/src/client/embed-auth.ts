import {
  EMBED_MODE_QUERY_PARAM,
  EMBED_TARGET_HEADER,
  EMBED_TOKEN_QUERY_PARAM,
} from "../shared/embed-auth.js";

let installed = false;
let memoryToken: string | null = null;

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

function storeToken(token: string): void {
  memoryToken = token;
}

export function getEmbedAuthToken(): string | null {
  const win = browserWindow();
  if (!win) return null;
  const fromUrl = readTokenFromUrl(win);
  if (fromUrl) return fromUrl;
  return memoryToken;
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

function sameOrigin(input: RequestInfo | URL, win: Window): boolean {
  try {
    const url =
      input instanceof Request
        ? new URL(input.url)
        : new URL(String(input), win.location.origin);
    return url.origin === win.location.origin;
  } catch {
    return false;
  }
}

export function ensureEmbedAuthFetchInterceptor(): void {
  const win = browserWindow();
  if (!win) return;

  const urlToken = readTokenFromUrl(win);
  if (urlToken) {
    storeToken(urlToken);
    stripTokenFromUrl(win);
  }

  if (installed) return;
  if (typeof win.fetch !== "function") return;
  installed = true;

  const originalFetch = win.fetch.bind(win);
  win.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const token = getEmbedAuthToken();
    if (!token || !sameOrigin(input, win)) {
      return originalFetch(input as any, init as any);
    }

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
      return originalFetch(new Request(input, { ...init, headers }));
    }
    return originalFetch(input as any, { ...init, headers });
  }) as typeof fetch;
}
