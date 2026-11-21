import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  defineAppConfig,
  resetAppConfigForTests,
} from "../app-config/index.js";

const mockGetOrgSettingEntry = vi.hoisted(() => vi.fn());
vi.mock("../settings/org-settings.js", () => ({
  getOrgSettingEntry: (...args: unknown[]) => mockGetOrgSettingEntry(...args),
}));

import {
  canRoleInviteInOrg,
  readOrgInvitationPolicy,
  readOrgInvitationPolicyForDisplay,
} from "./invitation-policy.js";

describe("readOrgInvitationPolicy stored flag", () => {
  beforeEach(() => {
    mockGetOrgSettingEntry.mockReset();
    resetAppConfigForTests();
    defineAppConfig({ access: { memberInvitations: "org-setting" } });
  });

  it("defaults to members may invite only when the setting is truly missing", async () => {
    mockGetOrgSettingEntry.mockResolvedValue({ found: false });
    await expect(readOrgInvitationPolicy("org-1")).resolves.toEqual({
      mode: "org-setting",
      onlyAdminsCanInvite: false,
    });
    expect(mockGetOrgSettingEntry).toHaveBeenCalledWith(
      "org-1",
      "only-admins-can-invite",
    );
  });

  it.each([
    [true, true],
    [false, false],
  ])("honors a stored boolean %s", async (flag, expected) => {
    mockGetOrgSettingEntry.mockResolvedValue({
      found: true,
      value: { onlyAdminsCanInvite: flag },
    });
    await expect(readOrgInvitationPolicy("org-1")).resolves.toMatchObject({
      onlyAdminsCanInvite: expected,
    });
  });

  it.each([
    ["present JSON null", null],
    ["empty object", {}],
    ["missing flag", { other: true }],
    ["string flag", { onlyAdminsCanInvite: "false" }],
    ["numeric flag", { onlyAdminsCanInvite: 0 }],
    ["null flag", { onlyAdminsCanInvite: null }],
    ["string record", "false"],
    ["array", []],
    ["number", 1],
  ])("rejects a present corrupt record: %s", async (_name, value) => {
    mockGetOrgSettingEntry.mockResolvedValue({ found: true, value });
    await expect(readOrgInvitationPolicy("org-1")).rejects.toThrow(
      /Invalid only-admins-can-invite/,
    );
    await expect(canRoleInviteInOrg("org-1", "member")).rejects.toThrow();
  });

  it("treats syntactically invalid stored JSON as a corrupt record", async () => {
    mockGetOrgSettingEntry.mockRejectedValue(
      new SyntaxError("Unexpected token"),
    );
    await expect(readOrgInvitationPolicy("org-1")).rejects.toThrow(
      /Invalid only-admins-can-invite/,
    );
    await expect(readOrgInvitationPolicyForDisplay("org-1")).resolves.toEqual({
      mode: "org-setting",
      onlyAdminsCanInvite: true,
      invalid: true,
    });
  });

  it("does not mask an unreadable store as a corrupt record", async () => {
    mockGetOrgSettingEntry.mockRejectedValue(new Error("db down"));
    await expect(readOrgInvitationPolicyForDisplay("org-1")).rejects.toThrow(
      "db down",
    );
  });

  it("never lets a corrupt record affect owners or admins", async () => {
    mockGetOrgSettingEntry.mockResolvedValue({ found: true, value: {} });
    await expect(canRoleInviteInOrg("org-1", "admin")).resolves.toBe(true);
    expect(mockGetOrgSettingEntry).not.toHaveBeenCalled();
  });
});
