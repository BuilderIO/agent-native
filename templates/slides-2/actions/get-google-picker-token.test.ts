import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestUserEmail: vi.fn(),
  getAvailableGoogleDocsAccessToken: vi.fn(),
  formatGoogleOAuthError: vi.fn((error: unknown) =>
    error instanceof Error ? `formatted: ${error.message}` : "formatted",
  ),
  getGooglePickerConfig: vi.fn(),
  isGoogleDocsOAuthConfigured: vi.fn(),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("../server/lib/google-docs-access.js", () => ({
  getAvailableGoogleDocsAccessToken: mocks.getAvailableGoogleDocsAccessToken,
}));

vi.mock("../server/lib/google-docs-error.js", () => ({
  formatGoogleOAuthError: mocks.formatGoogleOAuthError,
}));

vi.mock("../server/lib/google-docs-oauth.js", () => ({
  getGooglePickerConfig: mocks.getGooglePickerConfig,
  isGoogleDocsOAuthConfigured: mocks.isGoogleDocsOAuthConfigured,
}));

import action from "./get-google-picker-token";

describe("get-google-picker-token", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestUserEmail.mockReturnValue("owner@example.com");
    mocks.isGoogleDocsOAuthConfigured.mockResolvedValue(true);
    mocks.getGooglePickerConfig.mockResolvedValue({
      apiKey: "picker-api-key",
      appId: "picker-app-id",
    });
    mocks.getAvailableGoogleDocsAccessToken.mockResolvedValue({
      accessToken: "short-lived-token",
      accountEmail: "picker@example.com",
    });
  });

  it("is restricted to the signed-in UI and not exposed to agent tools", () => {
    expect(action.uiOnly).toBe(true);
    expect(action.agentTool).toBe(false);
    expect(action.mcpTool).not.toBe(true);
  });

  it("returns the current user's token and picker config", async () => {
    await expect(action.run({})).resolves.toEqual({
      accessToken: "short-lived-token",
      accountEmail: "picker@example.com",
      apiKey: "picker-api-key",
      appId: "picker-app-id",
    });
    expect(mocks.getGooglePickerConfig).toHaveBeenCalledWith(
      "owner@example.com",
    );
    expect(mocks.getAvailableGoogleDocsAccessToken).toHaveBeenCalledWith(
      "owner@example.com",
    );
  });

  it("does not return an access token when picker config is missing", async () => {
    mocks.getGooglePickerConfig.mockResolvedValue({
      apiKey: null,
      appId: null,
    });

    await expect(action.run({})).rejects.toMatchObject({
      statusCode: 422,
      errorCode: "missing_picker_config",
    });
    expect(mocks.getAvailableGoogleDocsAccessToken).not.toHaveBeenCalled();
  });

  it("fails closed when the action has no signed-in user", async () => {
    mocks.getRequestUserEmail.mockReturnValue(undefined);

    await expect(action.run({})).rejects.toMatchObject({
      statusCode: 401,
      errorCode: "not_authenticated",
    });
    expect(mocks.isGoogleDocsOAuthConfigured).not.toHaveBeenCalled();
  });
});
