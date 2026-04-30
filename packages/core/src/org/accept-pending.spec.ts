import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExecute = vi.fn();
const mockPutUserSetting = vi.fn();

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: mockExecute }),
  isLocalDatabase: () => true,
}));
vi.mock("../settings/user-settings.js", () => ({
  putUserSetting: (...args: any[]) => mockPutUserSetting(...args),
}));

import { acceptPendingInvitationsForEmail } from "./accept-pending.js";

function queueSelect(...rows: any[][]) {
  for (const r of rows) {
    mockExecute.mockResolvedValueOnce({ rows: r });
  }
}

describe("acceptPendingInvitationsForEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecute.mockResolvedValue({ rows: [] });
  });

  it("returns empty for local@localhost", async () => {
    const out = await acceptPendingInvitationsForEmail("local@localhost");
    expect(out).toEqual({ accepted: [], activeOrgId: null });
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("returns empty when no pending invitations", async () => {
    queueSelect([]);
    const out = await acceptPendingInvitationsForEmail("new@example.com");
    expect(out).toEqual({ accepted: [], activeOrgId: null });
    expect(mockPutUserSetting).not.toHaveBeenCalled();
  });

  it("inserts org_members, flips invite, sets active-org-id", async () => {
    queueSelect(
      [{ id: "inv1", orgId: "org1" }], // pending invitations
      [], // existing membership check for inv1
    );
    const out = await acceptPendingInvitationsForEmail("a@b.com");

    const calls = mockExecute.mock.calls.map((c) => c[0]);
    expect(calls[0].sql).toContain("SELECT id, org_id");
    expect(calls[1].sql).toContain("SELECT 1 FROM org_members");
    expect(calls[2].sql).toContain("INSERT INTO org_members");
    expect(calls[3].sql).toContain("UPDATE org_invitations");
    expect(out.accepted).toEqual([{ invitationId: "inv1", orgId: "org1" }]);
    expect(out.activeOrgId).toBe("org1");
    expect(mockPutUserSetting).toHaveBeenCalledWith(
      "a@b.com",
      "active-org-id",
      {
        orgId: "org1",
      },
    );
  });

  it("skips insert when already a member but still flips invitation", async () => {
    queueSelect(
      [{ id: "inv1", orgId: "org1" }],
      [{ "1": 1 }], // already a member
    );
    await acceptPendingInvitationsForEmail("a@b.com");
    const sqls = mockExecute.mock.calls.map((c) => c[0].sql);
    expect(sqls.some((s) => s.includes("INSERT INTO org_members"))).toBe(false);
    expect(sqls.some((s) => s.includes("UPDATE org_invitations"))).toBe(true);
  });

  it("handles multiple pending invites and picks most recent for active-org", async () => {
    queueSelect(
      [
        { id: "inv2", orgId: "orgB" }, // DESC order — first row is most recent
        { id: "inv1", orgId: "orgA" },
      ],
      [], // inv2 membership check
      [], // inv1 membership check
    );
    const out = await acceptPendingInvitationsForEmail("a@b.com");
    expect(out.accepted).toHaveLength(2);
    expect(out.activeOrgId).toBe("orgB");
    expect(mockPutUserSetting).toHaveBeenCalledWith(
      "a@b.com",
      "active-org-id",
      {
        orgId: "orgB",
      },
    );
  });

  it("swallows missing-table errors (template without org module)", async () => {
    mockExecute.mockRejectedValueOnce(
      new Error("no such table: org_invitations"),
    );
    const out = await acceptPendingInvitationsForEmail("a@b.com");
    expect(out).toEqual({ accepted: [], activeOrgId: null });
  });

  it("lowercases email for the WHERE clause", async () => {
    queueSelect([]);
    await acceptPendingInvitationsForEmail("Mixed@Case.com");
    const call = mockExecute.mock.calls[0][0];
    expect(call.args).toEqual(["mixed@case.com"]);
  });
});
