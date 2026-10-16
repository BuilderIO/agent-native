import { beforeEach, describe, expect, it, vi } from "vitest";

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

import inviteOrganizationMember from "./invite-organization-member.js";

const ctx = {
  caller: "tool" as const,
  userEmail: "admin@example.test",
  orgId: "org-1",
};

describe("invite-organization-member", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

    expect(mockRequireOrgMember).toHaveBeenCalledWith(ctx, true);
    expect(mockInviteOne).toHaveBeenCalledWith(
      { orgId: "org-1", orgName: "Example", email: "admin@example.test" },
      "new@example.test",
      "member",
    );
  });

  it("does not invite when the caller is not an owner or admin", async () => {
    mockRequireOrgMember.mockRejectedValueOnce(
      new Error("Organization admin role required."),
    );

    await expect(
      inviteOrganizationMember.run({ email: "new@example.test" }, ctx),
    ).rejects.toThrow("Organization admin role required.");
    expect(mockInviteOne).not.toHaveBeenCalled();
  });

  it("has no role argument an agent could use to grant admin", () => {
    const parsed = inviteOrganizationMember.schema!["~standard"].validate({
      email: "new@example.test",
      role: "admin",
    });
    expect(parsed).toEqual({ value: { email: "new@example.test" } });
  });
});
