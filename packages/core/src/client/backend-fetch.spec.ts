import { afterEach, describe, expect, it, vi } from "vitest";

import {
  agentNativePath,
  appApiPath,
  appServerPath,
  isApiBaseUrl,
} from "./api-path.js";
import {
  _resetBackendFetchForTests,
  backendTransport,
  ensureBackendFetchInterceptor,
  installBackendXhr,
  isBackendRequest,
  withBackendRequest,
} from "./backend-fetch.js";
import {
  bearerTransport,
  fetchTransport,
  markFetchTransport,
} from "./fetch-transport.js";

const PAGE = "https://app.example.com/inbox";
const API = "https://api.example.com";

function stubPage(apiBaseUrl?: string, pathname = "/inbox") {
  vi.stubGlobal("window", {
    location: { pathname, href: `https://app.example.com${pathname}` },
    __AGENT_NATIVE_CONFIG__: apiBaseUrl === undefined ? {} : { apiBaseUrl },
  });
}

describe("backend base URL", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("keeps relative paths when no base URL is configured", () => {
    stubPage();
    expect(agentNativePath("/_agent-native/actions")).toBe(
      "/_agent-native/actions",
    );
    expect(appApiPath("/api/items")).toBe("/api/items");
    expect(isBackendRequest("/api/items", PAGE)).toBe(false);
  });

  it("points framework and /api paths at the configured server", () => {
    stubPage("https://api.example.com/mail/");
    expect(agentNativePath("/_agent-native/actions?x=1")).toBe(
      "https://api.example.com/mail/_agent-native/actions?x=1",
    );
    expect(appApiPath("items")).toBe("https://api.example.com/mail/api/items");
  });

  it("resolves any server route against the configured server", () => {
    stubPage();
    expect(appServerPath("/mcp/connect")).toBe("/mcp/connect");
    stubPage("https://api.example.com/mail");
    expect(appServerPath("/mcp/connect")).toBe(
      "https://api.example.com/mail/mcp/connect",
    );
    expect(appServerPath("/.well-known/agent-card.json")).toBe(
      "https://api.example.com/mail/.well-known/agent-card.json",
    );
  });

  it("rejects an invalid projected base URL loudly", () => {
    stubPage("api.example.com");
    expect(() => agentNativePath("/_agent-native/actions")).toThrow(
      /window\.__AGENT_NATIVE_CONFIG__\.apiBaseUrl must be an absolute/,
    );
  });

  it("matches only URLs under the configured mount path", () => {
    stubPage("https://api.example.com/mail");
    expect(isApiBaseUrl(new URL("https://api.example.com/mail/api/x"))).toBe(
      true,
    );
    expect(isApiBaseUrl(new URL("https://api.example.com/mailbox"))).toBe(
      false,
    );
    expect(isApiBaseUrl(new URL("https://other.example.com/mail/x"))).toBe(
      false,
    );
  });

  it("never claims a host page's own relative requests", () => {
    stubPage(API);
    for (const url of [
      "/api/v1/instagram/auth",
      "/_agent-native/actions",
      "/mcp",
      "https://posthog.example/i/v0/e/",
    ]) {
      expect(isBackendRequest(url, PAGE)).toBe(false);
      const init = { credentials: "same-origin" as const };
      expect(withBackendRequest(url, init, PAGE)).toEqual([url, init]);
    }
  });

  it("sends credentials to the server unless the caller opted out", () => {
    stubPage(API);
    const url = `${API}/api/items`;
    expect(withBackendRequest(url, undefined, PAGE)).toEqual([
      url,
      { credentials: "include" },
    ]);
    expect(
      withBackendRequest(
        url,
        { method: "POST", credentials: "same-origin" },
        PAGE,
      )[1],
    ).toEqual({ method: "POST", credentials: "include" });
    expect(withBackendRequest(url, { credentials: "omit" }, PAGE)[1]).toEqual({
      credentials: "omit",
    });
  });

  it("lets same-origin-mode requests reach the configured server", () => {
    stubPage(API);
    expect(
      withBackendRequest(
        `${API}/api/screenshot`,
        { mode: "same-origin" },
        PAGE,
      )[1],
    ).toEqual({ mode: "cors", credentials: "include" });
  });

  it("rebuilds Request inputs for the server with credentials and cors mode", () => {
    stubPage(API);
    const [input, init] = withBackendRequest(
      new Request(`${API}/api/items`, {
        method: "POST",
        mode: "same-origin",
        headers: { "X-Agent-Native-CSRF": "1" },
      }),
      undefined,
      PAGE,
    );
    expect(init).toBeUndefined();
    const request = input as Request;
    expect(request.url).toBe(`${API}/api/items`);
    expect(request.method).toBe("POST");
    expect(request.headers.get("X-Agent-Native-CSRF")).toBe("1");
    expect(request.credentials).toBe("include");
    expect(request.mode).toBe("cors");
  });
});

describe("backend XHR", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  class FakeXhr {
    opened: unknown[] = [];
    withCredentials = false;
    open(...args: unknown[]) {
      this.opened = args;
    }
  }

  it("sends credentials on XHRs to the server and leaves other URLs alone", () => {
    stubPage(API);
    installBackendXhr(
      FakeXhr as unknown as { prototype: XMLHttpRequest },
      () => PAGE,
    );

    const upload = new FakeXhr();
    upload.open("POST", `${API}/api/import-design-file`, true);
    expect(upload.opened).toEqual([
      "POST",
      `${API}/api/import-design-file`,
      true,
    ]);
    expect(upload.withCredentials).toBe(true);

    const hostCall = new FakeXhr();
    hostCall.open("POST", "/api/import-design-file");
    expect(hostCall.opened).toEqual(["POST", "/api/import-design-file"]);
    expect(hostCall.withCredentials).toBe(false);
  });
});

describe("backend fetch transport", () => {
  afterEach(() => {
    _resetBackendFetchForTests();
    vi.unstubAllGlobals();
  });

  // The page's fetch signs each request with the embed token it holds then.
  function stubPageFetch() {
    const signing = { token: "token-a" };
    const pageFetch = vi.fn(async () => new Response("{}")) as typeof fetch;
    markFetchTransport(pageFetch, () => bearerTransport(signing.token));
    const page = {
      location: { pathname: "/inbox", href: PAGE },
      __AGENT_NATIVE_CONFIG__: { apiBaseUrl: API },
      fetch: pageFetch,
    };
    vi.stubGlobal("window", page);
    return { page, pageFetch, signing };
  }

  it("is never the page's own transport, and follows a token change underneath", () => {
    const { page, pageFetch, signing } = stubPageFetch();
    ensureBackendFetchInterceptor();
    expect(page.fetch).not.toBe(pageFetch);

    const first = fetchTransport(page.fetch);
    expect(first).not.toBe(fetchTransport(pageFetch));
    expect(fetchTransport(page.fetch)).toBe(first);

    signing.token = "token-b";
    const second = fetchTransport(page.fetch);
    expect(second).not.toBe(first);
    expect(second).not.toBe(fetchTransport(pageFetch));
    expect(fetchTransport(page.fetch)).toBe(second);
  });

  it("is one transport per transport underneath and server origin", () => {
    const underneath = {};
    expect(backendTransport(underneath, `${API}/app`)).toBe(
      backendTransport(underneath, API),
    );
    expect(backendTransport(underneath, API)).not.toBe(
      backendTransport(underneath, "https://other.example.com"),
    );
    expect(backendTransport(underneath, API)).not.toBe(
      backendTransport({}, API),
    );
  });
});
