import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readOrgMemberRole: vi.fn(),
  getOrgSetting: vi.fn(),
  getUserSetting: vi.fn(),
  putOrgSetting: vi.fn(),
  putUserSetting: vi.fn(),
}));

vi.mock("@agent-native/core/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/server")>()),
  readOrgMemberRole: (...args: unknown[]) => mocks.readOrgMemberRole(...args),
}));

vi.mock("@agent-native/core/settings", () => ({
  getOrgSetting: mocks.getOrgSetting,
  getUserSetting: mocks.getUserSetting,
  putOrgSetting: mocks.putOrgSetting,
  putUserSetting: mocks.putUserSetting,
}));

import { runWithRequestContext } from "@agent-native/core/server";

import {
  isAppAllowedByMcpAccess,
  normalizeMcpAppAccessSettings,
  setDispatchMcpAppAccessSettings,
} from "./mcp-access-store.js";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readOrgMemberRole.mockResolvedValue("owner");
});

describe("normalizeMcpAppAccessSettings", () => {
  it("defaults to all apps when no access setting exists", () => {
    expect(normalizeMcpAppAccessSettings(null)).toEqual({
      mode: "all-apps",
      selectedAppIds: [],
      updatedAt: undefined,
      updatedBy: undefined,
    });
  });

  it("normalizes selected app ids", () => {
    expect(
      normalizeMcpAppAccessSettings({
        mode: "selected-apps",
        selectedAppIds: [" Mail ", "mail", "calendar"],
        updatedAt: "2026-05-20T12:00:00.000Z",
        updatedBy: "admin@example.test",
      }),
    ).toEqual({
      mode: "selected-apps",
      selectedAppIds: ["mail", "calendar"],
      updatedAt: "2026-05-20T12:00:00.000Z",
      updatedBy: "admin@example.test",
    });
  });
});

describe("setDispatchMcpAppAccessSettings", () => {
  it.each(["owner", "admin"])(
    "lets an organization %s change the app grants",
    async (role) => {
      mocks.readOrgMemberRole.mockResolvedValue(role);

      const result = await runWithRequestContext(
        { userEmail: "manager@example.test", orgId: "org-1" },
        () =>
          setDispatchMcpAppAccessSettings({
            mode: "selected-apps",
            selectedAppIds: ["dispatch", "analytics"],
          }),
      );

      expect(mocks.readOrgMemberRole).toHaveBeenCalledWith(
        "org-1",
        "manager@example.test",
      );
      expect(mocks.putOrgSetting).toHaveBeenCalledWith(
        "org-1",
        "dispatch-mcp-app-access",
        expect.objectContaining({
          mode: "selected-apps",
          selectedAppIds: ["dispatch", "analytics"],
          updatedBy: "manager@example.test",
        }),
      );
      expect(result.mode).toBe("selected-apps");
    },
  );

  it("rejects an organization member without changing grants", async () => {
    mocks.readOrgMemberRole.mockResolvedValue("member");

    await expect(
      runWithRequestContext(
        { userEmail: "member@example.test", orgId: "org-1" },
        () =>
          setDispatchMcpAppAccessSettings({
            mode: "all-apps",
          }),
      ),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/Only organization owners and admins/),
      statusCode: 403,
    });
    expect(mocks.putOrgSetting).not.toHaveBeenCalled();
  });

  it("caps a delegated owner before changing organization app grants", async () => {
    mocks.readOrgMemberRole.mockResolvedValue("member");

    await expect(
      runWithRequestContext(
        {
          userEmail: "owner@example.test",
          orgId: "org-1",
          a2aIdentityAssurance: "org-member",
        },
        () =>
          setDispatchMcpAppAccessSettings({
            mode: "selected-apps",
            selectedAppIds: ["analytics"],
          }),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(mocks.readOrgMemberRole).toHaveBeenCalledWith(
      "org-1",
      "owner@example.test",
    );
    expect(mocks.putOrgSetting).not.toHaveBeenCalled();
  });

  it("fails closed when organization membership cannot be verified", async () => {
    mocks.readOrgMemberRole.mockRejectedValue(
      new Error("org lookup unavailable"),
    );

    await expect(
      runWithRequestContext(
        { userEmail: "owner@example.test", orgId: "org-1" },
        () =>
          setDispatchMcpAppAccessSettings({
            mode: "all-apps",
          }),
      ),
    ).rejects.toThrow(/Only organization owners and admins/);
    expect(mocks.putOrgSetting).not.toHaveBeenCalled();
  });

  it("lets an authenticated solo user manage only their own grants", async () => {
    await runWithRequestContext({ userEmail: "solo@example.test" }, () =>
      setDispatchMcpAppAccessSettings({
        mode: "selected-apps",
        selectedAppIds: [],
      }),
    );

    expect(mocks.readOrgMemberRole).not.toHaveBeenCalled();
    expect(mocks.putUserSetting).toHaveBeenCalledWith(
      "solo@example.test",
      "dispatch-mcp-app-access",
      expect.objectContaining({
        mode: "selected-apps",
        selectedAppIds: [],
      }),
    );
  });
});

describe("isAppAllowedByMcpAccess", () => {
  it("allows every app in all-apps mode", () => {
    expect(
      isAppAllowedByMcpAccess("mail", {
        mode: "all-apps",
        selectedAppIds: [],
      }),
    ).toBe(true);
  });

  it("checks selected grants in selected-apps mode", () => {
    expect(
      isAppAllowedByMcpAccess("mail", {
        mode: "selected-apps",
        selectedAppIds: ["calendar"],
      }),
    ).toBe(false);
    expect(
      isAppAllowedByMcpAccess("calendar", {
        mode: "selected-apps",
        selectedAppIds: ["calendar"],
      }),
    ).toBe(true);
  });
});
