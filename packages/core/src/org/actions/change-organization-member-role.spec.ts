import { beforeEach, describe, expect, it, vi } from "vitest";

const mockExecute = vi.hoisted(() => vi.fn());
const mockFederatedRole = vi.hoisted(() => vi.fn());
const mockRequireOrgMember = vi.hoisted(() => vi.fn());

vi.mock("../../db/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../db/client.js")>()),
  getDbExec: () => ({ execute: mockExecute }),
}));
vi.mock("../federation.js", () => ({
  FederatedIconConflictError: class extends Error {},
  addFederatedOrganizationMember: vi.fn(),
  revokeFederatedOrganizationMember: vi.fn(),
  syncOrganizationToIdentityHub: vi.fn(),
  updateFederatedOrganizationMemberRole: (...args: unknown[]) =>
    mockFederatedRole(...args),
}));
vi.mock("../actions.js", () => ({
  requireOrgMember: (...args: unknown[]) => mockRequireOrgMember(...args),
}));

import {
  __resetProcessMemberOrgCacheForTests,
  cachedMemberships,
} from "../request-org-cache.js";
import changeOrganizationMemberRole from "./change-organization-member-role.js";

const ctx = {
  caller: "tool" as const,
  userEmail: "owner@example.test",
  orgId: "org-1",
};

function caller(role: "owner" | "admin" | "member") {
  mockRequireOrgMember.mockImplementation(async (_ctx, admin) => {
    if (admin && role === "member")
      throw new Error("Organization admin role required.");
    return { email: `${role}@example.test`, orgId: "org-1", role };
  });
}

function memberRow(role: string | null) {
  mockExecute.mockImplementation(async ({ sql }: { sql: string }) =>
    sql.startsWith("SELECT role")
      ? { rows: role ? [{ role }] : [], rowsAffected: 0 }
      : { rows: [], rowsAffected: 1 },
  );
}

const updates = () =>
  mockExecute.mock.calls.filter(([i]) => i.sql.startsWith("UPDATE"));

describe("change-organization-member-role", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetProcessMemberOrgCacheForTests();
    mockFederatedRole.mockResolvedValue(false);
    caller("owner");
    memberRow("member");
  });

  it("is approval-gated with no persistent approval", () => {
    expect(changeOrganizationMemberRole.needsApproval).toBe(true);
    expect(changeOrganizationMemberRole.allowPersistentApproval).toBe(false);
  });

  it("refuses a plain member", async () => {
    caller("member");
    await expect(
      changeOrganizationMemberRole.run(
        { email: "a@example.test", role: "admin" },
        ctx,
      ),
    ).rejects.toThrow("Organization admin role required.");
    expect(updates()).toHaveLength(0);
  });

  it("lets the owner promote a member, syncing the authority first", async () => {
    await cachedMemberships("a@example.test", async () => [{ orgId: "org-1" }]);
    await expect(
      changeOrganizationMemberRole.run(
        { email: "A@Example.test", role: "admin" },
        ctx,
      ),
    ).resolves.toEqual({
      email: "a@example.test",
      role: "admin",
      previousRole: "member",
    });
    expect(mockFederatedRole).toHaveBeenCalledWith(undefined, {
      orgId: "org-1",
      actorEmail: "owner@example.test",
      actorRole: "owner",
      memberEmail: "A@Example.test",
      memberRole: "admin",
    });
    expect(updates()).toHaveLength(1);
    const reload = vi.fn(async () => []);
    await cachedMemberships("a@example.test", reload);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("stops an admin from promoting to admin or demoting an admin", async () => {
    caller("admin");
    await expect(
      changeOrganizationMemberRole.run(
        { email: "a@example.test", role: "admin" },
        ctx,
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    memberRow("admin");
    await expect(
      changeOrganizationMemberRole.run(
        { email: "a@example.test", role: "member" },
        ctx,
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(updates()).toHaveLength(0);
  });

  it("never changes the owner's role", async () => {
    memberRow("owner");
    await expect(
      changeOrganizationMemberRole.run(
        { email: "o@example.test", role: "member" },
        ctx,
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(updates()).toHaveLength(0);
  });

  it("answers 404 for an unknown member", async () => {
    memberRow(null);
    await expect(
      changeOrganizationMemberRole.run(
        { email: "x@example.test", role: "admin" },
        ctx,
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("does not update locally when the authority sync fails", async () => {
    mockFederatedRole.mockRejectedValueOnce(new Error("no request origin"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      changeOrganizationMemberRole.run(
        { email: "a@example.test", role: "admin" },
        ctx,
      ),
    ).rejects.toMatchObject({ statusCode: 503 });
    expect(updates()).toHaveLength(0);
  });

  it("rejects roles other than member and admin", () => {
    const parsed = changeOrganizationMemberRole.schema?.["~standard"].validate({
      email: "a@example.test",
      role: "owner",
    });
    expect(parsed).toHaveProperty("issues");
  });
});
