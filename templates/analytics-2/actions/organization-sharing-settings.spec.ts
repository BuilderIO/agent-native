import {
  ForbiddenError,
  getShareableResource,
} from "@agent-native/core/sharing";
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
    orgId: "org-sharing",
    access: { orgRole: m.role },
  }),
  isWorkspaceAdministrator: (current: { access: { orgRole: string } }) =>
    current.access.orgRole === "owner" || current.access.orgRole === "admin",
}));

import "../server/db/index.js";
import getSettings from "./get-organization-sharing-settings";
import saveSettings from "./save-organization-sharing-settings";

describe("row 464 organization sharing settings", () => {
  beforeEach(() => {
    m.role = "admin";
    m.store.clear();
  });

  it("reads default sharing settings and honest platform capabilities", async () => {
    expect(await getSettings.run({})).toEqual({
      settings: {
        allowPublicSharing: false,
        allowWorkspaceSharing: true,
        allowGuestCreation: false,
      },
      capabilities: {
        publicSharingSupported: false,
        guestSharingSupported: false,
      },
      canEdit: true,
    });
  });

  it("persists workspace sharing toggle changes and reads them back", async () => {
    const disabled = await saveSettings.run({
      allowPublicSharing: false,
      allowWorkspaceSharing: false,
      allowGuestCreation: false,
    });
    expect(disabled.settings.allowWorkspaceSharing).toBe(false);
    expect((await getSettings.run({})).settings).toEqual({
      allowPublicSharing: false,
      allowWorkspaceSharing: false,
      allowGuestCreation: false,
    });

    const enabled = await saveSettings.run({
      allowPublicSharing: false,
      allowWorkspaceSharing: true,
      allowGuestCreation: false,
    });
    expect(enabled.settings.allowWorkspaceSharing).toBe(true);
    expect((await getSettings.run({})).settings.allowWorkspaceSharing).toBe(
      true,
    );
  });

  it("refuses non-administrator members", async () => {
    m.role = "member";
    expect((await getSettings.run({})).canEdit).toBe(false);
    await expect(
      saveSettings.run({
        allowPublicSharing: false,
        allowWorkspaceSharing: false,
        allowGuestCreation: false,
      }),
    ).rejects.toThrow(/owners and admins/);
    expect(m.store.size).toBe(0);
  });

  it("refuses enabling unsupported public web or external guest sharing", async () => {
    await expect(
      saveSettings.run({
        allowPublicSharing: true,
        allowWorkspaceSharing: true,
        allowGuestCreation: false,
      }),
    ).rejects.toThrow(/Public web sharing is unavailable/);

    await expect(
      saveSettings.run({
        allowPublicSharing: false,
        allowWorkspaceSharing: true,
        allowGuestCreation: true,
      }),
    ).rejects.toThrow(/External guest sharing is unavailable/);
    expect(m.store.size).toBe(0);
  });

  it("enforces allowWorkspaceSharing via assertSharingChange on projects and collections", async () => {
    const projectReg = getShareableResource("analytics-project");
    const collectionReg = getShareableResource("analytics-collection");
    expect(projectReg?.assertSharingChange).toBeTypeOf("function");
    expect(collectionReg?.assertSharingChange).toBeTypeOf("function");

    await expect(
      projectReg?.assertSharingChange?.({
        resource: { orgId: "org-sharing" },
        change: { kind: "visibility", visibility: "org" },
      }),
    ).resolves.toBeUndefined();

    await saveSettings.run({
      allowPublicSharing: false,
      allowWorkspaceSharing: false,
      allowGuestCreation: false,
    });

    await expect(
      projectReg?.assertSharingChange?.({
        resource: { orgId: "org-sharing" },
        change: { kind: "visibility", visibility: "org" },
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await expect(
      collectionReg?.assertSharingChange?.({
        resource: { orgId: "org-sharing" },
        change: { kind: "visibility", visibility: "org" },
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await expect(
      projectReg?.assertSharingChange?.({
        resource: { orgId: "org-sharing" },
        change: { kind: "visibility", visibility: "private" },
      }),
    ).resolves.toBeUndefined();

    await expect(
      projectReg?.assertSharingChange?.({
        resource: { orgId: "org-sharing" },
        change: { kind: "grant" },
      }),
    ).resolves.toBeUndefined();
  });
});
