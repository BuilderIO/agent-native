import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getJevContextCredentials: vi.fn(),
  getRequestUserEmail: vi.fn(),
  isJevEnabled: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getJevContextCredentials: mocks.getJevContextCredentials,
  getRequestUserEmail: mocks.getRequestUserEmail,
  isJevEnabled: mocks.isJevEnabled,
}));

import action from "./get-jev-availability";

describe("get-jev-availability action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestUserEmail.mockReturnValue("owner@example.com");
    mocks.getJevContextCredentials.mockResolvedValue({
      apiKey: undefined,
      personalApiKey: undefined,
      builderAuth: null,
    });
    mocks.isJevEnabled.mockResolvedValue(false);
  });

  it("fails closed when Jev is unavailable", async () => {
    await expect(action.run({})).resolves.toEqual({ configured: false });
  });

  it.each([
    [
      "a direct key",
      {
        apiKey: "jev-test-key",
        personalApiKey: "jev-test-key",
        builderAuth: null,
      },
    ],
    [
      "Builder entitlement",
      {
        apiKey: undefined,
        personalApiKey: undefined,
        builderAuth: { authorization: "Bearer test" },
      },
    ],
  ])("reports configured with %s", async (_label, credentials) => {
    mocks.getJevContextCredentials.mockResolvedValue(credentials);
    mocks.isJevEnabled.mockResolvedValue(true);

    await expect(action.run({})).resolves.toEqual({ configured: true });
    expect(mocks.isJevEnabled).toHaveBeenCalledWith(credentials);
  });

  it("does not look up credentials without an authenticated user", async () => {
    mocks.getRequestUserEmail.mockReturnValue(undefined);

    await expect(action.run({})).resolves.toEqual({ configured: false });
    expect(mocks.getJevContextCredentials).not.toHaveBeenCalled();
  });
});
