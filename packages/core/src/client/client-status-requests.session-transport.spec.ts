// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { embedApp } from "../mcp/embed-app.js";
import { EMBED_TOKEN_QUERY_PARAM } from "../shared/embed-auth.js";
import { EMBED_TOKEN_STORAGE_KEY } from "../shared/mcp-app-widget-embed.js";
import { getSsrSessionBootstrapScriptBody } from "../shared/ssr-session-bootstrap.js";
import {
  fetchAuthSessionStatus,
  invalidateClientStatusRequests,
} from "./client-status-requests.js";
import {
  _resetEmbedAuthForTests,
  ensureEmbedAuthFetchInterceptor,
} from "./embed-auth.js";
import { markPassThroughFetch } from "./fetch-transport.js";

// One page can read the session over two transports: its own cookies, and an
// embed token. Two wrappers put the token on. The app's own embed auth adds
// it to every same-origin request whenever a token is stored (in the URL for
// a runtime GET, else as a bearer header). The MCP host's embed runtime
// replaces `window.fetch` with one that sends a bearer header and omits
// cookies. The cookies and the token can name different people. Neither may
// be answered with the other's session.

const SESSION_PATH = "/_agent-native/auth/session";
const EMBED_TOKEN = "embed-token";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// The embed token a request carries, wherever the wrapper put it.
function embedTokenSent(
  input: RequestInfo | URL,
  init?: RequestInit,
): string | null {
  const url = new URL(
    input instanceof Request ? input.url : String(input),
    "http://localhost",
  );
  const bearer = new Headers(init?.headers).get("Authorization");
  return (
    url.searchParams.get(EMBED_TOKEN_QUERY_PARAM) ??
    (bearer?.startsWith("Bearer ") ? bearer.slice("Bearer ".length) : null)
  );
}

// The server: an embed token names one person, the cookies another.
const network = vi.fn(
  async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    if (!url.includes(SESSION_PATH)) return jsonResponse({}, 404);
    if (embedTokenSent(input, init) === EMBED_TOKEN) {
      return jsonResponse({ userId: "bearer-user" });
    }
    if (init?.credentials === "omit") {
      return jsonResponse({ error: "Not signed in" }, 401);
    }
    return jsonResponse({ userId: "cookie-user" });
  },
);

/**
 * Installs the embed runtime from the MCP app's own HTML, as a transplant
 * does, and returns the `window.fetch` it puts in place.
 */
function installEmbedRuntime(pageFetch: typeof fetch): typeof fetch {
  const resource = embedApp();
  const html =
    typeof resource.html === "function"
      ? resource.html({ actionName: "open_app", appId: "content" })
      : resource.html;
  const runtimeSource = html.match(
    /    function installExternalEmbedRuntime\(config\) \{[\s\S]*?\n    \}\n/,
  )?.[0];
  expect(runtimeSource).toBeTruthy();
  const locationObject = {
    href: "https://host.example/page/doc-1",
    origin: "https://host.example",
    pathname: "/page/doc-1",
    search: "",
  };
  const windowObject: Record<string, unknown> = {
    location: locationObject,
    history: { state: null, replaceState: () => {} },
  };
  const installRuntime = new Function(
    "window",
    "location",
    "sessionStorage",
    "installReactRefreshPreambleFallback",
    "fetch",
    "XMLHttpRequest",
    "EventSource",
    `${runtimeSource as string}; return installExternalEmbedRuntime;`,
  )(
    windowObject,
    locationObject,
    { setItem: () => {} },
    () => {},
    pageFetch,
    undefined,
    undefined,
  ) as (config: Record<string, unknown>) => void;
  installRuntime({
    origin: "https://app.example",
    target: "/page/doc-1",
    token: EMBED_TOKEN,
    embedTokenParam: "__an_embed_token",
    embedTargetHeader: "X-Agent-Native-Embed-Target",
    appConfig: {},
  });
  const embedFetch = windowObject.fetch as typeof fetch;
  expect(embedFetch).not.toBe(pageFetch);
  return embedFetch;
}

function runSessionHeadScript() {
  // The shell's inline <script>: the session read sent from the head.
  new Function(getSsrSessionBootstrapScriptBody(SESSION_PATH))();
}

function sentWith(call: number) {
  const [input, init] = network.mock.calls[call] ?? [""];
  return {
    credentials: init?.credentials,
    embedToken: embedTokenSent(input, init),
  };
}

describe("session reads over a cookie and a bearer transport", () => {
  beforeEach(() => {
    invalidateClientStatusRequests();
    _resetEmbedAuthForTests();
    sessionStorage.clear();
    window.history.replaceState(null, "", "/page/doc-1");
    network.mockClear();
    document.cookie = "an_session_hint=1; path=/";
    vi.stubGlobal("fetch", network);
  });

  afterEach(() => {
    invalidateClientStatusRequests();
    _resetEmbedAuthForTests();
    sessionStorage.clear();
    document.cookie = "an_session_hint=; path=/; max-age=0";
    vi.unstubAllGlobals();
  });

  it("does not answer the app's embed-token caller with the head's cookie read", async () => {
    window.history.replaceState(null, "", "/page/doc-1?embedded=1");
    sessionStorage.setItem(EMBED_TOKEN_STORAGE_KEY, EMBED_TOKEN);
    runSessionHeadScript();
    // The app code loads and puts its embed auth over the page's fetch.
    ensureEmbedAuthFetchInterceptor();
    expect(globalThis.fetch).not.toBe(network);

    await expect(fetchAuthSessionStatus()).resolves.toEqual({
      state: "available",
      value: { userId: "bearer-user" },
    });
    expect(network).toHaveBeenCalledTimes(2);
    expect(sentWith(1).embedToken).toBe(EMBED_TOKEN);
  });

  it("answers the app from the head's cookie read when its embed auth has no token", async () => {
    runSessionHeadScript();
    ensureEmbedAuthFetchInterceptor();
    expect(globalThis.fetch).not.toBe(network);

    await expect(fetchAuthSessionStatus()).resolves.toEqual({
      state: "available",
      value: { userId: "cookie-user" },
    });
    expect(network).toHaveBeenCalledTimes(1);
  });

  it("does not answer the MCP host runtime's bearer caller with the head's cookie read", async () => {
    runSessionHeadScript();
    vi.stubGlobal("fetch", installEmbedRuntime(network));

    await expect(fetchAuthSessionStatus()).resolves.toEqual({
      state: "available",
      value: { userId: "bearer-user" },
    });
    expect(network).toHaveBeenCalledTimes(2);
    expect(sentWith(1)).toEqual({
      credentials: "omit",
      embedToken: EMBED_TOKEN,
    });
  });

  it("keeps the head's cookie read for a cookie caller that comes after a bearer caller", async () => {
    runSessionHeadScript();
    vi.stubGlobal("fetch", installEmbedRuntime(network));
    await expect(fetchAuthSessionStatus()).resolves.toEqual({
      state: "available",
      value: { userId: "bearer-user" },
    });
    expect(network).toHaveBeenCalledTimes(2);

    vi.stubGlobal("fetch", network);
    await expect(fetchAuthSessionStatus()).resolves.toEqual({
      state: "available",
      value: { userId: "cookie-user" },
    });
    // The head's request answers it; nothing more is sent.
    expect(network).toHaveBeenCalledTimes(2);
  });

  it("does not answer a cookie caller with the MCP host runtime's bearer session, or the reverse, while either is fresh", async () => {
    // A transplant installs the runtime before the app's head scripts run,
    // so the head read itself goes out with the bearer token.
    const embedFetch = installEmbedRuntime(network);
    vi.stubGlobal("fetch", embedFetch);
    runSessionHeadScript();
    await expect(fetchAuthSessionStatus()).resolves.toEqual({
      state: "available",
      value: { userId: "bearer-user" },
    });
    expect(network).toHaveBeenCalledTimes(1);

    vi.stubGlobal("fetch", network);
    await expect(fetchAuthSessionStatus()).resolves.toEqual({
      state: "available",
      value: { userId: "cookie-user" },
    });
    expect(sentWith(1)).toEqual({
      credentials: "same-origin",
      embedToken: null,
    });

    vi.stubGlobal("fetch", embedFetch);
    await expect(fetchAuthSessionStatus()).resolves.toEqual({
      state: "available",
      value: { userId: "bearer-user" },
    });
    vi.stubGlobal("fetch", network);
    await expect(fetchAuthSessionStatus()).resolves.toEqual({
      state: "available",
      value: { userId: "cookie-user" },
    });
    // Each transport's answer is cached for itself.
    expect(network).toHaveBeenCalledTimes(2);
  });

  it("shares the head's read through a wrapper that sends requests on unchanged", async () => {
    runSessionHeadScript();
    const replayFetch = ((...args: Parameters<typeof fetch>) =>
      network(...args)) as typeof fetch;
    markPassThroughFetch(replayFetch, network);
    vi.stubGlobal("fetch", replayFetch);

    await expect(fetchAuthSessionStatus()).resolves.toEqual({
      state: "available",
      value: { userId: "cookie-user" },
    });
    expect(network).toHaveBeenCalledTimes(1);
  });
});
