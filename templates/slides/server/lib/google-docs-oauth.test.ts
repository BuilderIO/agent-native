import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const oauthMocks = vi.hoisted(() => ({
  deleteOAuthTokens: vi.fn(),
  getOAuthTokens: vi.fn(),
  listOAuthAccountsByOwner: vi.fn(),
  resolveGoogleProviderCredentialCandidatesWithReader: vi.fn(),
  resolveSecret: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("@agent-native/core/oauth-tokens", () => ({
  deleteOAuthTokens: oauthMocks.deleteOAuthTokens,
  getOAuthTokens: oauthMocks.getOAuthTokens,
  listOAuthAccountsByOwner: oauthMocks.listOAuthAccountsByOwner,
  saveOAuthTokens: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  resolveGoogleProviderCredentialCandidatesWithReader:
    oauthMocks.resolveGoogleProviderCredentialCandidatesWithReader,
  resolveSecret: oauthMocks.resolveSecret,
  runWithRequestContext: (_context: unknown, fn: () => unknown) => fn(),
}));

import {
  GOOGLE_DOCS_SCOPES,
  GOOGLE_DRIVE_READONLY_SCOPE,
  getGoogleDocsAccessToken,
  hasGoogleDriveExportScope,
} from "./google-docs-oauth.js";

beforeEach(() => {
  vi.stubGlobal("fetch", oauthMocks.fetch);
  oauthMocks.deleteOAuthTokens.mockReset();
  oauthMocks.fetch.mockReset();
  oauthMocks.resolveGoogleProviderCredentialCandidatesWithReader.mockResolvedValue(
    [{ clientId: "client-id", clientSecret: "client-secret" }],
  );
  oauthMocks.listOAuthAccountsByOwner.mockImplementation(
    async (provider: string) =>
      provider === "google"
        ? [
            {
              accountId: "picker@example.com",
              tokens: {
                access_token: "picker-token",
                expiry_date: Date.now() + 60 * 60 * 1000,
                scope: "https://www.googleapis.com/auth/drive.file",
              },
            },
            {
              accountId: "export@example.com",
              tokens: {
                access_token: "export-token",
                expiry_date: Date.now() + 60 * 60 * 1000,
                scope: GOOGLE_DRIVE_READONLY_SCOPE,
              },
            },
          ]
        : [],
  );
  oauthMocks.getOAuthTokens.mockImplementation(
    async (_provider: string, accountId: string) =>
      accountId === "export@example.com"
        ? {
            access_token: "export-token",
            expiry_date: Date.now() + 60 * 60 * 1000,
            scope: GOOGLE_DRIVE_READONLY_SCOPE,
          }
        : {
            access_token: "picker-token",
            expiry_date: Date.now() + 60 * 60 * 1000,
            scope: "https://www.googleapis.com/auth/drive.file",
          },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Google Slides URL import OAuth scopes", () => {
  it("requests Drive read access for pasted presentation links", () => {
    expect(GOOGLE_DOCS_SCOPES).toContain(GOOGLE_DRIVE_READONLY_SCOPE);
  });

  it("recognizes export-capable Drive grants", () => {
    expect(hasGoogleDriveExportScope(GOOGLE_DRIVE_READONLY_SCOPE)).toBe(true);
    expect(
      hasGoogleDriveExportScope("https://www.googleapis.com/auth/drive"),
    ).toBe(true);
    expect(
      hasGoogleDriveExportScope("https://www.googleapis.com/auth/drive.file"),
    ).toBe(false);
    expect(hasGoogleDriveExportScope()).toBe(false);
  });

  it("selects an export-capable account for pasted Slides imports", async () => {
    await expect(
      getGoogleDocsAccessToken("owner@example.com", {
        requireDriveExportScope: true,
      }),
    ).resolves.toMatchObject({ accountEmail: "export@example.com" });
  });

  it("does not delete the user grant when the OAuth client is invalid", async () => {
    oauthMocks.listOAuthAccountsByOwner.mockImplementation(
      async (provider: string) =>
        provider === "google"
          ? [
              {
                accountId: "export@example.com",
                tokens: {
                  access_token: "expired-token",
                  expiry_date: Date.now() - 60_000,
                  refresh_token: "refresh-token",
                  scope: GOOGLE_DRIVE_READONLY_SCOPE,
                },
              },
            ]
          : [],
    );
    oauthMocks.getOAuthTokens.mockResolvedValue({
      access_token: "expired-token",
      expiry_date: Date.now() - 60_000,
      refresh_token: "refresh-token",
      scope: GOOGLE_DRIVE_READONLY_SCOPE,
    });
    oauthMocks.fetch.mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      json: vi.fn().mockResolvedValue({
        error: "invalid_client",
        error_description: "The OAuth client was not found.",
      }),
    });

    await expect(getGoogleDocsAccessToken("owner@example.com")).rejects.toThrow(
      "The OAuth client was not found.",
    );
    expect(oauthMocks.deleteOAuthTokens).not.toHaveBeenCalled();
  });
});
