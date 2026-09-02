import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const oauthMocks = vi.hoisted(() => ({
  deleteOAuthTokens: vi.fn(),
  getOAuthTokens: vi.fn(),
  getRequestOrgId: vi.fn(),
  listOAuthAccountsByOwner: vi.fn(),
  resolveGoogleProviderCredentialCandidatesWithReader: vi.fn(),
  resolveSecret: vi.fn(),
  runWithRequestContext: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("@agent-native/core/oauth-tokens", () => ({
  deleteOAuthTokens: oauthMocks.deleteOAuthTokens,
  getOAuthTokens: oauthMocks.getOAuthTokens,
  listOAuthAccountsByOwner: oauthMocks.listOAuthAccountsByOwner,
  saveOAuthTokens: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestOrgId: oauthMocks.getRequestOrgId,
  resolveGoogleProviderCredentialCandidatesWithReader:
    oauthMocks.resolveGoogleProviderCredentialCandidatesWithReader,
  resolveSecret: oauthMocks.resolveSecret,
  runWithRequestContext: oauthMocks.runWithRequestContext,
}));

import {
  GOOGLE_DOCS_SCOPES,
  GOOGLE_DRIVE_READONLY_SCOPE,
  getGoogleDocsAccessToken,
  hasGoogleDriveExportScope,
  hasGoogleDriveUploadScope,
} from "./google-docs-oauth.js";

beforeEach(() => {
  vi.stubGlobal("fetch", oauthMocks.fetch);
  oauthMocks.deleteOAuthTokens.mockReset();
  oauthMocks.fetch.mockReset();
  oauthMocks.resolveGoogleProviderCredentialCandidatesWithReader.mockResolvedValue(
    [{ clientId: "client-id", clientSecret: "client-secret" }],
  );
  oauthMocks.getRequestOrgId.mockReturnValue("org-1");
  oauthMocks.runWithRequestContext.mockImplementation(
    (_context: unknown, fn: () => unknown) => fn(),
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

  it("recognizes upload-capable Drive grants without treating read-only as writable", () => {
    expect(hasGoogleDriveUploadScope(GOOGLE_DRIVE_READONLY_SCOPE)).toBe(false);
    expect(
      hasGoogleDriveUploadScope("https://www.googleapis.com/auth/drive.file"),
    ).toBe(true);
    expect(
      hasGoogleDriveUploadScope("https://www.googleapis.com/auth/drive"),
    ).toBe(true);
  });

  it("selects an export-capable account for pasted Slides imports", async () => {
    await expect(
      getGoogleDocsAccessToken("owner@example.com", {
        requireDriveExportScope: true,
      }),
    ).resolves.toMatchObject({ accountEmail: "export@example.com" });
  });

  it("selects an upload-capable account after a read-only account", async () => {
    oauthMocks.listOAuthAccountsByOwner.mockImplementation(
      async (provider: string) =>
        provider === "google"
          ? [
              {
                accountId: "read-only@example.com",
                tokens: {
                  access_token: "read-only-token",
                  expiry_date: Date.now() + 60 * 60 * 1000,
                  scope: GOOGLE_DRIVE_READONLY_SCOPE,
                },
              },
              {
                accountId: "upload@example.com",
                tokens: {
                  access_token: "upload-token",
                  expiry_date: Date.now() + 60 * 60 * 1000,
                  scope: "https://www.googleapis.com/auth/drive.file",
                },
              },
            ]
          : [],
    );
    oauthMocks.getOAuthTokens.mockImplementation(
      async (_provider: string, accountId: string) => ({
        access_token: `${accountId}-token`,
        expiry_date: Date.now() + 60 * 60 * 1000,
      }),
    );

    await expect(
      getGoogleDocsAccessToken("owner@example.com", {
        requireDriveUploadScope: true,
      }),
    ).resolves.toMatchObject({ accountEmail: "upload@example.com" });
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

  it("preserves the active organization while refreshing OAuth credentials", async () => {
    const contexts: unknown[] = [];
    oauthMocks.runWithRequestContext.mockImplementation(
      (context: unknown, fn: () => unknown) => {
        contexts.push(context);
        return fn();
      },
    );
    oauthMocks.listOAuthAccountsByOwner.mockImplementation(
      async (provider: string) =>
        provider === "google"
          ? [
              {
                accountId: "upload@example.com",
                tokens: {
                  access_token: "expired-token",
                  expiry_date: Date.now() - 60_000,
                  refresh_token: "refresh-token",
                  scope: "https://www.googleapis.com/auth/drive.file",
                },
              },
            ]
          : [],
    );
    oauthMocks.getOAuthTokens.mockResolvedValue({
      access_token: "expired-token",
      expiry_date: Date.now() - 60_000,
      refresh_token: "refresh-token",
      scope: "https://www.googleapis.com/auth/drive.file",
    });
    oauthMocks.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: vi.fn().mockResolvedValue({
        access_token: "refreshed-token",
        expires_in: 3600,
      }),
    });

    await expect(
      getGoogleDocsAccessToken("owner@example.com", {
        requireDriveUploadScope: true,
      }),
    ).resolves.toMatchObject({ accountEmail: "upload@example.com" });
    expect(contexts).toContainEqual({
      userEmail: "owner@example.com",
      orgId: "org-1",
    });
  });
});
