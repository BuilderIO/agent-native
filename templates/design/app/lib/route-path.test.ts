import { describe, expect, it } from "vitest";

import {
  isSameOriginRoutePath,
  resolveSameOriginRoutePath,
  routePathWithoutSearchParam,
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

describe("routePathWithoutSearchParam", () => {
  it("drops only the named parameter and keeps the rest of the route", () => {
    expect(
      routePathWithoutSearchParam(
        "/?agentNativeBridgeKey=1%3A2",
        "agentNativeBridgeKey",
      ),
    ).toBe("/");
    expect(
      routePathWithoutSearchParam(
        "/pricing?tab=a&agentNativeBridgeKey=1%3A2#plans",
        "agentNativeBridgeKey",
      ),
    ).toBe("/pricing?tab=a#plans");
  });

  it("returns a route without the parameter unchanged", () => {
    expect(
      routePathWithoutSearchParam("/pricing?tab=a", "agentNativeBridgeKey"),
    ).toBe("/pricing?tab=a");
    expect(routePathWithoutSearchParam("srcdoc", "agentNativeBridgeKey")).toBe(
      "srcdoc",
    );
  });
});
