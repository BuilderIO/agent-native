import { apiBaseUrl, isApiBaseUrl } from "./api-path.js";
import {
  fetchTransport,
  markFetchTransport,
  type FetchTransport,
} from "./fetch-transport.js";

let installed = false;

/**
 * True when a request is addressed to the configured app server. Only URLs
 * the client already pointed there (through `agentNativePath`/`appApiPath`)
 * qualify: this page may belong to a host that embeds the app, and its own
 * relative `/api` calls must never be moved to the app's server.
 */
export function isBackendRequest(
  input: RequestInfo | URL,
  pageHref: string,
): boolean {
  if (!apiBaseUrl()) return false;
  const raw = input instanceof Request ? input.url : String(input);
  if (!URL.canParse(raw, pageHref)) return false;
  return isApiBaseUrl(new URL(raw, pageHref));
}

// "same-origin" is the default, and every caller that passes it means "send
// my session to my own server", which now lives on another origin.
function backendCredentials(
  credentials: RequestCredentials | undefined,
): RequestCredentials {
  return credentials === "omit" ? "omit" : "include";
}

// "same-origin" mode means "only my own server"; that server is now on
// another origin, which that mode would refuse outright.
function backendMode(mode: RequestMode | undefined): RequestMode | undefined {
  return mode === "same-origin" ? "cors" : mode;
}

export function withBackendRequest(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  pageHref: string,
): [RequestInfo | URL, RequestInit | undefined] {
  if (!isBackendRequest(input, pageHref)) return [input, init];
  if (input instanceof Request) {
    const credentials = backendCredentials(
      init?.credentials ?? input.credentials,
    );
    const mode = backendMode(init?.mode ?? input.mode);
    return [
      new Request(input, { ...init, credentials, ...(mode ? { mode } : {}) }),
      undefined,
    ];
  }
  const mode = backendMode(init?.mode);
  return [
    input,
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
 * needs it). Credentials are turned on at `open`; a caller that sets
 * `withCredentials = false` afterwards still wins.
 */
export function installBackendXhr(
  xhr: { prototype: XMLHttpRequest },
  pageHref: () => string,
): void {
  const originalOpen = xhr.prototype.open as XhrOpen;
  const patchedOpen: XhrOpen = function (method, url, ...rest) {
    originalOpen.call(this, method, url, ...rest);
    if (isBackendRequest(url, pageHref())) this.withCredentials = true;
  };
  xhr.prototype.open = patchedOpen as XMLHttpRequest["open"];
}

// Requests this wrapper sends to the app server carry the credentials of the
// transport underneath, such as embed auth's bearer, but go to the server's
// origin with its cookies. So they are a transport of their own: one per
// (transport underneath, server origin), which a token change underneath
// changes and which never equals the page's own transport.
const backendTransports = new WeakMap<
  FetchTransport,
  Map<string | undefined, object>
>();

export function backendTransport(
  underlying: FetchTransport,
  apiBase: string | undefined,
): object {
  const origin =
    apiBase !== undefined && URL.canParse(apiBase)
      ? new URL(apiBase).origin
      : apiBase;
  let byOrigin = backendTransports.get(underlying);
  if (!byOrigin) {
    byOrigin = new Map();
    backendTransports.set(underlying, byOrigin);
  }
  let transport = byOrigin.get(origin);
  if (!transport) {
    transport = {};
    byOrigin.set(origin, transport);
  }
  return transport;
}

export function ensureBackendFetchInterceptor(): void {
  if (installed || typeof window === "undefined") return;
  if (typeof window.fetch !== "function" || !apiBaseUrl()) return;
  const win = window;
  const pageFetch = win.fetch;
  const originalFetch = pageFetch.bind(win);
  const patchedFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const [nextInput, nextInit] = withBackendRequest(
      input,
      init,
      win.location.href,
    );
    return originalFetch(nextInput, nextInit);
  }) as typeof fetch;
  markFetchTransport(patchedFetch, () =>
    backendTransport(fetchTransport(pageFetch), apiBaseUrl()),
  );
  win.fetch = patchedFetch;
  if (typeof win.XMLHttpRequest === "function") {
    installBackendXhr(win.XMLHttpRequest, () => win.location.href);
  }
  installed = true;
}

export function _resetBackendFetchForTests(): void {
  installed = false;
}
