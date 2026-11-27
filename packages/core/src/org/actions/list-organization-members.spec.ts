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

import listOrganizationMembers from "./list-organization-members.js";

const ctx = {
  caller: "tool" as const,
  userEmail: "admin@example.test",
  orgId: "org-1",
};
const args = { limit: 50, offset: 0 };

describe("list-organization-members", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecute.mockImplementation(async ({ sql }: { sql: string }) =>
      sql.includes("org_invitations")
        ? {
            rows: [
              {
                id: "inv-1",
                email: "new@example.test",
                role: "admin",
                invitedBy: "admin@example.test",
                createdAt: 5,
              },
            ],
          }
        : {
            rows: [{ email: "admin@example.test", role: "admin", joinedAt: 1 }],
          },
    );
  });

  it("gives admins pending invitations with the id needed to cancel one", async () => {
    mockRequireOrgMember.mockResolvedValue({
      email: "admin@example.test",
      orgId: "org-1",
      role: "admin",
    });
    await expect(listOrganizationMembers.run(args, ctx)).resolves.toMatchObject(
      {
        pendingInvitations: [
          {
            id: "inv-1",
            email: "new@example.test",
            role: "admin",
            invitedBy: "admin@example.test",
            createdAt: 5,
          },
        ],
      },
    );
  });

  it("withholds pending invitations from plain members", async () => {
    mockRequireOrgMember.mockResolvedValue({
      email: "member@example.test",
      orgId: "org-1",
      role: "member",
    });
    const result = await listOrganizationMembers.run(args, ctx);
    expect(result).not.toHaveProperty("pendingInvitations");
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });
});
