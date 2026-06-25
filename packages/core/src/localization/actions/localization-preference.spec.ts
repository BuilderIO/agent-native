import { beforeEach, describe, expect, it, vi } from "vitest";

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
  });

  it("defaults to system when no user setting exists", async () => {
    await expect(
      getPreference.run({}, { caller: "frontend", userEmail: "a@example.com" }),
    ).resolves.toEqual({ locale: "system" });
  });

  it("stores and reads a canonical locale", async () => {
    await expect(
      setPreference.run(
        { locale: "zh" },
        { caller: "frontend", userEmail: "a@example.com" },
      ),
    ).resolves.toEqual({ locale: "zh-CN" });

    await expect(
      getPreference.run({}, { caller: "frontend", userEmail: "a@example.com" }),
    ).resolves.toEqual({ locale: "zh-CN" });
  });

  it("rejects unsupported locales", async () => {
    await expect(
      setPreference.run(
        { locale: "tlh" },
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
