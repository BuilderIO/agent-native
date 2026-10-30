import { stripPathPrefix } from "../shared/framework-route-prefix.js";
import {
  apiBaseUrl,
  isApiBaseUrl,
  isBackendRoutePath,
  resolveAppBasePath,
} from "./api-path.js";

let installed = false;

function routerPath(pathname: string): string {
  const basePath = resolveAppBasePath();
  return basePath
    ? (stripPathPrefix(pathname, basePath) ?? pathname)
    : pathname;
}

/**
 * The backend URL for a request, or `null` when it is not addressed to the
 * app's server. Relative `/api` and framework paths written against the page
 * origin move to the configured server.
 */
export function backendRequestUrl(
  input: RequestInfo | URL,
  pageHref: string,
): URL | null {
  const base = apiBaseUrl();
  if (!base) return null;
  const raw = input instanceof Request ? input.url : String(input);
  if (!URL.canParse(raw, pageHref)) return null;
  const url = new URL(raw, pageHref);
  if (isApiBaseUrl(url)) return url;
  if (url.origin !== new URL(pageHref).origin) return null;
  const path = routerPath(url.pathname);
  if (!isBackendRoutePath(path)) return null;
  return new URL(`${base}${path}${url.search}${url.hash}`);
}

// "same-origin" is the default, and every caller that passes it means "send
// my session to my own server", which now lives on another origin.
function backendCredentials(
  credentials: RequestCredentials | undefined,
): RequestCredentials {
  return credentials === "omit" ? "omit" : "include";
}

// "same-origin" mode means "only my own server"; the request now targets the
// configured server on another origin, which that mode would refuse outright.
function backendMode(mode: RequestMode | undefined): RequestMode | undefined {
  return mode === "same-origin" ? "cors" : mode;
}

export function withBackendRequest(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  pageHref: string,
): [RequestInfo | URL, RequestInit | undefined] {
  const url = backendRequestUrl(input, pageHref);
  if (!url) return [input, init];
  if (input instanceof Request) {
    const credentials = backendCredentials(
      init?.credentials ?? input.credentials,
    );
    const mode = backendMode(init?.mode ?? input.mode);
    const moved = url.href === input.url ? input : new Request(url.href, input);
    return [
      new Request(moved, { ...init, credentials, ...(mode ? { mode } : {}) }),
      undefined,
    ];
  }
  const mode = backendMode(init?.mode);
  return [
    url.href,
    {
      ...init,
      credentials: backendCredentials(init?.credentials),
      ...(mode ? { mode } : {}),
    },
  ];
}

type XhrOpen = (
  this: XMLHttpRequest,
  method: string,
  url: string | URL,
  ...rest: unknown[]
) => void;

/**
 * XHR is the other way the browser reaches the server (upload progress
 * needs it), so it moves with fetch. Credentials are turned on at `open`;
 * a caller that sets `withCredentials = false` afterwards still wins.
 */
export function installBackendXhr(
  xhr: { prototype: XMLHttpRequest },
  pageHref: () => string,
): void {
  const originalOpen = xhr.prototype.open as XhrOpen;
  const patchedOpen: XhrOpen = function (method, url, ...rest) {
    const target = backendRequestUrl(url, pageHref());
    originalOpen.call(this, method, target ? target.href : url, ...rest);
    if (target) this.withCredentials = true;
  };
  xhr.prototype.open = patchedOpen as XMLHttpRequest["open"];
}

export function ensureBackendFetchInterceptor(): void {
  if (installed || typeof window === "undefined") return;
  if (typeof window.fetch !== "function" || !apiBaseUrl()) return;
  const win = window;
  const originalFetch = win.fetch.bind(win);
  const patchedFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const [nextInput, nextInit] = withBackendRequest(
      input,
      init,
      win.location.href,
    );
    return originalFetch(nextInput, nextInit);
  }) as typeof fetch;
  win.fetch = patchedFetch;
  if (typeof win.XMLHttpRequest === "function") {
    installBackendXhr(win.XMLHttpRequest, () => win.location.href);
  }
  installed = true;
}

export function _resetBackendFetchForTests(): void {
  installed = false;
}
