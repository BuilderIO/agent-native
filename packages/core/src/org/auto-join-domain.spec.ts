import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExecute = vi.fn();
const mockPutUserSetting = vi.fn();
const mockGetUserSetting = vi.fn();

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: mockExecute }),
  isLocalDatabase: () => true,
}));
vi.mock("../settings/user-settings.js", () => ({
  putUserSetting: (...args: any[]) => mockPutUserSetting(...args),
  getUserSetting: (...args: any[]) => mockGetUserSetting(...args),
}));

import { autoJoinDomainMatchingOrgs } from "./auto-join-domain.js";

function queueSelect(...rows: any[][]) {
  for (const r of rows) {
    mockExecute.mockResolvedValueOnce({ rows: r });
  }
}

describe("autoJoinDomainMatchingOrgs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecute.mockResolvedValue({ rows: [] });
    mockGetUserSetting.mockResolvedValue(null);
  });

  it("returns empty when no orgs match the domain", async () => {
    queueSelect([]);
    const out = await autoJoinDomainMatchingOrgs("new@nowhere.com");
    expect(out).toEqual({ joined: [], activeOrgId: null });
    expect(mockPutUserSetting).not.toHaveBeenCalled();
  });

  it("returns empty when email has no domain", async () => {
    const out = await autoJoinDomainMatchingOrgs("notanemail");
    expect(out).toEqual({ joined: [], activeOrgId: null });
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("inserts org_members and sets active-org-id when no prior active org", async () => {
    queueSelect(
      [{ orgId: "builder_io" }], // domain matches
      [], // INSERT org_members result
    );
    mockGetUserSetting.mockResolvedValueOnce(null);
    const out = await autoJoinDomainMatchingOrgs("new@builder.io");

    const sqls = mockExecute.mock.calls.map((c) => c[0].sql);
    expect(sqls[0]).toContain("FROM organizations");
    expect(sqls[0]).toContain("LOWER(o.allowed_domain)");
    expect(sqls[1]).toContain("INSERT INTO org_members");

    expect(out.joined).toEqual([{ orgId: "builder_io" }]);
    expect(out.activeOrgId).toBe("builder_io");
    expect(mockGetUserSetting).toHaveBeenCalledWith(
      "new@builder.io",
      "active-org-id",
    );
    expect(mockPutUserSetting).toHaveBeenCalledWith(
      "new@builder.io",
      "active-org-id",
      { orgId: "builder_io" },
    );
  });

  it("does NOT overwrite an existing active-org-id (e.g. invite ran first)", async () => {
    queueSelect(
      [{ orgId: "builder_io" }],
      [], // INSERT org_members
    );
    mockGetUserSetting.mockResolvedValueOnce({ orgId: "other_org" });
    const out = await autoJoinDomainMatchingOrgs("new@builder.io");
    expect(out.joined).toEqual([{ orgId: "builder_io" }]);
    expect(out.activeOrgId).toBeNull();
    expect(mockPutUserSetting).not.toHaveBeenCalled();
  });

  it("excludes orgs the user is already a member of (NOT EXISTS)", async () => {
    // The query itself filters via NOT EXISTS, so we just confirm we
    // call it correctly. When the query returns empty (because the user
    // is already in the only matching org), the function no-ops.
    queueSelect([]);
    const out = await autoJoinDomainMatchingOrgs("existing@builder.io");
    expect(out.joined).toEqual([]);
    expect(out.activeOrgId).toBeNull();
    const args = mockExecute.mock.calls[0][0].args;
    expect(args).toEqual(["builder.io", "existing@builder.io"]);
  });

  it("joins multiple matching orgs and picks the first as active", async () => {
    queueSelect(
      [{ orgId: "orgA" }, { orgId: "orgB" }],
      [], // INSERT for orgA
      [], // INSERT for orgB
    );
    const out = await autoJoinDomainMatchingOrgs("multi@builder.io");
    expect(out.joined).toEqual([{ orgId: "orgA" }, { orgId: "orgB" }]);
    expect(out.activeOrgId).toBe("orgA");
  });

  it("survives a unique-constraint race on insert and continues", async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [{ orgId: "orgA" }, { orgId: "orgB" }],
    });
    mockExecute.mockRejectedValueOnce(new Error("UNIQUE constraint failed"));
    mockExecute.mockResolvedValueOnce({ rows: [] }); // INSERT orgB succeeds

    const out = await autoJoinDomainMatchingOrgs("race@builder.io");
    expect(out.joined).toEqual([{ orgId: "orgB" }]);
  });

  it("swallows missing-table errors (template without org module)", async () => {
    mockExecute.mockRejectedValueOnce(
      new Error("no such table: organizations"),
    );
    const out = await autoJoinDomainMatchingOrgs("a@builder.io");
    expect(out).toEqual({ joined: [], activeOrgId: null });
  });

  it("lowercases email and domain for the lookup", async () => {
    queueSelect([]);
    await autoJoinDomainMatchingOrgs("Mixed@Builder.IO");
    const args = mockExecute.mock.calls[0][0].args;
    expect(args).toEqual(["builder.io", "mixed@builder.io"]);
  });
});
