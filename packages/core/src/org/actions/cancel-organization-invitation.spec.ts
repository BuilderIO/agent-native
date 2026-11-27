import { beforeEach, describe, expect, it, vi } from "vitest";

const mockExecute = vi.hoisted(() => vi.fn());
const mockRequireOrgMember = vi.hoisted(() => vi.fn());

vi.mock("../../db/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../db/client.js")>()),
  getDbExec: () => ({ execute: mockExecute }),
}));
vi.mock("../actions.js", () => ({
  requireOrgMember: (...args: unknown[]) => mockRequireOrgMember(...args),
}));

import cancelOrganizationInvitation from "./cancel-organization-invitation.js";

const ctx = {
  caller: "tool" as const,
  userEmail: "admin@example.test",
  orgId: "org-1",
};

describe("cancel-organization-invitation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireOrgMember.mockResolvedValue({
      email: "admin@example.test",
      orgId: "org-1",
      role: "admin",
    });
    mockExecute.mockResolvedValue({ rows: [], rowsAffected: 1 });
  });

  it("is approval-gated with no persistent approval", () => {
    expect(cancelOrganizationInvitation.needsApproval).toBe(true);
    expect(cancelOrganizationInvitation.allowPersistentApproval).toBe(false);
  });

  it("cancels a pending invitation in the caller's organization", async () => {
    await expect(
      cancelOrganizationInvitation.run({ invitationId: "inv-1" }, ctx),
    ).resolves.toEqual({ id: "inv-1", status: "canceled" });
    const [{ sql, args }] = mockExecute.mock.calls[0];
    expect(sql).toContain("status = 'pending'");
    expect(args).toEqual(["inv-1", "org-1"]);
  });

  it("refuses a plain member without touching the invitation", async () => {
    mockRequireOrgMember.mockRejectedValueOnce(
      new Error("Organization admin role required."),
    );
    await expect(
      cancelOrganizationInvitation.run({ invitationId: "inv-1" }, ctx),
    ).rejects.toThrow("Organization admin role required.");
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("answers 404 when no pending invitation matches", async () => {
    mockExecute.mockResolvedValue({ rows: [], rowsAffected: 0 });
    await expect(
      cancelOrganizationInvitation.run({ invitationId: "gone" }, ctx),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
