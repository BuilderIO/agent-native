import { beforeEach, describe, expect, it, vi } from "vitest";

const deps = vi.hoisted(() => ({ getUserSetting: vi.fn() }));

vi.mock("../../settings/user-settings.js", () => ({
  getUserSetting: deps.getUserSetting,
}));

import action from "./get-theme-family.js";

describe("get-theme-family action", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the default when the app has no saved setting", async () => {
    deps.getUserSetting.mockResolvedValue(null);

    await expect(
      action.run(
        {},
        {
          caller: "frontend",
          userEmail: "steve@example.test",
          appId: "sample-mail-app",
        },
      ),
    ).resolves.toEqual({
      family: "original",
      source: "default",
      appId: "sample-mail-app",
    });
    expect(deps.getUserSetting).toHaveBeenCalledWith(
      "steve@example.test",
      "theme-family:sample-mail-app",
    );
  });

  it("returns a valid saved family", async () => {
    deps.getUserSetting.mockResolvedValue({ family: "original" });

    await expect(
      action.run(
        {},
        {
          caller: "frontend",
          userEmail: "steve@example.test",
          appId: "sample-mail-app",
        },
      ),
    ).resolves.toEqual({
      family: "original",
      source: "user-setting",
      appId: "sample-mail-app",
    });
  });

  it("fails explicitly for an invalid saved value", async () => {
    deps.getUserSetting.mockResolvedValue({ family: "dark" });

    await expect(
      action.run(
        {},
        {
          caller: "frontend",
          userEmail: "steve@example.test",
          appId: "sample-mail-app",
        },
      ),
    ).rejects.toThrow("saved theme family setting is invalid");
  });
});
