import { describe, expect, it } from "vitest";

import { ApiBaseUrlError, normalizeApiBaseUrl } from "./api-base-url.js";

describe("normalizeApiBaseUrl", () => {
  it("returns an origin plus mount path without a trailing slash", () => {
    expect(normalizeApiBaseUrl("https://api.example.com")).toBe(
      "https://api.example.com",
    );
    expect(normalizeApiBaseUrl(" https://API.example.com:8443/mail// ")).toBe(
      "https://api.example.com:8443/mail",
    );
    expect(normalizeApiBaseUrl("http://localhost:3000/")).toBe(
      "http://localhost:3000",
    );
  });

  it("treats undefined and blank as same-origin", () => {
    expect(normalizeApiBaseUrl(undefined)).toBeUndefined();
    expect(normalizeApiBaseUrl("   ")).toBeUndefined();
  });

  it.each([
    [42, /must be a string/],
    ["/api", /must be an absolute http\(s\) URL/],
    ["ftp://api.example.com", /must use http or https/],
    ["https://user:pw@api.example.com", /must not contain credentials/],
    ["https://api.example.com/?", /must not contain a query string/],
    ["https://api.example.com/?a=1", /must not contain a query string/],
    ["https://api.example.com/#", /must not contain a query string/],
    ["https://api.example.com/#top", /must not contain a query string/],
  ])("rejects %j", (value, message) => {
    expect(() => normalizeApiBaseUrl(value, "test.apiBaseUrl")).toThrow(
      ApiBaseUrlError,
    );
    expect(() => normalizeApiBaseUrl(value, "test.apiBaseUrl")).toThrow(
      message,
    );
  });

  it("names the configured source in errors", () => {
    expect(() =>
      normalizeApiBaseUrl("nope", "window.config.apiBaseUrl"),
    ).toThrow(/^window\.config\.apiBaseUrl must/);
    expect(() => normalizeApiBaseUrl("nope")).toThrow(/^runtime\.apiBaseUrl/);
  });
});
