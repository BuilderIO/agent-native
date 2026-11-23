import { describe, expect, it, vi } from "vitest";

import type { DbExec } from "../db/client.js";

const mockApplyRoles = vi.hoisted(() => vi.fn());
vi.mock("./app-roles.js", () => ({
  applyInvitationAppRoles: (...args: unknown[]) => mockApplyRoles(...args),
}));

import { acceptLiveInvitation } from "./invitation-acceptance.js";

const invitation = {
  invitationId: "inv-1",
  orgId: "org-1",
  email: "Newcomer@Example.test",
  memberId: "m-1",
  joinMember: true,
  updatedBy: "inviter@example.test",
};

interface Locked {
  pending?: boolean;
  role?: string;
  appRolesJson?: string | null;
  removed?: boolean;
  member?: boolean;
  removalPending?: boolean;
}

function dbWith(state: Locked) {
  const execute = vi.fn(async (query: { sql: string }) => {
    const sql = query.sql;
    if (sql.includes("FROM org_invitations") && sql.includes("FOR UPDATE"))
      return {
        rows:
          state.pending === false
            ? []
            : [
                {
                  role: state.role ?? "member",
                  appRolesJson: state.appRolesJson ?? '{"clips":["viewer"]}',
                },
              ],
        rowsAffected: 0,
      };
    if (sql.includes("status = 'deactivated'"))
      return { rows: state.removed ? [{ 1: 1 }] : [], rowsAffected: 0 };
    if (sql.includes("FROM org_members") && sql.includes("FOR UPDATE"))
      return {
        rows: state.member
          ? [
              {
                federation_removal_pending_at: state.removalPending
                  ? Date.now()
                  : null,
              },
            ]
          : [],
        rowsAffected: 0,
      };
    return { rows: [], rowsAffected: 1 };
  });
  const transaction = vi.fn(async (fn: (tx: DbExec) => Promise<boolean>) =>
    fn({ execute } as unknown as DbExec),
  );
  const sqls = () => execute.mock.calls.map(([q]) => q.sql);
  return { db: { execute, transaction } as unknown as DbExec, execute, sqls };
}

describe("acceptLiveInvitation", () => {
  it("fails closed when interactive transactions are unavailable", async () => {
    const execute = vi.fn();
    await expect(
      acceptLiveInvitation({ execute } as unknown as DbExec, invitation),
    ).rejects.toThrow("Interactive transactions are unavailable");
    expect(execute).not.toHaveBeenCalled();
  });

  it("joins with the locked role, grants roles and flips the invitation", async () => {
    mockApplyRoles.mockClear();
    const { db, sqls, execute } = dbWith({ role: "admin" });
    await expect(acceptLiveInvitation(db, invitation)).resolves.toBe(true);
    const all = sqls();
    expect(all[0]).toContain("pg_advisory_xact_lock");
    expect(all[1]).toContain("FOR UPDATE");
    expect(all.some((q) => q.includes("INSERT INTO org_members"))).toBe(true);
    expect(all[all.length - 1]).toContain(
      "UPDATE org_invitations SET status = 'accepted'",
    );
    const insert = execute.mock.calls
      .map(([q]) => q as { sql: string; args: unknown[] })
      .find((q) => q.sql.includes("INSERT INTO org_members"));
    expect(insert?.args[3]).toBe("admin");
    expect(mockApplyRoles).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "newcomer@example.test",
        appRolesJson: '{"clips":["viewer"]}',
      }),
      expect.anything(),
    );
  });

  it("binds the invitation to the lowercased address when rechecking", async () => {
    const { db, execute } = dbWith({});
    await acceptLiveInvitation(db, invitation);
    const check = execute.mock.calls
      .map(([q]) => q as { sql: string; args: unknown[] })
      .find((q) => q.sql.includes("FROM org_invitations"));
    expect(check?.sql).toContain("LOWER(email) = ? AND status = 'pending'");
    expect(check?.args).toEqual(["inv-1", "org-1", "newcomer@example.test"]);
  });

  it.each([
    [
      "the invitation is no longer pending for this address",
      { pending: false },
    ],
    ["an admin removal marker exists", { removed: true }],
    [
      "a membership removal is unresolved",
      { member: true, removalPending: true },
    ],
  ] as Array<[string, Locked]>)("writes nothing when %s", async (_n, state) => {
    mockApplyRoles.mockClear();
    const { db, sqls } = dbWith(state);
    await expect(acceptLiveInvitation(db, invitation)).resolves.toBe(false);
    expect(sqls().some((q) => q.includes("INSERT INTO org_members"))).toBe(
      false,
    );
    expect(sqls().some((q) => q.includes("UPDATE org_invitations"))).toBe(
      false,
    );
    expect(mockApplyRoles).not.toHaveBeenCalled();
  });

  it("refuses to grant roles to an existing member removed since it was read", async () => {
    mockApplyRoles.mockClear();
    const { db } = dbWith({ member: false });
    await expect(
      acceptLiveInvitation(db, { ...invitation, joinMember: false }),
    ).resolves.toBe(false);
    expect(mockApplyRoles).not.toHaveBeenCalled();
  });

  it("completes for an existing member without inserting again", async () => {
    const { db, sqls } = dbWith({ member: true });
    await expect(
      acceptLiveInvitation(db, { ...invitation, joinMember: false }),
    ).resolves.toBe(true);
    expect(sqls().some((q) => q.includes("INSERT INTO org_members"))).toBe(
      false,
    );
  });
});
