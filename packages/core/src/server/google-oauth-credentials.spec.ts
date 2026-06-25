import { afterEach, describe, expect, it } from "vitest";

import {
  resolveGoogleProviderCredentialCandidates,
  resolveGoogleSignInCredentials,
} from "./google-oauth-credentials.js";

describe("resolveGoogleSignInCredentials", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("prefers the dedicated sign-in Google OAuth client", () => {
    process.env.GOOGLE_SIGN_IN_CLIENT_ID = "sign-in-client";
    process.env.GOOGLE_SIGN_IN_CLIENT_SECRET = "sign-in-secret";
    process.env.GOOGLE_CLIENT_ID = "provider-client";
    process.env.GOOGLE_CLIENT_SECRET = "provider-secret";

    expect(resolveGoogleSignInCredentials()).toEqual({
      clientId: "sign-in-client",
      clientSecret: "sign-in-secret",
    });
  });

  it("falls back to the legacy Google client pair", () => {
    delete process.env.GOOGLE_SIGN_IN_CLIENT_ID;
    delete process.env.GOOGLE_SIGN_IN_CLIENT_SECRET;
    process.env.GOOGLE_CLIENT_ID = "legacy-client";
    process.env.GOOGLE_CLIENT_SECRET = "legacy-secret";

    expect(resolveGoogleSignInCredentials()).toEqual({
      clientId: "legacy-client",
      clientSecret: "legacy-secret",
    });
  });

  it("does not mix an incomplete sign-in pair with a provider secret", () => {
    process.env.GOOGLE_SIGN_IN_CLIENT_ID = "sign-in-client";
    delete process.env.GOOGLE_SIGN_IN_CLIENT_SECRET;
    process.env.GOOGLE_CLIENT_ID = "provider-client";
    process.env.GOOGLE_CLIENT_SECRET = "provider-secret";

    expect(resolveGoogleSignInCredentials()).toEqual({
      clientId: "provider-client",
      clientSecret: "provider-secret",
    });
  });

  it("returns primary then legacy provider credentials for refresh fallback", () => {
    process.env.GOOGLE_CLIENT_ID = "provider-client";
    process.env.GOOGLE_CLIENT_SECRET = "provider-secret";
    process.env.GOOGLE_LEGACY_CLIENT_ID = "legacy-client";
    process.env.GOOGLE_LEGACY_CLIENT_SECRET = "legacy-secret";

    expect(resolveGoogleProviderCredentialCandidates()).toEqual([
      { clientId: "provider-client", clientSecret: "provider-secret" },
      { clientId: "legacy-client", clientSecret: "legacy-secret" },
    ]);
  });

  it("dedupes legacy provider credentials when they match the primary client", () => {
    process.env.GOOGLE_CLIENT_ID = "provider-client";
    process.env.GOOGLE_CLIENT_SECRET = "provider-secret";
    process.env.GOOGLE_LEGACY_CLIENT_ID = "provider-client";
    process.env.GOOGLE_LEGACY_CLIENT_SECRET = "legacy-secret";

    expect(resolveGoogleProviderCredentialCandidates()).toEqual([
      { clientId: "provider-client", clientSecret: "provider-secret" },
    ]);
  });
});
