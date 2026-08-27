import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCredentialContext: vi.fn(),
  getGoogleDocsAccessToken: vi.fn(),
  getSlidesProviderApiRuntime: vi.fn(),
  resolveWorkspaceConnectionForApp: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getCredentialContext: mocks.getCredentialContext,
}));
vi.mock("@agent-native/core/workspace-connections", () => ({
  resolveWorkspaceConnectionForApp: mocks.resolveWorkspaceConnectionForApp,
}));
vi.mock("./google-docs-oauth.js", () => ({
  getGoogleDocsAccessToken: mocks.getGoogleDocsAccessToken,
}));
vi.mock("./provider-api.js", () => ({
  getSlidesProviderApiRuntime: mocks.getSlidesProviderApiRuntime,
}));

import { getAvailableGoogleDocsAccessToken } from "./google-docs-access.js";

beforeEach(() => {
  mocks.getCredentialContext.mockReturnValue({
    userEmail: "owner@example.com",
    orgId: "org-1",
  });
  mocks.getGoogleDocsAccessToken.mockResolvedValue(null);
  mocks.resolveWorkspaceConnectionForApp.mockResolvedValue({
    available: true,
  });
  mocks.getSlidesProviderApiRuntime.mockReturnValue({
    resolveOAuthAccessToken: vi.fn().mockResolvedValue({
      accountId: "managed@example.com",
      accessToken: "managed-token",
    }),
  });
});

describe("Google Docs access resolution", () => {
  it("keeps Picker imports on a drive.file local account", async () => {
    mocks.getGoogleDocsAccessToken.mockResolvedValue({
      accountEmail: "picker@example.com",
      accessToken: "picker-token",
    });

    await expect(
      getAvailableGoogleDocsAccessToken("owner@example.com"),
    ).resolves.toMatchObject({ accountEmail: "picker@example.com" });
    expect(mocks.getGoogleDocsAccessToken).toHaveBeenCalledWith(
      "owner@example.com",
      {},
    );
    expect(mocks.resolveWorkspaceConnectionForApp).not.toHaveBeenCalled();
  });

  it("requires export scope for pasted URL imports", async () => {
    await expect(
      getAvailableGoogleDocsAccessToken("owner@example.com", {
        requireDriveExportScope: true,
      }),
    ).resolves.toMatchObject({ accountEmail: "managed@example.com" });
    expect(mocks.getGoogleDocsAccessToken).toHaveBeenCalledWith(
      "owner@example.com",
      { requireDriveExportScope: true },
    );
  });

  it("falls back to the managed Google Drive connection", async () => {
    await expect(
      getAvailableGoogleDocsAccessToken("owner@example.com"),
    ).resolves.toEqual({
      accountEmail: "managed@example.com",
      accessToken: "managed-token",
    });
    expect(mocks.resolveWorkspaceConnectionForApp).toHaveBeenCalledWith({
      appId: "slides",
      provider: "google_drive",
      requireConnected: true,
    });
  });
});
