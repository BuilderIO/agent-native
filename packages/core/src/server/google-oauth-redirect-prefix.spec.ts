import { afterEach, describe, expect, it } from "vitest";

import { isAllowedOAuthRedirectUri } from "./google-oauth.js";

function eventFor(pathname: string) {
  const url = new URL(`https://gateway.test${pathname}`);
  return {
    url,
    path: pathname,
    context: { _mountedPathname: pathname },
    req: new Request(url),
    headers: new Headers(),
    node: { req: { url: pathname, headers: {} } },
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
