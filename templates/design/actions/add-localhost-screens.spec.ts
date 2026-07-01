import { describe, expect, it } from "vitest";

import {
  pathFromUrl,
  routeUrl,
  slugForPath,
  viewportFilename,
} from "./add-localhost-screens.js";

describe("add-localhost-screens URL handling", () => {
  it("places path-only flow screens relative to the connected dev server", () => {
    const baseUrl = "http://localhost:1234";

    expect(routeUrl(baseUrl, { path: "/onboarding/1" })).toBe(
      "http://localhost:1234/onboarding/1",
    );
    expect(routeUrl(baseUrl, { path: "/onboarding/2?plan=team" })).toBe(
      "http://localhost:1234/onboarding/2?plan=team",
    );
  });

  it("accepts localhost host:port shorthand for numbered screen URLs", () => {
    const baseUrl = "http://localhost:1234";
    const url = routeUrl(baseUrl, { url: "localhost:1234/onboarding/3" });

    expect(url).toBe("http://localhost:1234/onboarding/3");
    expect(pathFromUrl(baseUrl, url)).toBe("/onboarding/3");
    expect(slugForPath("localhost:1234/onboarding/3")).toBe("onboarding-3");
  });

  it("uses viewport-specific filenames for duplicate responsive screens", () => {
    expect(viewportFilename("/", 390, 844)).toBe("localhost-home-390x844.html");
  });

  it("does not expand host:port shorthand for non-loopback hosts", () => {
    expect(() =>
      routeUrl("http://localhost:1234", {
        url: "example.com:3000/onboarding/3",
      }),
    ).toThrow(/http\(s\) URL/);
  });

  it("rejects non-http URL schemes for localhost screens", () => {
    expect(() =>
      routeUrl("http://localhost:1234", { url: "mailto:test" }),
    ).toThrow(/http\(s\) URL/);
  });

  it("reports malformed route URLs as validation errors", () => {
    expect(() =>
      routeUrl("http://localhost:1234", { url: "http://[::1" }),
    ).toThrow(/Invalid localhost screen URL/);
  });
});
