import { beforeEach, describe, expect, it, vi } from "vitest";

const settings = vi.hoisted(() => new Map<string, Record<string, unknown>>());

vi.mock("@agent-native/core/settings", () => {
  const mutate =
    (scope: string) =>
    async (
      id: string,
      key: string,
      update: (current: Record<string, unknown> | null) => any,
    ) => {
      const next = await update(settings.get(`${scope}:${id}:${key}`) ?? null);
      settings.set(`${scope}:${id}:${key}`, next);
      return next;
    };
  return {
    getUserSetting: async (email: string, key: string) =>
      settings.get(`u:${email}:${key}`) ?? null,
    getOrgSetting: async (orgId: string, key: string) =>
      settings.get(`o:${orgId}:${key}`) ?? null,
    mutateUserSetting: mutate("u"),
    mutateOrgSetting: mutate("o"),
    putUserSetting: async () => undefined,
  };
});

import {
  installBuiltinDashboardOnce,
  listBuiltinDashboards,
  loadBuiltinDashboard,
} from "./builtin-dashboards";

const ADMIN = { email: "admin@example.test", orgId: "org-1" };
const MEMBER = { email: "member@example.test", orgId: "org-1" };

describe("Content built-in", () => {
  beforeEach(() => settings.clear());

  it("is listed for the whole org once collection installs it", async () => {
    const listedIds = async () =>
      (await listBuiltinDashboards(MEMBER)).map((dashboard) => dashboard.id);
    expect(await listedIds()).not.toContain("content-view");

    await installBuiltinDashboardOnce(ADMIN, "content-view");

    expect(await listedIds()).toContain("content-view");
    const content = await loadBuiltinDashboard("content-view", MEMBER);
    expect(content?.title).toBe("Content");
  });
});
