import { beforeEach, describe, expect, it, vi } from "vitest";

const mockExecute = vi.hoisted(() => vi.fn());
const mockOffboardMember = vi.hoisted(() => vi.fn());

vi.mock("../../db/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../db/client.js")>()),
  getDbExec: () => ({ execute: mockExecute }),
}));
vi.mock("../../identity/offboard.js", () => ({
  offboardMember: (...args: unknown[]) => mockOffboardMember(...args),
}));
vi.mock("../actions.js", () => ({
  requireOrgMember: async () => ({
    email: "owner@example.test",
    orgId: "org-1",
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
});
