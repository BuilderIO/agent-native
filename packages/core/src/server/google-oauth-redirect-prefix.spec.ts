import { afterEach, describe, expect, it } from "vitest";

import {
  isAllowedOAuthRedirectUri,
  resolveOAuthRedirectUri,
} from "./google-oauth.js";

function eventFor(pathname: string, publicPathname?: string) {
  const url = new URL(`https://gateway.test${pathname}`);
  const headers = new Headers({
    host: "gateway.test",
    "x-forwarded-proto": "https",
  });
  return {
    url,
    path: pathname,
    context: {
      _mountedPathname: pathname,
      ...(publicPathname ? { _frameworkPublicPathname: publicPathname } : {}),
    },
    req: new Request(url, { headers }),
    headers,
    node: {
      req: {
        url: pathname,
        headers: { host: "gateway.test", "x-forwarded-proto": "https" },
      },
    },
  } as any;
}

describe("isAllowedOAuthRedirectUri under a custom framework route prefix", () => {
  afterEach(() => {
    delete process.env.AGENT_NATIVE_CONFIG_RUNTIME_FRAMEWORK_ROUTE_PREFIX;
    delete process.env.APP_BASE_PATH;
    delete process.env.VITE_APP_BASE_PATH;
  });

  it("accepts the public form of a mounted callback and the root relay callback", () => {
    process.env.AGENT_NATIVE_CONFIG_RUNTIME_FRAMEWORK_ROUTE_PREFIX =
      "/_platform";
    process.env.APP_BASE_PATH = "/calendar";
    const event = eventFor("/calendar/_agent-native/google/auth-url");
    const origin = "https://gateway.test";

    expect(
      isAllowedOAuthRedirectUri(
        "https://gateway.test/calendar/_platform/google/callback",
        event,
        origin,
      ),
    ).toBe(true);
    expect(
      isAllowedOAuthRedirectUri(
        "https://gateway.test/_platform/google/callback",
        event,
        origin,
        { allowRootCallback: true },
      ),
    ).toBe(true);
    expect(
      isAllowedOAuthRedirectUri(
        "https://gateway.test/_platform/google/callback",
        event,
        origin,
      ),
    ).toBe(false);
  });

  it("keeps the app mount when the boundary preserves the public pathname", () => {
    process.env.AGENT_NATIVE_CONFIG_RUNTIME_FRAMEWORK_ROUTE_PREFIX =
      "/_platform";
    process.env.APP_BASE_PATH = "/calendar";
    const event = eventFor(
      "/_agent-native/google/auth-url",
      "/calendar/_platform/google/auth-url",
    );

    expect(
      isAllowedOAuthRedirectUri(
        "https://gateway.test/calendar/_platform/google/callback",
        event,
        "https://gateway.test",
      ),
    ).toBe(true);
    expect(resolveOAuthRedirectUri(event)).toBe(
      "https://gateway.test/calendar/_platform/google/callback",
    );
  });

  it("rejects the retired internal form and unrelated paths", () => {
    process.env.AGENT_NATIVE_CONFIG_RUNTIME_FRAMEWORK_ROUTE_PREFIX =
      "/_platform";
    const event = eventFor("/_agent-native/google/auth-url");
    const origin = "https://gateway.test";
    expect(
      isAllowedOAuthRedirectUri(
        "https://gateway.test/_agent-native/google/callback",
        event,
        origin,
        { allowRootCallback: true },
      ),
    ).toBe(false);
    expect(
      isAllowedOAuthRedirectUri(
        "https://gateway.test/_platform-extra/google/callback",
        event,
        origin,
      ),
    ).toBe(false);
  });
});
