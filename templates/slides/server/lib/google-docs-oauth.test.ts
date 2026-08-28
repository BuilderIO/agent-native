import { beforeEach, describe, expect, it, vi } from "vitest";

const oauthMocks = vi.hoisted(() => ({
  getOAuthTokens: vi.fn(),
  listOAuthAccountsByOwner: vi.fn(),
}));

vi.mock("@agent-native/core/oauth-tokens", () => ({
  deleteOAuthTokens: vi.fn(),
  getOAuthTokens: oauthMocks.getOAuthTokens,
  listOAuthAccountsByOwner: oauthMocks.listOAuthAccountsByOwner,
  saveOAuthTokens: vi.fn(),
}));

import {
  GOOGLE_DOCS_SCOPES,
  GOOGLE_DRIVE_READONLY_SCOPE,
  getGoogleDocsAccessToken,
  hasGoogleDriveExportScope,
} from "./google-docs-oauth.js";

beforeEach(() => {
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
});
