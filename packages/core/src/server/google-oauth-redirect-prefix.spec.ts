import { afterEach, describe, expect, it } from "vitest";

import {
  isAllowedOAuthRedirectUri,
  resolveOAuthRedirectUri,
} from "./google-oauth.js";

function eventFor(
  pathname: string,
  publicPathname?: string,
  extra?: Record<string, string>,
) {
  const url = new URL(`https://gateway.test${pathname}`);
  const headers = new Headers({
    host: "gateway.test",
    "x-forwarded-proto": "https",
    ...(extra ?? {}),
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
        headers: {
          host: "gateway.test",
          "x-forwarded-proto": "https",
          ...(extra ?? {}),
        },
      },
    },
    ...(extra ? { referer: extra.referer } : {}),
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

  it("keeps the mount the request arrived under when no base-path env is set", () => {
    // A host that serves many apps from one origin cannot put one app's mount in
    // APP_BASE_PATH, so the env is empty and the request is the only evidence of it.
    // Before this, a Zoom connect on /brain-app sent https://labs.agent-native.com/
    // _agent-native/connections/oauth/zoom/callback and Zoom answered 4700 "Invalid
    // redirect url", because its registered redirect carries the app's segment.
    const event = eventFor(
      "/brain-app/_agent-native/connections/oauth/zoom/start",
    );
    process.env.AGENT_NATIVE_CONFIG_RUNTIME_FRAMEWORK_ROUTE_PREFIX = "";
    // The callback the provider must be told about is the app's own, not the origin root's.
    process.env.ZOOM_CLIENT_ID = "zoom-client";
    expect(
      resolveOAuthRedirectUri(
        event,
        "/_agent-native/connections/oauth/zoom/callback",
      ),
    ).toBe(
      "https://gateway.test/brain-app/_agent-native/connections/oauth/zoom/callback",
    );
    delete process.env.ZOOM_CLIENT_ID;
  });

  it("does not invent a mount for a request that arrived at the origin root", () => {
    const event = eventFor("/_agent-native/connections/oauth/zoom/start");
    process.env.AGENT_NATIVE_CONFIG_RUNTIME_FRAMEWORK_ROUTE_PREFIX = "";
    expect(
      resolveOAuthRedirectUri(
        event,
        "/_agent-native/connections/oauth/zoom/callback",
      ),
    ).toBe(
      "https://gateway.test/_agent-native/connections/oauth/zoom/callback",
    );
  });

  it("recovers the mount from the flow's own page when the host stripped the prefix", () => {
    process.env.AGENT_NATIVE_CONFIG_RUNTIME_FRAMEWORK_ROUTE_PREFIX = "";
    const event = eventFor(
      "/_agent-native/connections/oauth/zoom/start",
      undefined,
      {
        referer: "https://gateway.test/brain-app/app/sources/new",
      },
    );

    expect(
      resolveOAuthRedirectUri(
        event,
        "/_agent-native/connections/oauth/zoom/callback",
        { appScopedCallback: true },
      ),
    ).toBe(
      "https://gateway.test/brain-app/_agent-native/connections/oauth/zoom/callback",
    );
  });

  it("ignores a referer from another origin, and one that names no app root", () => {
    process.env.AGENT_NATIVE_CONFIG_RUNTIME_FRAMEWORK_ROUTE_PREFIX = "";
    const foreign = eventFor(
      "/_agent-native/connections/oauth/zoom/start",
      undefined,
      {
        referer: "https://elsewhere.test/brain-app/app/sources/new",
      },
    );
    expect(
      resolveOAuthRedirectUri(
        foreign,
        "/_agent-native/connections/oauth/zoom/callback",
        { appScopedCallback: true },
      ),
    ).toBe(
      "https://gateway.test/_agent-native/connections/oauth/zoom/callback",
    );

    const rootPage = eventFor(
      "/_agent-native/connections/oauth/zoom/start",
      undefined,
      {
        referer: "https://gateway.test/app/sources/new",
      },
    );
    expect(
      resolveOAuthRedirectUri(
        rootPage,
        "/_agent-native/connections/oauth/zoom/callback",
        { appScopedCallback: true },
      ),
    ).toBe(
      "https://gateway.test/_agent-native/connections/oauth/zoom/callback",
    );
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
