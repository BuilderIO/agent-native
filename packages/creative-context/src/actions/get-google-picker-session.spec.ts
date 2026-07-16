import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveProviderApiOAuthAccessToken = vi.fn();
const resolveSecret = vi.fn();

vi.mock("@agent-native/core/provider-api", () => ({
  resolveProviderApiOAuthAccessToken,
}));
vi.mock("@agent-native/core/server", () => ({ resolveSecret }));
vi.mock("../server/context.js", () => ({
  getCreativeContext: () => ({ connectorContext: { appId: "slides" } }),
}));

const { default: action } = await import("./get-google-picker-session.js");

describe("get-google-picker-session", () => {
  beforeEach(() => {
    resolveProviderApiOAuthAccessToken.mockReset();
    resolveSecret.mockReset();
    resolveProviderApiOAuthAccessToken.mockResolvedValue({
      accessToken: "short-lived-access-token",
      accountLabel: "Work Google",
    });
    resolveSecret.mockImplementation(async (key: string) =>
      key === "GOOGLE_PICKER_API_KEY"
        ? "browser-restricted-key"
        : key === "GOOGLE_PICKER_APP_ID"
          ? "123456789"
          : null,
    );
  });

  it("is UI-only and returns a Picker session for an app-scoped connection", async () => {
    expect(action.agentTool).toBe(false);
    expect(action.toolCallable).toBe(false);
    expect(action.requiresAuth).toBe(true);

    await expect(
      action.run({ connectionId: "drive-connection" }),
    ).resolves.toEqual({
      accessToken: "short-lived-access-token",
      accountLabel: "Work Google",
      apiKey: "browser-restricted-key",
      appId: "123456789",
    });
    expect(resolveProviderApiOAuthAccessToken).toHaveBeenCalledWith(
      { provider: "google_drive", connectionId: "drive-connection" },
      expect.objectContaining({
        appId: "slides",
        providerIds: ["google_drive"],
      }),
    );
  });

  it("fails closed when the browser-restricted Picker config is absent", async () => {
    resolveSecret.mockResolvedValue(null);

    await expect(
      action.run({ connectionId: "drive-connection" }),
    ).rejects.toThrow(/Google Picker is not configured/);
  });
});
