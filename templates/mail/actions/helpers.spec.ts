import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getClientsWithErrors: vi.fn(),
  getDbExec: vi.fn(),
  getRequestUserEmail: vi.fn(),
  gmailListLabels: vi.fn(),
}));

vi.mock("dotenv", () => ({ config: vi.fn() }));
vi.mock("@agent-native/core/db", () => ({ getDbExec: mocks.getDbExec }));
vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
}));
vi.mock("../server/lib/google-api.js", () => ({
  gmailListLabels: mocks.gmailListLabels,
}));
vi.mock("../server/lib/google-auth.js", () => ({
  getClientsWithErrors: mocks.getClientsWithErrors,
}));

import { getAccessTokens } from "./helpers.js";

describe("action Gmail token resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("includes owner-scoped managed clients alongside OAuth clients", async () => {
    mocks.getClientsWithErrors.mockResolvedValue({
      clients: [
        {
          email: "oauth@example.com",
          accessToken: "oauth-token",
          refreshToken: "oauth-refresh",
        },
        {
          email: "managed@example.com",
          accessToken: "managed-token",
          refreshToken: "",
        },
      ],
      errors: [],
    });

    await expect(getAccessTokens("owner@example.com")).resolves.toEqual([
      { email: "oauth@example.com", accessToken: "oauth-token" },
      { email: "managed@example.com", accessToken: "managed-token" },
    ]);
    expect(mocks.getClientsWithErrors).toHaveBeenCalledWith(
      "owner@example.com",
    );
    expect(mocks.getRequestUserEmail).not.toHaveBeenCalled();
  });

  it("surfaces an account lookup failure instead of returning no accounts", async () => {
    mocks.getClientsWithErrors.mockResolvedValue({
      clients: [],
      errors: [{ email: "workspace", error: "credential lookup failed" }],
    });

    await expect(getAccessTokens("owner@example.com")).rejects.toThrow(
      "Unable to resolve a connected Gmail account",
    );
  });
});
