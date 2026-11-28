import { beforeEach, describe, expect, it, vi } from "vitest";

import { runWithRequestContext } from "../../server/request-context.js";

const mockExecute = vi.hoisted(() => vi.fn());
const mockInviteOne = vi.hoisted(() => vi.fn());
const mockRequireOrgMember = vi.hoisted(() => vi.fn());

vi.mock("../../db/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../db/client.js")>()),
  getDbExec: () => ({ execute: mockExecute }),
}));
vi.mock("../handlers.js", () => ({
  inviteOne: (...args: unknown[]) => mockInviteOne(...args),
}));
vi.mock("../actions.js", () => ({
  requireOrgMember: (...args: unknown[]) => mockRequireOrgMember(...args),
}));
const mockGetOrgSetting = vi.hoisted(() => vi.fn());
vi.mock("../../settings/org-settings.js", () => ({
  getOrgSetting: (...args: unknown[]) => mockGetOrgSetting(...args),
  getOrgSettingEntry: async (...args: unknown[]) => {
    const value = await mockGetOrgSetting(...args);
    return value == null ? { found: false } : { found: true, value };
  },
}));

import {
  defineAppConfig,
  resetAppConfigForTests,
} from "../../app-config/index.js";
import inviteOrganizationMember from "./invite-organization-member.js";

const ctx = {
  caller: "tool" as const,
  userEmail: "admin@example.test",
  orgId: "org-1",
};

describe("invite-organization-member", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAppConfigForTests();
    mockGetOrgSetting.mockResolvedValue(null);
    mockRequireOrgMember.mockResolvedValue({
      email: "admin@example.test",
      orgId: "org-1",
      role: "admin",
    });
    mockExecute.mockResolvedValue({ rows: [{ name: "Example" }] });
    mockInviteOne.mockResolvedValue({
      id: "invite-1",
      email: "new@example.test",
      role: "member",
      status: "pending",
      emailSent: true,
    });
  });

  it("asks for approval on every call", () => {
    expect(inviteOrganizationMember.needsApproval).toBe(true);
    expect(inviteOrganizationMember.allowPersistentApproval).toBe(false);
  });

  it("invites through the shared invitation path as a member", async () => {
    await expect(
      inviteOrganizationMember.run({ email: "new@example.test" }, ctx),
    ).resolves.toMatchObject({ email: "new@example.test", role: "member" });

    expect(mockRequireOrgMember).toHaveBeenCalledWith(ctx);
    expect(mockInviteOne).toHaveBeenCalledWith(
      {
        orgId: "org-1",
        orgName: "Example",
        email: "admin@example.test",
        role: "admin",
      },
      "new@example.test",
      "member",
    );
  });

  it("does not invite when the caller is not an org member", async () => {
    mockRequireOrgMember.mockRejectedValueOnce(
      new Error("You are not a member of the active organization."),
    );

    await expect(
      inviteOrganizationMember.run({ email: "new@example.test" }, ctx),
    ).rejects.toThrow("You are not a member");
    expect(mockInviteOne).not.toHaveBeenCalled();
  });

  describe("plain members", () => {
    beforeEach(() => {
      mockRequireOrgMember.mockResolvedValue({
        email: "member@example.test",
        orgId: "org-1",
        role: "member",
      });
    });

    it("are refused by default", async () => {
      await expect(
        inviteOrganizationMember.run({ email: "new@example.test" }, ctx),
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(mockInviteOne).not.toHaveBeenCalled();
    });

    it("may invite when the app opted in and the org allows it", async () => {
      defineAppConfig({ access: { memberInvitations: "org-setting" } });
      await inviteOrganizationMember.run({ email: "new@example.test" }, ctx);
      expect(mockGetOrgSetting).toHaveBeenCalledWith(
        "org-1",
        "only-admins-can-invite",
      );
      expect(mockInviteOne).toHaveBeenCalledWith(
        {
          orgId: "org-1",
          orgName: "Example",
          email: "member@example.test",
          role: "member",
        },
        "new@example.test",
        "member",
      );
    });

    it.each(["members", "org-setting"] as const)(
      "are refused for a delegated org-member identity under %s",
      async (mode) => {
        defineAppConfig({ access: { memberInvitations: mode } });
        await expect(
          runWithRequestContext(
            {
              userEmail: "member@example.test",
              orgId: "org-1",
              a2aIdentityAssurance: "org-member",
            },
            () =>
              inviteOrganizationMember.run({ email: "new@example.test" }, ctx),
          ),
        ).rejects.toMatchObject({ statusCode: 403 });
        expect(mockInviteOne).not.toHaveBeenCalled();
      },
    );

    it("are refused once an admin restricts invitations", async () => {
      defineAppConfig({ access: { memberInvitations: "org-setting" } });
      mockGetOrgSetting.mockResolvedValue({ onlyAdminsCanInvite: true });
      await expect(
        inviteOrganizationMember.run({ email: "new@example.test" }, ctx),
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(mockInviteOne).not.toHaveBeenCalled();
    });
  });

  it("has no role argument an agent could use to grant admin", () => {
    const parsed = inviteOrganizationMember.schema?.["~standard"].validate({
      email: "new@example.test",
      role: "admin",
    });
    expect(parsed).toEqual({ value: { email: "new@example.test" } });
  });
});
