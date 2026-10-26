import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestUserEmail: vi.fn(),
  resolveManagedGoogleDriveAccount: vi.fn(),
  formatGoogleOAuthError: vi.fn((error: unknown) =>
    error instanceof Error ? `formatted: ${error.message}` : "formatted",
  ),
  getGooglePickerConfig: vi.fn(),
  getGoogleOAuthClientId: vi.fn(),
  isGoogleDocsOAuthConfigured: vi.fn(),
  listGoogleDocsAccounts: vi.fn(),
  resolveGoogleSlidesExportAvailability: vi.fn(),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("../server/lib/google-docs-access.js", () => ({
  resolveManagedGoogleDriveAccount: mocks.resolveManagedGoogleDriveAccount,
}));

vi.mock("../server/lib/google-docs-error.js", () => ({
  formatGoogleOAuthError: mocks.formatGoogleOAuthError,
}));

vi.mock("../server/lib/google-docs-oauth.js", () => ({
  getGooglePickerConfig: mocks.getGooglePickerConfig,
  getGoogleOAuthClientId: mocks.getGoogleOAuthClientId,
  hasGoogleDriveExportScope: (scope?: string) =>
    Boolean(scope?.includes("drive.readonly")),
  hasGoogleDriveUploadScope: (scope?: string) =>
    Boolean(scope?.includes("drive.file")),
  isGoogleDocsOAuthConfigured: mocks.isGoogleDocsOAuthConfigured,
  listGoogleDocsAccounts: mocks.listGoogleDocsAccounts,
}));

vi.mock("../server/lib/google-slides-export-availability.js", () => ({
  resolveGoogleSlidesExportAvailability:
    mocks.resolveGoogleSlidesExportAvailability,
}));

import action from "./get-google-docs-status";

const frontendCtx = { caller: "frontend" } as never;

describe("get-google-docs-status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestUserEmail.mockReturnValue("owner@example.com");
    mocks.listGoogleDocsAccounts.mockResolvedValue([
      {
        email: "picker@example.com",
        scope: "https://www.googleapis.com/auth/drive.file",
      },
    ]);
    mocks.resolveManagedGoogleDriveAccount.mockResolvedValue(null);
    mocks.getGooglePickerConfig.mockResolvedValue({
      apiKey: "picker-api-key",
      appId: "picker-app-id",
    });
    mocks.isGoogleDocsOAuthConfigured.mockResolvedValue(true);
    mocks.getGoogleOAuthClientId.mockResolvedValue("client-id");
    mocks.resolveGoogleSlidesExportAvailability.mockResolvedValue({
      available: true,
    });
  });

  it("is restricted to the signed-in UI and not exposed to agent tools", () => {
    expect(action.uiOnly).toBe(true);
    expect(action.agentTool).toBe(false);
    expect(action.mcpTool).not.toBe(true);
  });

  it("uses the current user and request origin to build status", async () => {
    await expect(
      action.run({ origin: "https://slides.example.com" }, frontendCtx),
    ).resolves.toMatchObject({
      configured: true,
      connected: true,
      googleSlidesUrlImportReady: false,
      googleSlidesExport: { available: true },
      pickerConfigured: true,
      accounts: [{ email: "picker@example.com" }],
    });

    expect(mocks.listGoogleDocsAccounts).toHaveBeenCalledWith(
      "owner@example.com",
    );
    expect(mocks.getGooglePickerConfig).toHaveBeenCalledWith(
      "owner@example.com",
    );
    expect(mocks.isGoogleDocsOAuthConfigured).toHaveBeenCalledWith(
      "owner@example.com",
    );
    expect(mocks.resolveGoogleSlidesExportAvailability).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: "https://slides.example.com",
        hasUploadCapableAccount: true,
      }),
    );
  });

  it("fails closed when the action has no signed-in user", async () => {
    mocks.getRequestUserEmail.mockReturnValue(undefined);

    await expect(
      action.run({ origin: "https://slides.example.com" }, frontendCtx),
    ).rejects.toMatchObject({
      statusCode: 401,
      errorCode: "not_authenticated",
    });
    expect(mocks.listGoogleDocsAccounts).not.toHaveBeenCalled();
  });
});
