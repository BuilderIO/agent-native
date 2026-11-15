// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { startMobileGoogleAuth } from "./mobile-auth.js";

describe("startMobileGoogleAuth", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete window.__agentNativeMobileOAuth;
  });

  it("returns null in a browser without the mobile OAuth bridge", () => {
    expect(startMobileGoogleAuth("/auth/google", "/inbox")).toBeNull();
  });

  it("returns null outside a browser", () => {
    vi.stubGlobal("window", undefined);
    expect(startMobileGoogleAuth("/auth/google", "/inbox")).toBeNull();
  });

  it("hands the bridge an absolute start URL carrying the return path", async () => {
    const start = vi.fn(async (_url: string) => "signed-in" as const);
    window.__agentNativeMobileOAuth = { start };
    const result = startMobileGoogleAuth(
      "/_agent-native/google/auth-url?mode=login&return=/old",
      "/inbox?tab=1",
    );
    await expect(result).resolves.toBe("signed-in");
    expect(start).toHaveBeenCalledTimes(1);
    const url = new URL(start.mock.calls[0]![0]);
    expect(url.origin).toBe(window.location.origin);
    expect(url.pathname).toBe("/_agent-native/google/auth-url");
    expect(url.searchParams.get("mode")).toBe("login");
    expect(url.searchParams.getAll("return")).toEqual(["/inbox?tab=1"]);
  });

  it("passes the bridge's own outcome through", async () => {
    window.__agentNativeMobileOAuth = { start: async () => "cancelled" };
    await expect(
      startMobileGoogleAuth("https://auth.example.test/start", "/"),
    ).resolves.toBe("cancelled");
  });
});
