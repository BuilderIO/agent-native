import { afterEach, describe, expect, it } from "vitest";

import {
  GOOGLE_PRIMARY_PROVIDER_CREDENTIAL_KEYS,
  resolveGoogleProviderCredentialCandidates,
  resolveGoogleProviderCredentialCandidatesWithReader,
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

  it("uses scoped credentials before the injected legacy environment fallback", async () => {
    const scoped = new Map([
      ["GOOGLE_CLIENT_ID", "scoped-client"],
      ["GOOGLE_CLIENT_SECRET", "scoped-secret"],
    ]);
    const fallback = new Map([
      ["GOOGLE_CLIENT_ID", "environment-client"],
      ["GOOGLE_CLIENT_SECRET", "environment-secret"],
      ["GOOGLE_LEGACY_CLIENT_ID", "legacy-client"],
      ["GOOGLE_LEGACY_CLIENT_SECRET", "legacy-secret"],
    ]);

    await expect(
      resolveGoogleProviderCredentialCandidatesWithReader({
        readCredential: async (key) => scoped.get(key),
        fallbackReadCredential: (key) => fallback.get(key),
      }),
    ).resolves.toEqual([
      { clientId: "scoped-client", clientSecret: "scoped-secret" },
      { clientId: "legacy-client", clientSecret: "legacy-secret" },
    ]);
  });

  it("does not mix incomplete injected credentials with a fallback pair", async () => {
    await expect(
      resolveGoogleProviderCredentialCandidatesWithReader({
        readCredential: (key) =>
          key === "GOOGLE_CLIENT_ID" ? "incomplete-scoped-client" : null,
        fallbackReadCredential: (key) =>
          key === "GOOGLE_CLIENT_ID"
            ? "environment-client"
            : key === "GOOGLE_CLIENT_SECRET"
              ? "environment-secret"
              : null,
        credentialKeyPairs: [GOOGLE_PRIMARY_PROVIDER_CREDENTIAL_KEYS],
      }),
    ).resolves.toEqual([
      { clientId: "environment-client", clientSecret: "environment-secret" },
    ]);
  });

  it("fails closed when a bare reader has no complete primary credential pair", async () => {
    await expect(
      resolveGoogleProviderCredentialCandidatesWithReader({
        readCredential: () => null,
        credentialKeyPairs: [GOOGLE_PRIMARY_PROVIDER_CREDENTIAL_KEYS],
      }),
    ).resolves.toEqual([]);
  });
});
