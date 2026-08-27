import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getGooglePickerConfig: vi.fn(),
  isGoogleDocsOAuthConfigured: vi.fn(),
  listGoogleDocsAccounts: vi.fn(),
  resolveManagedGoogleDriveAccount: vi.fn(),
  setResponseStatus: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  decodeOAuthState: vi.fn(),
  encodeOAuthState: vi.fn(),
  getAppUrl: vi.fn(),
  getSession: mocks.getSession,
  isElectron: vi.fn(),
  oauthCallbackResponse: vi.fn(),
  oauthErrorPage: vi.fn(),
  resolveOAuthRedirectUri: vi.fn(),
  safeReturnPath: vi.fn(),
}));

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getQuery: vi.fn(),
  setResponseStatus: mocks.setResponseStatus,
}));

vi.mock("../lib/google-docs-access.js", () => ({
  getAvailableGoogleDocsAccessToken: vi.fn(),
  resolveManagedGoogleDriveAccount: mocks.resolveManagedGoogleDriveAccount,
}));

vi.mock("../lib/google-docs-error.js", () => ({
  formatGoogleOAuthError: (error: unknown) =>
    error instanceof Error ? `formatted: ${error.message}` : "formatted",
}));

vi.mock("../lib/google-docs-oauth.js", () => ({
  disconnectGoogleDocs: vi.fn(),
  exchangeGoogleDocsCode: vi.fn(),
  getGoogleDocsAuthUrl: vi.fn(),
  getGooglePickerConfig: mocks.getGooglePickerConfig,
  hasGoogleDriveExportScope: (scope: string) =>
    scope.includes("drive.readonly"),
  isGoogleDocsOAuthConfigured: mocks.isGoogleDocsOAuthConfigured,
  listGoogleDocsAccounts: mocks.listGoogleDocsAccounts,
}));

vi.mock("./request-auth-context.js", () => ({
  withSlidesRequestContext: async (_event: unknown, callback: () => unknown) =>
    callback(),
}));

import { getGoogleDocsStatus } from "./google-docs-auth";

describe("getGoogleDocsStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ email: "owner@example.com" });
    mocks.listGoogleDocsAccounts.mockResolvedValue([
      {
        email: "picker@example.com",
        scope: "https://www.googleapis.com/auth/drive.file",
      },
    ]);
    mocks.resolveManagedGoogleDriveAccount.mockRejectedValue(
      new Error("invalid_grant"),
    );
    mocks.getGooglePickerConfig.mockResolvedValue({});
    mocks.isGoogleDocsOAuthConfigured.mockResolvedValue(true);
  });

  it("keeps a local Picker connection reconnectable when managed OAuth is stale", async () => {
    const result = await getGoogleDocsStatus({} as any);

    expect(mocks.setResponseStatus).not.toHaveBeenCalledWith(
      expect.anything(),
      500,
    );
    expect(result).toMatchObject({
      connected: true,
      googleSlidesUrlImportReady: false,
      googleSlidesUrlImportError: "formatted: invalid_grant",
    });
  });
});
