// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import {
  authSessionReplayOptions,
  isAuthSessionReplayPathname,
} from "./entry.js";

describe("auth session replay gate", () => {
  it("matches only exact signup and login shell paths under the app base path", () => {
    for (const pathname of [
      "/app",
      "/app/login",
      "/app/signup",
      "/app/sign-in",
      "/app/_agent-native/sign-in",
    ]) {
      expect(isAuthSessionReplayPathname(pathname, "/app/")).toBe(true);
    }

    for (const pathname of [
      "/app/signup/continue",
      "/app/_agent-native/auth/reset",
      "/app/_agent-native/auth/callback",
      "/apps/login",
      "/login",
    ]) {
      expect(isAuthSessionReplayPathname(pathname, "/app")).toBe(false);
    }

    expect(isAuthSessionReplayPathname("/login", "")).toBe(true);
    expect(isAuthSessionReplayPathname("/login/", "")).toBe(false);
  });

  it("requires the explicit opt-in and the first-party Analytics public key", () => {
    expect(
      authSessionReplayOptions(
        { authSessionReplay: true },
        "/signup",
        "",
        "clips.agent-native.com",
      ),
    ).toBeNull();
    expect(
      authSessionReplayOptions(
        {
          agentNativeAnalyticsPublicKey: "anpk_test",
          authSessionReplay: false,
        },
        "/signup",
        "",
        "clips.agent-native.com",
      ),
    ).toBeNull();
  });

  it("keeps anonymous auth capture private and marks it without identity", () => {
    const options = authSessionReplayOptions(
      {
        agentNativeAnalyticsPublicKey: " anpk_test ",
        agentNativeAnalyticsEndpoint:
          "https://analytics.agent-native.com/track",
        authSessionReplay: true,
      },
      "/app/sign-in",
      "/app",
      "beta.clips.agent-native.com",
      "?email=qa@example.test",
    );

    expect(options).toMatchObject({
      publicKey: "anpk_test",
      endpoint: "https://beta.analytics.agent-native.com/api/analytics/replay",
      requireSignedInUser: false,
      maskAllInputs: true,
      recordCanvas: false,
      recordCrossOriginIframes: false,
      inlineImages: false,
      collectFonts: false,
      console: false,
      network: false,
      extraProperties: { capture_context: "pre_auth" },
    });
    expect(options?.blockSelector).toContain("#magic-link-success-email");
    expect(options?.blockSelector).toContain("#verify-email");
    expect(options?.blockSelector).toContain("#google-debug");
    expect(options?.blockSelector).toContain("#google-err");
    expect(options?.blockSelector).toContain(".auth-page .msg");
    expect(options?.blockSelector).toContain(".an-block");
    expect(options?.blockSelector).toContain("[data-an-block]");
    expect(options?.sensitiveQueryParams).toContain("email");
    expect(options?.sensitiveQueryParams).toContain("token");
    expect(options?.sensitiveQueryParams).toContain("c");
    expect(options?.sensitiveQueryParams).toContain("invitation_token");
    expect(options?.extraProperties).toEqual({ capture_context: "pre_auth" });
    expect(options?.allowUrls).toBeUndefined();
    expect(
      options?.blockUrls?.[0]?.("https://clips.agent-native.com/signup"),
    ).toBe(false);
    expect(
      options?.blockUrls?.[0]?.(
        "https://clips.agent-native.com/_agent-native/auth/email-link/landing?token=opaque",
      ),
    ).toBe(true);
  });

  it("derives a replay path from a relative Analytics endpoint", () => {
    const options = authSessionReplayOptions(
      {
        agentNativeAnalyticsPublicKey: "anpk_test",
        agentNativeAnalyticsEndpoint: "/api/analytics/track",
        authSessionReplay: true,
      },
      "/signup",
      "",
      "clips.agent-native.com",
    );

    expect(options?.endpoint).toBe("/api/analytics/replay");
  });

  it("skips invalid optional replay without blocking auth hydration", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const options = authSessionReplayOptions(
      {
        agentNativeAnalyticsPublicKey: "anpk_test",
        agentNativeAnalyticsEndpoint: "https://[",
        authSessionReplay: true,
      },
      "/signup",
      "",
      "clips.agent-native.com",
    );

    expect(options).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      "Skipping optional auth session replay because the configured Analytics endpoint is invalid.",
    );
    warn.mockRestore();
  });

  it("does not start on auth callback material or a hash", () => {
    const config = {
      agentNativeAnalyticsPublicKey: "anpk_test",
      authSessionReplay: true,
    };

    for (const [search, hash] of [
      ["?token=secret", ""],
      ["?code=secret", ""],
      ["?state=opaque", ""],
      ["?c=opaque", ""],
      ["?accessToken=secret", ""],
      ["?callbackURL=https%3A%2F%2Fexample.test", ""],
      ["", "#access_token=secret"],
    ]) {
      expect(
        authSessionReplayOptions(
          config,
          "/sign-in",
          "",
          "clips.agent-native.com",
          search,
          hash,
        ),
      ).toBeNull();
    }
  });
});
