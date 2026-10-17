import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  email: "owner@example.com" as string | undefined,
  stored: null as Record<string, unknown> | null,
  getUserSetting: vi.fn(),
  mutateUserSetting: vi.fn(),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => mocks.email,
}));

vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: mocks.getUserSetting,
  mutateUserSetting: mocks.mutateUserSetting,
}));

import getPrefs from "./get-slides-notification-prefs";
import updatePrefs from "./update-slides-notification-prefs";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.email = "owner@example.com";
  mocks.stored = null;
  mocks.getUserSetting.mockImplementation(async () => mocks.stored);
  mocks.mutateUserSetting.mockImplementation(
    async (
      _email: string,
      _key: string,
      updater: (
        current: Record<string, unknown> | null,
      ) => Record<string, unknown>,
    ) => {
      mocks.stored = updater(mocks.stored);
      return mocks.stored;
    },
  );
});

describe("Slides notification prefs actions", () => {
  it("reads a user with no saved prefs as opted in", async () => {
    await expect(getPrefs.run({})).resolves.toEqual({
      emailNotifications: true,
    });
    expect(mocks.getUserSetting).toHaveBeenCalledWith(
      "owner@example.com",
      "slides-user-prefs",
    );
  });

  it("reads an explicit opt-out", async () => {
    mocks.stored = { emailNotifications: false };
    await expect(getPrefs.run({})).resolves.toEqual({
      emailNotifications: false,
    });
  });

  it("writes the switch without dropping other stored prefs", async () => {
    mocks.stored = { somethingElse: "kept" };
    await expect(
      updatePrefs.run({ emailNotifications: false }),
    ).resolves.toEqual({ emailNotifications: false });
    expect(mocks.stored).toEqual({
      somethingElse: "kept",
      emailNotifications: false,
    });
  });

  it("rejects unknown fields", () => {
    const schema = (
      updatePrefs as unknown as {
        schema: { safeParse: (value: unknown) => { success: boolean } };
      }
    ).schema;
    expect(
      schema.safeParse({ emailNotifications: true, extra: 1 }).success,
    ).toBe(false);
    expect(schema.safeParse({}).success).toBe(false);
  });

  it("requires a signed-in user", async () => {
    mocks.email = undefined;
    await expect(getPrefs.run({})).rejects.toThrow("Sign in required");
    await expect(updatePrefs.run({ emailNotifications: true })).rejects.toThrow(
      "Sign in required",
    );
    expect(mocks.mutateUserSetting).not.toHaveBeenCalled();
  });
});
