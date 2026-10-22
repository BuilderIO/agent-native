import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  declaredLinkOrigin,
  EXPLICIT_PUBLIC_ORIGIN_ENV_KEYS,
  requestForwardedOrigin,
  WORKSPACE_GATEWAY_ORIGIN_ENV_KEYS,
} from "./origin-allowlist.js";

describe("requestForwardedOrigin", () => {
  it("derives the origin from x-forwarded-proto/x-forwarded-host", () => {
    const request = new Request(
      "http://127.0.0.1:3000/_agent-native/auth/ba/sign-up/email",
      {
        method: "POST",
        headers: {
          "x-forwarded-proto": "https",
          "x-forwarded-host": "cloud-branch.example.com",
        },
      },
    );
    expect(requestForwardedOrigin(request)).toBe(
      "https://cloud-branch.example.com",
    );
  });

  it("falls back to the Host header when no x-forwarded-host is set", () => {
    const request = new Request("http://127.0.0.1:3000/sign-up", {
      method: "POST",
      headers: {
        "x-forwarded-proto": "https",
        host: "cloud-branch.example.com",
      },
    });
    expect(requestForwardedOrigin(request)).toBe(
      "https://cloud-branch.example.com",
    );
  });

  it("falls back to the request URL's own scheme and host when nothing is forwarded", () => {
    const request = new Request("http://localhost:3000/sign-up", {
      method: "POST",
    });
    expect(requestForwardedOrigin(request)).toBe("http://localhost:3000");
  });

  it("never echoes the client-supplied Origin header", () => {
    const request = new Request("http://127.0.0.1:3000/sign-up", {
      method: "POST",
      headers: { origin: "https://evil.example.com" },
    });
    expect(requestForwardedOrigin(request)).not.toBe(
      "https://evil.example.com",
    );
    expect(requestForwardedOrigin(request)).toBe("http://127.0.0.1:3000");
  });

  it("returns undefined for an undefined request", () => {
    expect(requestForwardedOrigin(undefined)).toBeUndefined();
  });
});

describe("declaredLinkOrigin", () => {
  beforeEach(() => {
    for (const key of [
      ...EXPLICIT_PUBLIC_ORIGIN_ENV_KEYS,
      ...WORKSPACE_GATEWAY_ORIGIN_ENV_KEYS,
      "BETTER_AUTH_TRUSTED_ORIGINS",
    ]) {
      vi.stubEnv(key, "");
    }
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("keeps the request's origin when the app declares none", () => {
    expect(declaredLinkOrigin("https://mail.example.com")).toBe(
      "https://mail.example.com",
    );
  });

  it("sends a link only to an origin the app declares", () => {
    vi.stubEnv("APP_URL", "https://mail.example.com/");
    vi.stubEnv("BETTER_AUTH_TRUSTED_ORIGINS", "https://mail.example.org");
    vi.stubEnv("URL", "https://mail-site.netlify.app");

    expect(declaredLinkOrigin("https://mail.example.org")).toBe(
      "https://mail.example.org",
    );
    expect(declaredLinkOrigin("https://mail-site.netlify.app")).toBe(
      "https://mail-site.netlify.app",
    );
    // A forwarded host the app doesn't declare gets the app's own origin.
    expect(declaredLinkOrigin("https://attacker.example")).toBe(
      "https://mail.example.com",
    );
    expect(declaredLinkOrigin(undefined)).toBe("https://mail.example.com");
  });

  it("keeps a local server's own origin", () => {
    vi.stubEnv("APP_URL", "https://mail.example.com");
    expect(declaredLinkOrigin("http://localhost:8080")).toBe(
      "http://localhost:8080",
    );
  });
});
