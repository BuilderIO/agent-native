import { beforeEach, describe, expect, it, vi } from "vitest";

const mockExecute = vi.hoisted(() => vi.fn());
const mockOffboardMember = vi.hoisted(() => vi.fn());
const mockRevoke = vi.hoisted(() => vi.fn());

vi.mock("../../db/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../db/client.js")>()),
  getDbExec: () => ({ execute: mockExecute }),
}));
vi.mock("../../identity/offboard.js", () => ({
  offboardMember: (...args: unknown[]) => mockOffboardMember(...args),
}));
vi.mock("../federation.js", () => ({
  revokeFederatedOrganizationMemberForCurrentRequest: (...args: unknown[]) =>
    mockRevoke(...args),
}));
vi.mock("../actions.js", () => ({
  requireOrgMember: async () => ({
    email: "owner@example.test",
    orgId: "org-1",
    role: "owner",
  }),
}));

import {
  __resetProcessMemberOrgCacheForTests,
  cachedMemberships,
} from "../request-org-cache.js";
import offboardMemberAction from "./offboard-member.js";

const ctx = {
  caller: "frontend" as const,
  userEmail: "owner@example.test",
  orgId: "org-1",
};
const args = {
  email: "Member@Example.test",
  transferTo: "successor@example.test",
};

describe("offboard-member invalidates cached memberships", () => {
  beforeEach(() => {
    __resetProcessMemberOrgCacheForTests();
    vi.clearAllMocks();
    mockExecute.mockImplementation(async ({ sql }: { sql: string }) =>
      sql.includes("federation_removal_pending_at FROM org_members")
        ? { rows: [{ role: "member", federation_removal_pending_at: null }] }
        : { rows: [{ one: 1 }] },
    );
    mockOffboardMember.mockResolvedValue({ removedMemberships: 1 });
    mockRevoke.mockResolvedValue(true);
  });

  it("re-reads the removed member's memberships after the removal", async () => {
    await cachedMemberships("member@example.test", async () => [
      { orgId: "org-1" },
    ]);

    await offboardMemberAction.run(args, ctx);

    expect(mockOffboardMember).toHaveBeenCalledWith(
      expect.anything(),
      "member@example.test",
      {
        transferTo: "successor@example.test",
        orgId: "org-1",
        actorEmail: "owner@example.test",
      },
    );
    const after = vi.fn(async () => []);
    await expect(
      cachedMemberships("member@example.test", after),
    ).resolves.toEqual([]);
    expect(after).toHaveBeenCalledTimes(1);
  });

  it("re-reads memberships when the removal reports a failure after it may have committed", async () => {
    await cachedMemberships("member@example.test", async () => [
      { orgId: "org-1" },
    ]);
    mockOffboardMember.mockRejectedValueOnce(
      new Error("reply lost after commit"),
    );

    await expect(offboardMemberAction.run(args, ctx)).rejects.toThrow(
      "reply lost after commit",
    );

    const after = vi.fn(async () => []);
    await cachedMemberships("member@example.test", after);
    expect(after).toHaveBeenCalledTimes(1);
  });

  it("revokes the member at the identity authority before removing them locally", async () => {
    const order: string[] = [];
    mockRevoke.mockImplementation(async () => {
      order.push("revoke");
      return true;
    });
    mockOffboardMember.mockImplementation(async () => {
      order.push("offboard");
      return { removedMemberships: 1 };
    });

    await offboardMemberAction.run(args, ctx);

    expect(order).toEqual(["revoke", "offboard"]);
    expect(mockRevoke).toHaveBeenCalledWith({
      orgId: "org-1",
      actorEmail: "owner@example.test",
      actorRole: "owner",
      memberEmail: "member@example.test",
    });
  });

  it("offboards nothing and clears only its own marker when the revoke fails", async () => {
    mockRevoke.mockRejectedValueOnce(new Error("hub down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(offboardMemberAction.run(args, ctx)).rejects.toThrow(
      "Could not synchronize this member removal with the identity authority.",
    );

    expect(mockOffboardMember).not.toHaveBeenCalled();
    const marker = mockExecute.mock.calls.find(([input]) =>
      // raw-sql-ok: inspects the arguments of a mocked execute call; no SQL is composed or run
      input.sql.includes("SET federation_removal_pending_at = ?"),
    )?.[0];
    const rollback = mockExecute.mock.calls.find(([input]) =>
      // raw-sql-ok: inspects the arguments of a mocked execute call; no SQL is composed or run
      input.sql.includes("SET federation_removal_pending_at = NULL"),
    )?.[0];
    expect(marker?.args).toEqual([
      expect.any(Number),
      "org-1",
      "member@example.test",
    ]);
    expect(rollback?.args).toEqual([
      "org-1",
      "member@example.test",
      marker?.args[0],
    ]);
  });
});
