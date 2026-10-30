import { afterEach, describe, expect, it, vi } from "vitest";

import { agentNativePath, appApiPath, isApiBaseUrl } from "./api-path.js";
import {
  backendRequestUrl,
  installBackendXhr,
  withBackendRequest,
} from "./backend-fetch.js";

const PAGE = "https://app.example.com/inbox";

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
    expect(backendRequestUrl("/api/items", PAGE)).toBeNull();
  });

  it("points framework and /api paths at the configured server", () => {
    stubPage("https://api.example.com/mail/");
    expect(agentNativePath("/_agent-native/actions?x=1")).toBe(
      "https://api.example.com/mail/_agent-native/actions?x=1",
    );
    expect(appApiPath("items")).toBe("https://api.example.com/mail/api/items");
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

  it("moves relative server routes and leaves UI-host paths alone", () => {
    stubPage("https://api.example.com");
    expect(backendRequestUrl("/api/items?a=1", PAGE)?.href).toBe(
      "https://api.example.com/api/items?a=1",
    );
    expect(backendRequestUrl("/mcp", PAGE)?.href).toBe(
      "https://api.example.com/mcp",
    );
    expect(backendRequestUrl("/assets/app.js", PAGE)).toBeNull();
    expect(backendRequestUrl("/.well-known/x", PAGE)).toBeNull();
    expect(backendRequestUrl("https://posthog.example/i/v0/e/", PAGE)).toBe(
      null,
    );
  });

  it("strips the UI base path before moving a request", () => {
    stubPage("https://api.example.com", "/mail/_agent-native/auth/reset");
    expect(
      backendRequestUrl(
        "/mail/_agent-native/events",
        "https://app.example.com/mail/inbox",
      )?.href,
    ).toBe("https://api.example.com/_agent-native/events");
  });

  it("sends credentials to the server unless the caller opted out", () => {
    stubPage("https://api.example.com");
    expect(withBackendRequest("/api/items", undefined, PAGE)).toEqual([
      "https://api.example.com/api/items",
      { credentials: "include" },
    ]);
    expect(
      withBackendRequest(
        "/api/items",
        { method: "POST", credentials: "same-origin" },
        PAGE,
      )[1],
    ).toEqual({ method: "POST", credentials: "include" });
    expect(
      withBackendRequest("/api/items", { credentials: "omit" }, PAGE)[1],
    ).toEqual({ credentials: "omit" });
  });

  it("rebuilds Request inputs against the server with credentials", () => {
    stubPage("https://api.example.com");
    const [input, init] = withBackendRequest(
      new Request("https://app.example.com/api/items", {
        method: "POST",
        headers: { "X-Agent-Native-CSRF": "1" },
      }),
      undefined,
      PAGE,
    );
    expect(init).toBeUndefined();
    expect(input).toBeInstanceOf(Request);
    const request = input as Request;
    expect(request.url).toBe("https://api.example.com/api/items");
    expect(request.method).toBe("POST");
    expect(request.headers.get("X-Agent-Native-CSRF")).toBe("1");
    expect(request.credentials).toBe("include");
  });

  it("lets same-origin-mode requests reach the configured server", () => {
    stubPage("https://api.example.com");
    expect(
      withBackendRequest("/api/screenshot", { mode: "same-origin" }, PAGE)[1],
    ).toEqual({ mode: "cors", credentials: "include" });
    const [request] = withBackendRequest(
      new Request("https://app.example.com/api/screenshot", {
        mode: "same-origin",
      }),
      undefined,
      PAGE,
    );
    expect((request as Request).mode).toBe("cors");
    const init = { mode: "same-origin" as const };
    expect(withBackendRequest("/inbox", init, PAGE)).toEqual(["/inbox", init]);
  });

  it("leaves non-server requests untouched", () => {
    stubPage("https://api.example.com");
    const init = { credentials: "same-origin" as const };
    expect(withBackendRequest("/inbox", init, PAGE)).toEqual(["/inbox", init]);
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

  it("moves server-route XHRs to the configured server with credentials", () => {
    stubPage("https://api.example.com");
    installBackendXhr(
      FakeXhr as unknown as { prototype: XMLHttpRequest },
      () => PAGE,
    );

    const upload = new FakeXhr();
    upload.open("POST", "/api/import-design-file", true);
    expect(upload.opened).toEqual([
      "POST",
      "https://api.example.com/api/import-design-file",
      true,
    ]);
    expect(upload.withCredentials).toBe(true);

    const asset = new FakeXhr();
    asset.open("GET", "/assets/logo.svg");
    expect(asset.opened).toEqual(["GET", "/assets/logo.svg"]);
    expect(asset.withCredentials).toBe(false);
  });
});
