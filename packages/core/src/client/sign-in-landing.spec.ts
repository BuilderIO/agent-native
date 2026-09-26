import { afterEach, describe, expect, it, vi } from "vitest";

import { signInLandingLoader } from "./sign-in-landing.js";

describe("signInLandingLoader", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("document-redirects to the mounted app sign-in page", () => {
    vi.stubEnv("VITE_APP_BASE_PATH", "/account-expert");

    const response = signInLandingLoader();

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/account-expert/sign-in");
    expect(response.headers.get("X-Remix-Reload-Document")).toBe("true");
  });
});
