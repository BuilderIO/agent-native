import { describe, expect, it } from "vitest";

import {
  isSameOriginRoutePath,
  resolveSameOriginRoutePath,
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
