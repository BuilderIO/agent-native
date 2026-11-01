import type { H3Event } from "h3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getAuthGuardPath } from "./auth-guard-path.js";

// `url` is H3's canonical reading of the path; `node.req.url`, when the
// request came through Node, is the path as it was sent.
function event(path: string, rawUrl?: string): H3Event {
  return {
    url: new URL(`https://content.agent-native.com${path}`),
    ...(rawUrl === undefined ? {} : { node: { req: { url: rawUrl } } }),
  } as unknown as H3Event;
}

describe("getAuthGuardPath", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns H3's canonical pathname", () => {
    expect(
      getAuthGuardPath(
        event("/_agent-native/sign-in", "/_agent-native/%73ign-in"),
      ),
    ).toBe("/_agent-native/sign-in");
  });

  it("reads the pathname alone when there is no Node request", () => {
    expect(getAuthGuardPath(event("/login"))).toBe("/login");
  });

  it("ignores the query string of the raw request path", () => {
    expect(getAuthGuardPath(event("/login", "/login?next=/home"))).toBe(
      "/login",
    );
  });

  it("maps the app's framework route prefix to /_agent-native", () => {
    vi.stubEnv(
      "AGENT_NATIVE_CONFIG_RUNTIME_FRAMEWORK_ROUTE_PREFIX",
      "/_platform",
    );
    expect(getAuthGuardPath(event("/_platform/actions/list-documents"))).toBe(
      "/_agent-native/actions/list-documents",
    );
  });

  it("removes the app's base path", () => {
    vi.stubEnv("APP_BASE_PATH", "/docs");
    expect(getAuthGuardPath(event("/docs/_agent-native/sign-in"))).toBe(
      "/_agent-native/sign-in",
    );
    expect(getAuthGuardPath(event("/docs"))).toBe("/");
  });

  it("maps a framework route prefix under the base path", () => {
    vi.stubEnv("APP_BASE_PATH", "/docs");
    vi.stubEnv(
      "AGENT_NATIVE_CONFIG_RUNTIME_FRAMEWORK_ROUTE_PREFIX",
      "/_platform",
    );
    expect(getAuthGuardPath(event("/docs/_platform/ping"))).toBe(
      "/_agent-native/ping",
    );
  });

  it.each([
    ["a path that isn't absolute", "login"],
    ["a protocol-relative path", "//evil.example/login"],
    ["a backslash", "/login\\..\\admin"],
    ["a path URL parsing would change", "/docs/../login"],
  ])("rejects %s", (_kind, rawUrl) => {
    expect(getAuthGuardPath(event("/login", rawUrl))).toBeNull();
  });
});
