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

  it("leaves links relative when no origin is configured", () => {
    expect(declaredLinkOrigin("https://mail.example.com")).toBeUndefined();
    expect(declaredLinkOrigin(undefined)).toBeUndefined();
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

  it("uses a configured platform origin when only platform public URLs are set", () => {
    vi.stubEnv("URL", "https://mail-site.netlify.app");
    vi.stubEnv("DEPLOY_URL", "https://abc123--mail-site.netlify.app");
    vi.stubEnv("APP_URL", "http://localhost:8080");

    expect(declaredLinkOrigin("https://mail.example.com")).toBe(
      "https://mail-site.netlify.app",
    );
    expect(declaredLinkOrigin(undefined)).toBe("https://mail-site.netlify.app");
    expect(declaredLinkOrigin("http://localhost:8080")).toBe(
      "https://mail-site.netlify.app",
    );
    expect(declaredLinkOrigin("https://abc123--mail-site.netlify.app")).toBe(
      "https://mail-site.netlify.app",
    );
  });

  it("uses DEPLOY_URL only when the primary platform URL is missing", () => {
    vi.stubEnv("DEPLOY_URL", "https://abc123--mail-site.netlify.app");
    expect(declaredLinkOrigin("https://unconfigured.example.com")).toBe(
      "https://abc123--mail-site.netlify.app",
    );
  });

  it("uses a public configured origin over an inbound loopback origin", () => {
    vi.stubEnv("APP_URL", "https://mail.example.com");
    expect(declaredLinkOrigin("http://localhost:8080")).toBe(
      "https://mail.example.com",
    );
  });

  it("keeps a local server's own origin when no public origin is configured", () => {
    expect(declaredLinkOrigin("http://localhost:8080")).toBe(
      "http://localhost:8080",
    );
  });

  it("never hands a configured loopback origin to a public request", () => {
    vi.stubEnv("BETTER_AUTH_URL", "http://127.0.0.1:8080");
    expect(declaredLinkOrigin("https://tunnel.example.com")).toBeUndefined();
    expect(declaredLinkOrigin("https://bad host")).toBeUndefined();
    expect(declaredLinkOrigin("http://localhost:3000")).toBe(
      "http://localhost:3000",
    );
    expect(declaredLinkOrigin(undefined)).toBe("http://127.0.0.1:8080");
  });

  it.each([
    "APP_URL",
    "WORKSPACE_OAUTH_ORIGIN",
    "WORKSPACE_GATEWAY_URL",
    "BETTER_AUTH_TRUSTED_ORIGINS",
  ])("keeps a proxied origin configured through %s", (key) => {
    vi.stubEnv("URL", "https://mail-site.netlify.app");
    vi.stubEnv(key, "https://proxy.example.com");
    const request = new Request("http://localhost:3000/mcp", {
      headers: {
        "x-forwarded-host": "proxy.example.com",
        "x-forwarded-proto": "https",
      },
    });
    expect(declaredLinkOrigin(requestForwardedOrigin(request))).toBe(
      "https://proxy.example.com",
    );
    const other = new Request("http://localhost:3000/mcp", {
      headers: {
        "x-forwarded-host": "unconfigured.example.com",
        "x-forwarded-proto": "https",
      },
    });
    expect(declaredLinkOrigin(requestForwardedOrigin(other))).toBe(
      "https://proxy.example.com",
    );
  });
});
