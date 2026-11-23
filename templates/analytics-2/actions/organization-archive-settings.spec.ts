import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  role: "admin",
  store: new Map<string, Record<string, unknown>>(),
}));

vi.mock("@agent-native/core/settings", () => ({
  getOrgSetting: async (orgId: string, key: string) =>
    m.store.get(`${orgId}:${key}`) ?? null,
  putOrgSetting: async (
    orgId: string,
    key: string,
    value: Record<string, unknown>,
  ) => {
    m.store.set(`${orgId}:${key}`, value);
  },
}));
vi.mock("../server/lib/workspace-access.js", () => ({
  requireCurrentWorkspace: async () => ({
    ownerEmail: "owner@example.test",
    orgId: "org-a",
    access: { orgRole: m.role },
  }),
  isWorkspaceAdministrator: (current: { access: { orgRole: string } }) =>
    current.access.orgRole === "owner" || current.access.orgRole === "admin",
}));

import getSettings from "./get-organization-archive-settings";
import saveSettings from "./save-organization-archive-settings";

describe("report1795030602 organization auto-archive settings", () => {
  beforeEach(() => {
    m.role = "admin";
    m.store.clear();
  });

  it("reads both cadences as disabled until an admin sets them", async () => {
    expect(await getSettings.run({})).toEqual({
      noEditArchiveCadence: null,
      noViewArchiveCadence: null,
    });
  });

  it("persists the edited and viewed cadences independently", async () => {
    await saveSettings.run({
      noEditArchiveCadence: 90,
      noViewArchiveCadence: null,
    });
    expect(await getSettings.run({})).toEqual({
      noEditArchiveCadence: 90,
      noViewArchiveCadence: null,
    });
    await saveSettings.run({
      noEditArchiveCadence: 90,
      noViewArchiveCadence: 365,
    });
    expect(await getSettings.run({})).toEqual({
      noEditArchiveCadence: 90,
      noViewArchiveCadence: 365,
    });
  });

  it("rejects cadences outside 1 to 999 days", () => {
    for (const bad of [0, 1000, 1.5, -3]) {
      expect(
        saveSettings.schema.safeParse({
          noEditArchiveCadence: bad,
          noViewArchiveCadence: null,
        }).success,
      ).toBe(false);
    }
  });

  it("refuses members", async () => {
    m.role = "member";
    await expect(
      saveSettings.run({
        noEditArchiveCadence: 30,
        noViewArchiveCadence: null,
      }),
    ).rejects.toThrow(/owners and admins/);
    expect(m.store.size).toBe(0);
  });
});
