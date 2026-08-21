import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getAllowedCorsOrigin } from "./cors-origins.js";

describe("getAllowedCorsOrigin", () => {
  it("allows Tauri native app origins even when an explicit allowlist is configured", () => {
    for (const origin of [
      "tauri://localhost",
      "tauri://tauri.localhost",
      "http://tauri.localhost",
      "https://tauri.localhost",
    ]) {
      expect(
        getAllowedCorsOrigin(origin, {
          allowedOrigins: ["https://app.example.com"],
        }),
      ).toBe(origin);
    }
  });

  it("does not let ordinary localhost bypass an explicit allowlist", () => {
    expect(
      getAllowedCorsOrigin("http://localhost:1420", {
        allowedOrigins: ["https://app.example.com"],
      }),
    ).toBeNull();
  });

  it("allows localhost origins when allowLocalhostWhenNoAllowlist is explicitly true", () => {
    expect(
      getAllowedCorsOrigin("http://localhost:1420", {
        allowedOrigins: [],
        allowLocalhostWhenNoAllowlist: true,
      }),
    ).toBe("http://localhost:1420");
  });

  it("honors explicit browser origins on the allowlist", () => {
    expect(
      getAllowedCorsOrigin("https://preview.example.com", {
        allowedOrigins: ["https://preview.example.com"],
      }),
    ).toBe("https://preview.example.com");
  });

  it("still rejects an origin that is genuinely absent from the allowlist", () => {
    expect(
      getAllowedCorsOrigin("https://evil.example.com", {
        allowedOrigins: ["https://app.example.com"],
      }),
    ).toBeNull();
  });

  it("admits a real Origin header when the allowlist entry has different casing", () => {
    // A legitimate origin, e.g. copy-pasted from a UI that preserves entered
    // case, must still resolve — the browser's Origin header is always
    // lowercase, but the allowlist config is operator-entered text.
    expect(
      getAllowedCorsOrigin("https://app.example.com", {
        allowedOrigins: ["HTTPS://App.Example.com"],
      }),
    ).toBe("https://app.example.com");
  });

  it("admits a real Origin header when the allowlist entry has a trailing slash", () => {
    expect(
      getAllowedCorsOrigin("https://app.example.com", {
        allowedOrigins: ["https://app.example.com/"],
      }),
    ).toBe("https://app.example.com");
  });

  it("admits a real Origin header when the allowlist entry is a bare domain with no scheme", () => {
    // CORS_ALLOWED_ORIGINS is operationally a "domain allowlist" — an
    // operator entering "app.example.com" (no scheme) is a legitimate
    // first-party origin, not a different one.
    expect(
      getAllowedCorsOrigin("https://app.example.com", {
        allowedOrigins: ["app.example.com"],
      }),
    ).toBe("https://app.example.com");
  });

  it("does not admit a different host just because the scheme was implied", () => {
    expect(
      getAllowedCorsOrigin("https://evil.example.com", {
        allowedOrigins: ["app.example.com"],
      }),
    ).toBeNull();
  });

  describe("production localhost gate (no allowlist, no explicit override)", () => {
    const savedEnv = process.env.NODE_ENV;

    beforeEach(() => {
      process.env.NODE_ENV = "production";
    });

    afterEach(() => {
      process.env.NODE_ENV = savedEnv;
    });

    it("denies localhost in production when CORS_ALLOWED_ORIGINS is unset", () => {
      for (const origin of [
        "http://localhost:3000",
        "http://localhost:1234",
        "http://127.0.0.1:8080",
      ]) {
        expect(getAllowedCorsOrigin(origin, { allowedOrigins: [] })).toBeNull();
      }
    });

    it("still allows a production-allowlisted origin in production", () => {
      expect(
        getAllowedCorsOrigin("https://app.example.com", {
          allowedOrigins: ["https://app.example.com"],
        }),
      ).toBe("https://app.example.com");
    });

    it("still allows native app (Tauri) origins in production regardless of allowlist", () => {
      for (const origin of [
        "tauri://localhost",
        "http://tauri.localhost",
        "https://tauri.localhost",
      ]) {
        expect(getAllowedCorsOrigin(origin, { allowedOrigins: [] })).toBe(
          origin,
        );
      }
    });
  });

  describe("development localhost gate (no allowlist, no explicit override)", () => {
    const savedEnv = process.env.NODE_ENV;

    beforeEach(() => {
      process.env.NODE_ENV = "development";
    });

    afterEach(() => {
      process.env.NODE_ENV = savedEnv;
    });

    it("allows localhost in development when CORS_ALLOWED_ORIGINS is unset", () => {
      for (const origin of [
        "http://localhost:3000",
        "http://localhost:1234",
        "http://127.0.0.1:8080",
      ]) {
        expect(getAllowedCorsOrigin(origin, { allowedOrigins: [] })).toBe(
          origin,
        );
      }
    });
  });
});
