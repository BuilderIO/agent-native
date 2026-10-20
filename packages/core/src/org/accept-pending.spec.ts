import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExecute = vi.fn();
const mockPutUserSetting = vi.fn();
const mockTrackInviteAccepted = vi.hoisted(() => vi.fn());

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: mockExecute }),
  isLocalDatabase: () => true,
}));
vi.mock("../settings/user-settings.js", () => ({
  putUserSetting: (...args: any[]) => mockPutUserSetting(...args),
}));
vi.mock("./track-invite-accepted.js", () => ({
  trackInviteAccepted: (...args: any[]) => mockTrackInviteAccepted(...args),
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
    mockExecute.mockImplementation(async (input: { sql: string }) => ({
      rows: [],
      ...(input.sql.includes("UPDATE org_invitations")
        ? { rowsAffected: 1 }
        : {}),
    }));
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
    expect(calls[0].sql).toContain("SELECT i.id, i.org_id");
    expect(calls[1].sql).toContain(
      "SELECT federation_removal_pending_at FROM org_members",
    );
    expect(calls[2].sql).toContain("INSERT INTO org_members");
    expect(calls[3].sql).toContain("UPDATE org_invitations");
    expect(out.accepted).toEqual([{ invitationId: "inv1", orgId: "org1" }]);
    expect(mockTrackInviteAccepted).toHaveBeenCalledWith({
      email: "a@b.com",
      orgId: "org1",
      role: null,
      invitedBy: "",
      federated: false,
    });
    expect(out.activeOrgId).toBe("org1");
    expect(mockPutUserSetting).toHaveBeenCalledWith(
      "a@b.com",
      "active-org-id",
      {
        orgId: "org1",
      },
    );
  });

  it("gives invite_accepted telemetry a bounded chance to finish before returning", async () => {
    queueSelect(
      [{ id: "inv1", orgId: "org1" }], // pending invitations
      [], // existing membership check for inv1
    );
    let telemetryEmitted = false;
    mockTrackInviteAccepted.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            telemetryEmitted = true;
            resolve();
          }, 20);
        }),
    );

    await acceptPendingInvitationsForEmail("a@b.com");

    expect(telemetryEmitted).toBe(true);
  });

  it("leaves an invitation pending when its app-role assignment fails", async () => {
    queueSelect(
      [{ id: "inv1", orgId: "org1", appRolesJson: "{invalid" }],
      [], // existing membership check
    );

    await expect(acceptPendingInvitationsForEmail("a@b.com")).resolves.toEqual({
      accepted: [],
      activeOrgId: null,
    });
    expect(
      mockExecute.mock.calls.some(([input]) =>
        input.sql.includes("UPDATE org_invitations SET status = 'accepted'"),
      ),
    ).toBe(false);
  });

  it("continues accepting later invitations when one app-role assignment fails", async () => {
    queueSelect(
      [
        { id: "inv1", orgId: "org1", appRolesJson: "{invalid" },
        { id: "inv2", orgId: "org2" },
      ],
      [], // inv1 membership check
      [], // inv2 membership check
    );

    const out = await acceptPendingInvitationsForEmail("a@b.com");

    expect(out.accepted).toEqual([{ invitationId: "inv2", orgId: "org2" }]);
    expect(out.activeOrgId).toBe("org2");
    const updates = mockExecute.mock.calls.filter(([input]) =>
      input.sql.includes("UPDATE org_invitations SET status = 'accepted'"),
    );
    expect(updates).toHaveLength(1);
    expect(updates[0][0].args).toEqual(["inv2"]);
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

  it("leaves an invitation pending while membership removal is unresolved", async () => {
    queueSelect(
      [{ id: "inv1", orgId: "org1" }],
      [{ federation_removal_pending_at: Date.now() }],
    );

    const out = await acceptPendingInvitationsForEmail("a@b.com");

    expect(out).toEqual({ accepted: [], activeOrgId: null });
    expect(mockExecute).toHaveBeenCalledTimes(2);
  });

  it("does not report or track an invitation another caller already accepted", async () => {
    mockExecute.mockImplementation(async ({ sql }: { sql: string }) => ({
      rows: sql.includes("FROM org_invitations i")
        ? [{ id: "inv1", orgId: "org1" }]
        : [],
      rowsAffected: sql.includes("UPDATE org_invitations") ? 0 : 1,
    }));

    await expect(acceptPendingInvitationsForEmail("a@b.com")).resolves.toEqual({
      accepted: [],
      activeOrgId: null,
    });
    expect(mockTrackInviteAccepted).not.toHaveBeenCalled();
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
      new Error('relation "org_invitations" does not exist'),
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
