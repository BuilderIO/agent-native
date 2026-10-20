import { beforeEach, describe, expect, it, vi } from "vitest";

const getRequestUserEmailMock = vi.hoisted(() => vi.fn());
const getUserSettingMock = vi.hoisted(() => vi.fn());
const mutateUserSettingMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/action", () => ({
  defineAction: (entry: unknown) => entry,
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: getRequestUserEmailMock,
}));

vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: getUserSettingMock,
  mutateUserSetting: mutateUserSettingMock,
}));

import getPrefs from "./get-assets-notification-prefs.js";
import updatePrefs from "./update-assets-notification-prefs.js";

type Runnable = { run: (args: unknown) => Promise<unknown> };

describe("assets notification prefs actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRequestUserEmailMock.mockReturnValue("member@example.test");
  });

  it("reads an unset preference as opted in", async () => {
    getUserSettingMock.mockResolvedValue(null);
    await expect((getPrefs as Runnable).run({})).resolves.toEqual({
      emailNotifications: true,
    });
    expect(getUserSettingMock).toHaveBeenCalledWith(
      "member@example.test",
      "assets-user-prefs",
    );
  });

  it("reads a stored opt-out", async () => {
    getUserSettingMock.mockResolvedValue({ emailNotifications: false });
    await expect((getPrefs as Runnable).run({})).resolves.toEqual({
      emailNotifications: false,
    });
  });

  it("merges the switch into the stored record", async () => {
    mutateUserSettingMock.mockImplementation(
      async (
        _email: string,
        _key: string,
        updater: (current: Record<string, unknown> | null) => unknown,
      ) => updater({ emailNotifications: true, other: "kept" }),
    );
    await expect(
      (updatePrefs as Runnable).run({ emailNotifications: false }),
    ).resolves.toEqual({ emailNotifications: false });
    const updater = mutateUserSettingMock.mock.calls[0]?.[2] as (
      current: Record<string, unknown> | null,
    ) => Record<string, unknown>;
    expect(updater({ emailNotifications: true, other: "kept" })).toEqual({
      emailNotifications: false,
      other: "kept",
    });
    expect(updater(null)).toEqual({ emailNotifications: false });
  });

  it("requires a signed-in user", async () => {
    getRequestUserEmailMock.mockReturnValue(undefined);
    await expect((getPrefs as Runnable).run({})).rejects.toThrow(
      "Sign in required",
    );
    await expect(
      (updatePrefs as Runnable).run({ emailNotifications: true }),
    ).rejects.toThrow("Sign in required");
    expect(mutateUserSettingMock).not.toHaveBeenCalled();
  });

  it("rejects unknown fields", () => {
    const schema = (
      updatePrefs as unknown as {
        schema: { safeParse: (v: unknown) => { success: boolean } };
      }
    ).schema;
    expect(schema.safeParse({ emailNotifications: true }).success).toBe(true);
    expect(
      schema.safeParse({ emailNotifications: true, extra: 1 }).success,
    ).toBe(false);
  });
});
