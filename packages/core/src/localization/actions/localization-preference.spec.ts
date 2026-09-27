import { beforeEach, describe, expect, it, vi } from "vitest";

import { ACTION_CHAT_UI_RECORD_CHANGE_RENDERER } from "../../action-ui.js";
import { putUserSetting } from "../../settings/user-settings.js";
import getPreference from "./get-localization-preference.js";
import setPreference from "./set-localization-preference.js";

const store = vi.hoisted(() => ({
  settings: new Map<string, Record<string, unknown>>(),
}));

vi.mock("../../settings/user-settings.js", () => ({
  getUserSetting: vi.fn(async (email: string, key: string) => {
    return store.settings.get(`${email}:${key}`) ?? null;
  }),
  putUserSetting: vi.fn(
    async (email: string, key: string, value: Record<string, unknown>) => {
      store.settings.set(`${email}:${key}`, value);
    },
  ),
}));

describe("localization preference actions", () => {
  beforeEach(() => {
    store.settings.clear();
    vi.clearAllMocks();
  });

  it("defaults to system when no user setting exists", async () => {
    await expect(
      getPreference.run({}, { caller: "frontend", userEmail: "a@example.com" }),
    ).resolves.toEqual({ locale: "system", timezone: "system" });
  });

  it("stores and reads a canonical locale", async () => {
    const result = await setPreference.run(
      { locale: "zh" },
      { caller: "frontend", userEmail: "a@example.com" },
    );

    expect(result).toEqual({
      locale: "zh-CN",
      timezone: "system",
      change: {
        verb: "updated",
        kind: "preference",
        title: "简体中文",
      },
    });
    expect(setPreference.chatUI?.renderer).toBe(
      ACTION_CHAT_UI_RECORD_CHANGE_RENDERER,
    );
    expect(setPreference.chatUI?.when?.({}, result)).toBe(true);
    expect(setPreference.chatUI?.projectResult?.({}, result)).toEqual({
      change: result.change,
    });

    await expect(
      getPreference.run({}, { caller: "frontend", userEmail: "a@example.com" }),
    ).resolves.toEqual({ locale: "zh-CN", timezone: "system" });
  });

  it("keeps unchanged preferences as ordinary action results", async () => {
    store.settings.set("a@example.com:localization", {
      locale: "es-ES",
      timezone: "America/Los_Angeles",
    });

    const result = await setPreference.run(
      { locale: "es-ES", timezone: "America/Los_Angeles" },
      { caller: "tool", userEmail: "a@example.com" },
    );

    expect(result).toEqual({
      locale: "es-ES",
      timezone: "America/Los_Angeles",
    });
    expect(putUserSetting).not.toHaveBeenCalled();
    expect(setPreference.chatUI?.when?.({}, result)).toBe(false);
  });

  it("rejects malformed locales", async () => {
    await expect(
      setPreference.run(
        { locale: "not_a_locale" },
        { caller: "frontend", userEmail: "a@example.com" },
      ),
    ).rejects.toThrow("Unsupported locale");
  });

  it("requires an authenticated user", async () => {
    await expect(getPreference.run({}, { caller: "frontend" })).rejects.toThrow(
      "Not authenticated",
    );
  });
});
