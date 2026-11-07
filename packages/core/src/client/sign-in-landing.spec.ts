import { afterEach, describe, expect, it, vi } from "vitest";

import { signInLandingLoader } from "./sign-in-landing.js";

describe("signInLandingLoader", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns a router-relative document redirect for a mounted app", () => {
    vi.stubEnv("VITE_APP_BASE_PATH", "/account-expert");

    const response = signInLandingLoader();

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/sign-in");
    expect(response.headers.get("X-Remix-Reload-Document")).toBe("true");
  });

  it("leaves the root route available when it is the configured app home", () => {
    expect(signInLandingLoader("/")).toBeNull();
  });
});
