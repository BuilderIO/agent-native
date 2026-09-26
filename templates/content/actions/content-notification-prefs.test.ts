import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  stored: null as Record<string, unknown> | null,
  getUserSetting: vi.fn(),
  mutateUserSetting: vi.fn(),
}));

vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: mocks.getUserSetting,
  mutateUserSetting: mocks.mutateUserSetting,
}));

import getPrefs from "./get-content-notification-prefs";
import updatePrefs from "./update-content-notification-prefs";

type RunContext = Parameters<typeof getPrefs.run>[1];
const owner = { userEmail: "owner@example.test" } as RunContext;

beforeEach(() => {
  vi.clearAllMocks();
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

describe("Content notification prefs actions", () => {
  it("reads a user with no saved prefs as opted in", async () => {
    await expect(getPrefs.run({}, owner)).resolves.toEqual({
      emailNotifications: true,
    });
    expect(mocks.getUserSetting).toHaveBeenCalledWith(
      "owner@example.test",
      "content-user-prefs",
    );
  });

  it("reads an explicit opt-out", async () => {
    mocks.stored = { emailNotifications: false };
    await expect(getPrefs.run({}, owner)).resolves.toEqual({
      emailNotifications: false,
    });
  });

  it("writes the switch without dropping other stored prefs", async () => {
    mocks.stored = { somethingElse: "kept" };
    await expect(
      updatePrefs.run({ emailNotifications: false }, owner),
    ).resolves.toEqual({ emailNotifications: false });
    expect(mocks.mutateUserSetting).toHaveBeenCalledWith(
      "owner@example.test",
      "content-user-prefs",
      expect.any(Function),
    );
    expect(mocks.stored).toEqual({
      somethingElse: "kept",
      emailNotifications: false,
    });
  });

  it("rejects unknown or missing fields", () => {
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
    const signedOut = {} as RunContext;
    await expect(getPrefs.run({}, signedOut)).rejects.toThrow(
      "Not authenticated.",
    );
    await expect(
      updatePrefs.run({ emailNotifications: true }, signedOut),
    ).rejects.toThrow("Not authenticated.");
    expect(mocks.mutateUserSetting).not.toHaveBeenCalled();
  });
});
