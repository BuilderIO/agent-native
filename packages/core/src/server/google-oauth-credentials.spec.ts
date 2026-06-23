import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveGoogleSignInCredentials } from "./google-oauth-credentials.js";

describe("resolveGoogleSignInCredentials", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("prefers identity-only Google sign-in credentials", () => {
    vi.stubEnv("GOOGLE_SIGN_IN_CLIENT_ID", "sign-in-client");
    vi.stubEnv("GOOGLE_SIGN_IN_CLIENT_SECRET", "sign-in-secret");
    vi.stubEnv("GOOGLE_CLIENT_ID", "product-client");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "product-secret");

    expect(resolveGoogleSignInCredentials()).toEqual({
      clientId: "sign-in-client",
      clientSecret: "sign-in-secret",
    });
  });

  it("falls back to the legacy Google client credentials", () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "product-client");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "product-secret");

    expect(resolveGoogleSignInCredentials()).toEqual({
      clientId: "product-client",
      clientSecret: "product-secret",
    });
  });

  it("requires a complete credential pair", () => {
    vi.stubEnv("GOOGLE_SIGN_IN_CLIENT_ID", "sign-in-client");
    vi.stubEnv("GOOGLE_CLIENT_ID", "product-client");

    expect(resolveGoogleSignInCredentials()).toBeNull();
  });
});
