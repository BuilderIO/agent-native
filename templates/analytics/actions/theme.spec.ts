import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, Record<string, unknown>>();
let email = "a@example.com";

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => email,
  getRequestOrgId: () => "org-1",
}));

vi.mock("@agent-native/core/org", () => ({ getOrgContext: vi.fn() }));

vi.mock("@agent-native/core/settings", () => ({
  getOrgSetting: async (org: string, key: string) =>
    store.get(`o:${org}:${key}`) ?? null,
  putOrgSetting: async (
    org: string,
    key: string,
    v: Record<string, unknown>,
  ) => {
    store.set(`o:${org}:${key}`, v);
  },
  getUserSetting: async (e: string, key: string) =>
    store.get(`u:${e}:${key}`) ?? null,
  putUserSetting: async (
    e: string,
    key: string,
    v: Record<string, unknown>,
  ) => {
    store.set(`u:${e}:${key}`, v);
  },
  deleteOrgSetting: vi.fn(),
  deleteSetting: vi.fn(),
  deleteUserSetting: vi.fn(),
  listOrgSettings: vi.fn(),
  listSettingsByPrefix: vi.fn(),
}));

const { default: getTheme } = await import("./get-theme");
const { default: setTheme } = await import("./set-theme");

describe("analytics theme preference", () => {
  beforeEach(() => {
    store.clear();
    email = "a@example.com";
  });

  it("does not leak one user's theme choice to teammates in the same org", async () => {
    await setTheme.run({ theme: "light" } as never);
    email = "rachel@example.com";
    expect(await getTheme.run({} as never)).toEqual({ theme: "dark" });
  });

  it("returns the user's own saved theme", async () => {
    await setTheme.run({ theme: "light" } as never);
    expect(await getTheme.run({} as never)).toEqual({ theme: "light" });
  });
});
