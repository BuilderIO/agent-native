import { describe, expect, it } from "vitest";

import {
  isSameOriginRoutePath,
  resolveSameOriginRoutePath,
  routePathWithoutBridgeKey,
} from "./route-path";

const ORIGIN = "https://preview.example";

describe("same-origin route paths", () => {
  it("keeps a leading double slash inside the bound origin's pathname", () => {
    const route = resolveSameOriginRoutePath(
      ORIGIN,
      "//same-origin/path?tab=details#section",
    );

    expect(route?.origin).toBe(ORIGIN);
    expect(route?.pathname).toBe("//same-origin/path");
    expect(route?.search).toBe("?tab=details");
    expect(route?.hash).toBe("#section");
    expect(isSameOriginRoutePath("//same-origin/path")).toBe(true);
  });

  it("rejects relative, external, backslash, and whitespace-normalized routes", () => {
    for (const routePath of [
      "srcdoc",
      "https://external.example/path",
      "/\\external.example/path",
      "/\\\\external.example/path",
      "/\n/external.example/path",
      "/\t/external.example/path",
      "/\r/external.example/path",
      "/ /external.example/path",
    ]) {
      expect(resolveSameOriginRoutePath(ORIGIN, routePath)).toBeNull();
      expect(isSameOriginRoutePath(routePath)).toBe(false);
    }
  });

  it("requires a canonical origin as the route base", () => {
    expect(resolveSameOriginRoutePath(`${ORIGIN}/`, "/settings")).toBeNull();
  });

  it("rejects an invalid origin", () => {
    expect(resolveSameOriginRoutePath("not a URL", "/settings")).toBeNull();
  });
});

describe("routePathWithoutBridgeKey", () => {
  it("drops only the bridge key and keeps the rest of the route", () => {
    expect(routePathWithoutBridgeKey("/?agentNativeBridgeKey=1%3A2")).toBe("/");
    expect(
      routePathWithoutBridgeKey(
        "/pricing?tab=a&agentNativeBridgeKey=1%3A2#plans",
      ),
    ).toBe("/pricing?tab=a#plans");
  });

  it("keeps the remaining query bytes exactly as the frame reported them", () => {
    expect(
      routePathWithoutBridgeKey(
        "/sign?q=a%20b&agentNativeBridgeKey=1%3A2&sig=x+y%2F",
      ),
    ).toBe("/sign?q=a%20b&sig=x+y%2F");
  });

  it("drops a percent-encoded key name, since the bridge decodes names", () => {
    expect(
      routePathWithoutBridgeKey("/docs?%61gentNativeBridgeKey=1%3A2&tab=a"),
    ).toBe("/docs?tab=a");
    expect(
      routePathWithoutBridgeKey("/docs?agentNative%42ridgeKey=1%3A2"),
    ).toBe("/docs");
    expect(routePathWithoutBridgeKey("/docs?%zz=1&tab=a")).toBe(
      "/docs?%zz=1&tab=a",
    );
  });

  it("returns a route without the key unchanged, including a ? inside the hash", () => {
    expect(routePathWithoutBridgeKey("/pricing?tab=a")).toBe("/pricing?tab=a");
    expect(routePathWithoutBridgeKey("/docs#agentNativeBridgeKey=1?x")).toBe(
      "/docs#agentNativeBridgeKey=1?x",
    );
  });
});
