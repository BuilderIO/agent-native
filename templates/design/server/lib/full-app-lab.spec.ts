import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUserLabState: vi.fn(),
  getRequestUserEmail: vi.fn<() => string | undefined>(),
}));

vi.mock("@agent-native/core/labs/server", () => ({
  getUserLabState: mocks.getUserLabState,
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

import { isFullAppBuildingEnabled } from "./full-app-lab.js";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getRequestUserEmail.mockReturnValue(undefined);
});

describe("full app building Labs gate", () => {
  it("uses the caller's user and organization to resolve inherited legacy behavior", async () => {
    mocks.getUserLabState.mockResolvedValue({
      enabled: true,
      source: "legacy",
    });

    await expect(
      isFullAppBuildingEnabled({
        userEmail: "user@example.com",
        orgId: "org_1",
      }),
    ).resolves.toBe(true);
    expect(mocks.getUserLabState).toHaveBeenCalledWith(
      "user@example.com",
      expect.objectContaining({ key: "full-app-building" }),
      { userEmail: "user@example.com", orgId: "org_1" },
    );
  });

  it("honors an explicit Off choice", async () => {
    mocks.getUserLabState.mockResolvedValue({
      enabled: false,
      source: "choice",
    });

    await expect(
      isFullAppBuildingEnabled({ userEmail: "user@example.com" }),
    ).resolves.toBe(false);
  });

  it("fails closed without an authenticated caller or readable Labs state", async () => {
    await expect(isFullAppBuildingEnabled()).rejects.toThrow(
      "requires an authenticated user",
    );
    expect(mocks.getUserLabState).not.toHaveBeenCalled();

    mocks.getRequestUserEmail.mockReturnValue("user@example.com");
    mocks.getUserLabState.mockRejectedValue(new Error("Labs unavailable"));
    await expect(isFullAppBuildingEnabled()).rejects.toThrow(
      "Labs unavailable",
    );
  });
});
