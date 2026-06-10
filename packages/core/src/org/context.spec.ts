import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockExecute = vi.fn();
const mockGetSession = vi.fn();
const mockGetUserSetting = vi.fn();
const mockPutUserSetting = vi.fn();
const mockGetSetting = vi.fn();

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: mockExecute }),
  isPostgres: () => false,
  isLocalDatabase: () => true,
}));
vi.mock("../server/auth.js", () => ({
  getSession: (...args: any[]) => mockGetSession(...args),
}));
vi.mock("../settings/user-settings.js", () => ({
  getUserSetting: (...args: any[]) => mockGetUserSetting(...args),
  putUserSetting: (...args: any[]) => mockPutUserSetting(...args),
}));
vi.mock("../settings/store.js", () => ({
  getSetting: (...args: any[]) => mockGetSetting(...args),
}));

import {
  getOrgContext,
  resolveOrgIdForEmail,
  createOrganization,
  getOrgDomain,
  getOrgA2ASecret,
  getA2ASecretByDomain,
  resolveOrgByDomain,
} from "./context.js";

// Factory so each test gets a fresh event object — getOrgContext is per-event
// memoized on event.context, so sharing a module-level object would bleed
// cached results across tests.
function makeEvent() {
  return { context: {} } as any;
}

// Backwards-compat alias used by tests that don't need a fresh object each
// time but still pass through the factory so the cache is always clean.
let EVENT: ReturnType<typeof makeEvent>;

function queueSelect(...rows: any[][]) {
  for (const r of rows) {
    mockExecute.mockResolvedValueOnce({ rows: r });
  }
}

describe("getOrgContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecute.mockResolvedValue({ rows: [] });
    mockGetUserSetting.mockResolvedValue(null);
    mockGetSetting.mockResolvedValue(null);
    delete process.env.AUTO_CREATE_DEFAULT_ORG;
    // Fresh event per test so per-event memoization doesn't bleed.
    EVENT = makeEvent();
  });

  it("returns the empty context for an unauthenticated request", async () => {
    mockGetSession.mockResolvedValue(null);
    const ctx = await getOrgContext(EVENT);
    expect(ctx).toEqual({ email: "", orgId: null, orgName: null, role: null });
    // No DB work should happen without an authenticated email.
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("looks up memberships by LOWERCASED email", async () => {
    mockGetSession.mockResolvedValue({ email: "Alice@Builder.IO" });
    queueSelect([{ orgId: "org1", role: "member", orgName: "Builder" }]);
    await getOrgContext(EVENT);
    const call = mockExecute.mock.calls[0][0];
    expect(call.sql).toContain("FROM org_members");
    expect(call.args).toEqual(["alice@builder.io"]);
  });

  it("falls back to the first membership when session has no orgId", async () => {
    // Better Auth session.orgId is null until an explicit org switch.
    mockGetSession.mockResolvedValue({ email: "a@b.com" });
    queueSelect([
      { orgId: "first", role: "owner", orgName: "First Co" },
      { orgId: "second", role: "member", orgName: "Second Co" },
    ]);
    const ctx = await getOrgContext(EVENT);
    expect(ctx).toEqual({
      email: "a@b.com",
      orgId: "first",
      orgName: "First Co",
      role: "owner",
    });
  });

  it("honors a valid session.orgId over the first membership", async () => {
    mockGetSession.mockResolvedValue({
      email: "a@b.com",
      orgId: "second",
      orgRole: "admin",
    });
    queueSelect([
      { orgId: "first", role: "owner", orgName: "First Co" },
      { orgId: "second", role: "member", orgName: "Second Co" },
    ]);
    const ctx = await getOrgContext(EVENT);
    // Role/name come from the membership row, not the session claim.
    expect(ctx).toEqual({
      email: "a@b.com",
      orgId: "second",
      orgName: "Second Co",
      role: "member",
    });
  });

  it("trusts a session.orgId the user is NOT a member of, but with null name and session role", async () => {
    // Cross-app A2A / impersonation context: the session asserts an org the
    // local memberships table doesn't have. We surface it but cannot supply a
    // name and must use the session-claimed role only.
    mockGetSession.mockResolvedValue({
      email: "a@b.com",
      orgId: "ghost-org",
      orgRole: "owner",
    });
    queueSelect([{ orgId: "real", role: "member", orgName: "Real Co" }]);
    const ctx = await getOrgContext(EVENT);
    expect(ctx).toEqual({
      email: "a@b.com",
      orgId: "ghost-org",
      orgName: null,
      role: "owner",
    });
  });

  it("normalizes a bogus session.orgRole to null", async () => {
    mockGetSession.mockResolvedValue({
      email: "a@b.com",
      orgId: "ghost-org",
      orgRole: "superuser", // not a valid OrgRole
    });
    queueSelect([]); // no memberships
    const ctx = await getOrgContext(EVENT);
    expect(ctx.orgId).toBe("ghost-org");
    expect(ctx.role).toBeNull();
  });

  it("ignores a whitespace-only session.orgId", async () => {
    mockGetSession.mockResolvedValue({ email: "a@b.com", orgId: "   " });
    queueSelect([{ orgId: "real", role: "member", orgName: "Real Co" }]);
    const ctx = await getOrgContext(EVENT);
    expect(ctx.orgId).toBe("real");
  });

  it("honors active-org-id user setting when in multiple orgs", async () => {
    mockGetSession.mockResolvedValue({ email: "a@b.com" });
    queueSelect([
      { orgId: "first", role: "owner", orgName: "First Co" },
      { orgId: "second", role: "member", orgName: "Second Co" },
    ]);
    mockGetUserSetting.mockResolvedValue({ orgId: "second" });
    const ctx = await getOrgContext(EVENT);
    expect(ctx.orgId).toBe("second");
    expect(ctx.role).toBe("member");
    expect(mockGetUserSetting).toHaveBeenCalledWith("a@b.com", "active-org-id");
  });

  it("falls back to first membership when active-org-id points to a non-membership", async () => {
    mockGetSession.mockResolvedValue({ email: "a@b.com" });
    queueSelect([
      { orgId: "first", role: "owner", orgName: "First Co" },
      { orgId: "second", role: "member", orgName: "Second Co" },
    ]);
    mockGetUserSetting.mockResolvedValue({ orgId: "left-this-org" });
    const ctx = await getOrgContext(EVENT);
    expect(ctx.orgId).toBe("first");
  });

  it("does NOT consult active-org-id when in exactly one org", async () => {
    mockGetSession.mockResolvedValue({ email: "a@b.com" });
    queueSelect([{ orgId: "only", role: "owner", orgName: "Only Co" }]);
    const ctx = await getOrgContext(EVENT);
    expect(ctx.orgId).toBe("only");
    expect(mockGetUserSetting).not.toHaveBeenCalled();
  });

  it("returns null org for an authenticated user with zero memberships (no auto-create)", async () => {
    mockGetSession.mockResolvedValue({ email: "loner@b.com" });
    queueSelect([]);
    const ctx = await getOrgContext(EVENT);
    expect(ctx).toEqual({
      email: "loner@b.com",
      orgId: null,
      orgName: null,
      role: null,
    });
    expect(mockPutUserSetting).not.toHaveBeenCalled();
  });

  describe("membership-lookup failure (tables missing before migrations)", () => {
    it("returns the session orgId when present", async () => {
      mockGetSession.mockResolvedValue({
        email: "a@b.com",
        orgId: "sess-org",
        orgRole: "admin",
      });
      mockExecute.mockRejectedValueOnce(
        new Error("no such table: org_members"),
      );
      const ctx = await getOrgContext(EVENT);
      expect(ctx).toEqual({
        email: "a@b.com",
        orgId: "sess-org",
        orgName: null,
        role: "admin",
      });
    });

    it("returns a null-org context when there is no session orgId", async () => {
      mockGetSession.mockResolvedValue({ email: "a@b.com" });
      mockExecute.mockRejectedValueOnce(
        new Error("no such table: org_members"),
      );
      const ctx = await getOrgContext(EVENT);
      expect(ctx).toEqual({
        email: "a@b.com",
        orgId: null,
        orgName: null,
        role: null,
      });
    });
  });

  describe("per-event memoization", () => {
    it("returns the same result for two calls on the same event without an extra DB query", async () => {
      mockGetSession.mockResolvedValue({
        email: "memo@example.com",
        // No orgId: forces a real org_members lookup.
      });
      queueSelect([{ orgId: "org-memo", role: "owner", orgName: "Memo Co" }]);

      const event = makeEvent();
      const [ctx1, ctx2] = await Promise.all([
        getOrgContext(event),
        getOrgContext(event),
      ]);

      // Both calls return the same resolved value.
      expect(ctx1).toBe(ctx2); // identical reference, not just deep-equal
      // Only one DB round trip, not two.
      expect(mockExecute).toHaveBeenCalledTimes(1);
    });

    it("does NOT share the cache between two different event objects", async () => {
      mockGetSession.mockResolvedValue({ email: "split@example.com" });
      mockExecute
        .mockResolvedValueOnce({
          rows: [{ orgId: "org-a", role: "owner", orgName: "Org A" }],
        })
        .mockResolvedValueOnce({
          rows: [{ orgId: "org-b", role: "member", orgName: "Org B" }],
        });

      const eventA = makeEvent();
      const eventB = makeEvent();
      const [ctxA, ctxB] = await Promise.all([
        getOrgContext(eventA),
        getOrgContext(eventB),
      ]);

      expect(ctxA.orgId).toBe("org-a");
      expect(ctxB.orgId).toBe("org-b");
      expect(mockExecute).toHaveBeenCalledTimes(2);
    });
  });

  describe("AUTO_CREATE_DEFAULT_ORG", () => {
    afterEach(() => {
      delete process.env.AUTO_CREATE_DEFAULT_ORG;
    });

    it("provisions a default org for a zero-membership user when enabled", async () => {
      process.env.AUTO_CREATE_DEFAULT_ORG = "1";
      mockGetSession.mockResolvedValue({
        email: "jane@startup.dev",
        name: "Jane Doe",
      });
      // 1) memberships lookup -> empty
      // 2) acquireClaim INSERT into settings -> succeeds (no throw)
      // 3) hasPendingInvitation -> none
      // 4) hasDomainMatch -> none
      // 5) INSERT organizations
      // 6) INSERT org_members
      queueSelect(
        [], // memberships
        [], // acquireClaim INSERT settings (resolves -> claim acquired)
        [], // hasPendingInvitation
        [], // hasDomainMatch
        [], // INSERT organizations
        [], // INSERT org_members
      );
      const ctx = await getOrgContext(EVENT);
      expect(ctx.email).toBe("jane@startup.dev");
      expect(ctx.orgId).toBeTruthy();
      expect(ctx.role).toBe("owner");
      expect(ctx.orgName).toBe("Jane Doe's workspace");
      expect(mockPutUserSetting).toHaveBeenCalledWith(
        "jane@startup.dev",
        "active-org-id",
        { orgId: ctx.orgId },
      );
    });

    it("derives the workspace name from the email local-part when session has no name", async () => {
      process.env.AUTO_CREATE_DEFAULT_ORG = "1";
      mockGetSession.mockResolvedValue({ email: "john.q-public@startup.dev" });
      queueSelect([], [], [], [], [], []);
      const ctx = await getOrgContext(EVENT);
      expect(ctx.orgName).toBe("John Q Public's workspace");
    });

    it("does NOT auto-create when the user has a pending invitation", async () => {
      process.env.AUTO_CREATE_DEFAULT_ORG = "1";
      mockGetSession.mockResolvedValue({ email: "invited@startup.dev" });
      queueSelect(
        [], // memberships
        [], // acquireClaim INSERT settings
        [{ "1": 1 }], // hasPendingInvitation -> has one
      );
      // releaseClaim DELETE -> resolves
      mockExecute.mockResolvedValueOnce({ rows: [] });
      const ctx = await getOrgContext(EVENT);
      expect(ctx.orgId).toBeNull();
      // Critically: we must not have written an active-org-id for them.
      expect(mockPutUserSetting).not.toHaveBeenCalled();
      // And no organization was inserted.
      const sqls = mockExecute.mock.calls.map((c) => c[0].sql);
      expect(sqls.some((s) => s.includes("INSERT INTO organizations"))).toBe(
        false,
      );
    });

    it("does NOT auto-create when the email domain already matches an org", async () => {
      process.env.AUTO_CREATE_DEFAULT_ORG = "1";
      mockGetSession.mockResolvedValue({ email: "new@builder.io" });
      queueSelect(
        [], // memberships
        [], // acquireClaim INSERT settings
        [], // hasPendingInvitation -> none
        [{ "1": 1 }], // hasDomainMatch -> match
      );
      mockExecute.mockResolvedValueOnce({ rows: [] }); // releaseClaim DELETE
      const ctx = await getOrgContext(EVENT);
      expect(ctx.orgId).toBeNull();
      expect(mockPutUserSetting).not.toHaveBeenCalled();
    });

    it("bails (null org) when the auto-create claim is lost to a concurrent request", async () => {
      process.env.AUTO_CREATE_DEFAULT_ORG = "1";
      mockGetSession.mockResolvedValue({ email: "racer@startup.dev" });
      // memberships empty, then acquireClaim INSERT throws (key exists), then
      // the stale-takeover UPDATE matches zero rows -> claim NOT acquired.
      mockExecute.mockResolvedValueOnce({ rows: [] }); // memberships
      mockExecute.mockRejectedValueOnce(
        new Error("UNIQUE constraint failed: settings.key"),
      );
      mockExecute.mockResolvedValueOnce({ rowsAffected: 0 }); // stale UPDATE, no match
      const ctx = await getOrgContext(EVENT);
      expect(ctx.orgId).toBeNull();
      expect(mockPutUserSetting).not.toHaveBeenCalled();
    });

    it("reclaims a STALE claim (TTL-expired) and proceeds to create the org", async () => {
      // Stuck-state recovery: a prior claim's DELETE failed, but the row is
      // older than CLAIM_TTL_MS. acquireClaim's INSERT conflicts, the
      // conditional stale-takeover UPDATE matches one row, and creation
      // proceeds. Without this branch a user could be permanently stranded.
      process.env.AUTO_CREATE_DEFAULT_ORG = "1";
      mockGetSession.mockResolvedValue({
        email: "stuck@startup.dev",
        name: "Stuck User",
      });
      mockExecute.mockResolvedValueOnce({ rows: [] }); // memberships
      mockExecute.mockRejectedValueOnce(
        new Error("UNIQUE constraint failed: settings.key"),
      ); // acquireClaim INSERT conflicts
      mockExecute.mockResolvedValueOnce({ rowsAffected: 1 }); // stale UPDATE wins
      mockExecute.mockResolvedValueOnce({ rows: [] }); // hasPendingInvitation -> none
      mockExecute.mockResolvedValueOnce({ rows: [] }); // hasDomainMatch -> none
      mockExecute.mockResolvedValueOnce({ rows: [] }); // INSERT organizations
      mockExecute.mockResolvedValueOnce({ rows: [] }); // INSERT org_members
      const ctx = await getOrgContext(EVENT);
      expect(ctx.orgId).toBeTruthy();
      expect(ctx.role).toBe("owner");
      expect(ctx.orgName).toBe("Stuck User's workspace");
      expect(mockPutUserSetting).toHaveBeenCalledWith(
        "stuck@startup.dev",
        "active-org-id",
        { orgId: ctx.orgId },
      );
    });

    it("does NOT auto-create when the invitation lookup ERRORS (fail closed)", async () => {
      // hasPendingInvitation swallows DB errors and returns true so we never
      // race ahead of an invite we couldn't read. Auto-create must be skipped.
      process.env.AUTO_CREATE_DEFAULT_ORG = "1";
      mockGetSession.mockResolvedValue({ email: "maybe-invited@startup.dev" });
      mockExecute.mockResolvedValueOnce({ rows: [] }); // memberships
      mockExecute.mockResolvedValueOnce({ rows: [] }); // acquireClaim INSERT
      mockExecute.mockRejectedValueOnce(
        new Error("no such table: org_invitations"),
      ); // hasPendingInvitation throws -> treated as "has invite"
      mockExecute.mockResolvedValueOnce({ rows: [] }); // releaseClaim DELETE
      const ctx = await getOrgContext(EVENT);
      expect(ctx.orgId).toBeNull();
      expect(mockPutUserSetting).not.toHaveBeenCalled();
      const sqls = mockExecute.mock.calls.map((c) => c[0].sql);
      expect(sqls.some((s) => s.includes("INSERT INTO organizations"))).toBe(
        false,
      );
    });

    it("does NOT auto-create when the flag is unset, even for a zero-membership user", async () => {
      mockGetSession.mockResolvedValue({ email: "loner@startup.dev" });
      queueSelect([]); // memberships only
      const ctx = await getOrgContext(EVENT);
      expect(ctx.orgId).toBeNull();
      expect(mockGetSetting).not.toHaveBeenCalled();
    });
  });
});

describe("resolveOrgIdForEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecute.mockResolvedValue({ rows: [] });
    mockGetUserSetting.mockResolvedValue(null);
  });

  it("returns null when the user has no memberships", async () => {
    queueSelect([]);
    expect(await resolveOrgIdForEmail("nobody@b.com")).toBeNull();
  });

  it("returns the single membership without consulting active-org-id", async () => {
    queueSelect([{ org_id: "only" }]);
    expect(await resolveOrgIdForEmail("a@b.com")).toBe("only");
    expect(mockGetUserSetting).not.toHaveBeenCalled();
  });

  it("prefers active-org-id when it is one of multiple memberships", async () => {
    queueSelect([{ org_id: "first" }, { org_id: "second" }]);
    mockGetUserSetting.mockResolvedValue({ orgId: "second" });
    expect(await resolveOrgIdForEmail("a@b.com")).toBe("second");
  });

  it("falls back to the first membership when active-org-id is not a current membership", async () => {
    queueSelect([{ org_id: "first" }, { org_id: "second" }]);
    mockGetUserSetting.mockResolvedValue({ orgId: "left-org" });
    expect(await resolveOrgIdForEmail("a@b.com")).toBe("first");
  });

  it("lowercases the email in the lookup", async () => {
    queueSelect([]);
    await resolveOrgIdForEmail("Mixed@Case.COM");
    expect(mockExecute.mock.calls[0][0].args).toEqual(["mixed@case.com"]);
  });

  it("returns null on a DB error (missing tables) rather than throwing", async () => {
    mockExecute.mockRejectedValueOnce(new Error("no such table: org_members"));
    expect(await resolveOrgIdForEmail("a@b.com")).toBeNull();
  });
});

describe("createOrganization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecute.mockResolvedValue({ rows: [] });
  });

  it("inserts the org and an owner membership, trims the name, and sets active-org-id", async () => {
    const result = await createOrganization("  Acme Inc  ", "founder@acme.com");

    expect(result.name).toBe("Acme Inc");
    expect(result.role).toBe("owner");
    expect(result.id).toBeTruthy();
    // A2A secret must be a non-trivial base64url string for JWT signing.
    expect(result.a2aSecret).toMatch(/^[A-Za-z0-9_-]{32,}$/);

    const calls = mockExecute.mock.calls.map((c) => c[0]);
    expect(calls[0].sql).toContain("INSERT INTO organizations");
    // org row carries id, trimmed name, creator email, createdAt, a2aSecret
    expect(calls[0].args[0]).toBe(result.id);
    expect(calls[0].args[1]).toBe("Acme Inc");
    expect(calls[0].args[2]).toBe("founder@acme.com");
    expect(calls[0].args[4]).toBe(result.a2aSecret);

    expect(calls[1].sql).toContain("INSERT INTO org_members");
    expect(calls[1].args[1]).toBe(result.id); // org_id
    expect(calls[1].args[2]).toBe("founder@acme.com"); // email
    expect(calls[1].args[3]).toBe("owner"); // role

    expect(mockPutUserSetting).toHaveBeenCalledWith(
      "founder@acme.com",
      "active-org-id",
      { orgId: result.id },
    );
  });

  it("honors an explicit non-owner role for the creator", async () => {
    const result = await createOrganization("Team", "admin@x.com", "admin");
    expect(result.role).toBe("admin");
    const memberInsert = mockExecute.mock.calls[1][0];
    expect(memberInsert.args[3]).toBe("admin");
  });
});

describe("domain & A2A secret lookups (A2A receiving-side scoping)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecute.mockResolvedValue({ rows: [] });
  });

  it("getOrgDomain returns the allowed_domain or null", async () => {
    queueSelect([{ allowed_domain: "acme.com" }]);
    expect(await getOrgDomain("org1")).toBe("acme.com");
  });

  it("getOrgDomain returns null when no row matches", async () => {
    queueSelect([]);
    expect(await getOrgDomain("missing")).toBeNull();
  });

  it("getOrgDomain treats an empty stored domain as null", async () => {
    queueSelect([{ allowed_domain: "" }]);
    expect(await getOrgDomain("org1")).toBeNull();
  });

  it("getOrgDomain returns null on DB error", async () => {
    mockExecute.mockRejectedValueOnce(new Error("boom"));
    expect(await getOrgDomain("org1")).toBeNull();
  });

  it("getOrgA2ASecret returns the secret or null", async () => {
    queueSelect([{ a2a_secret: "s3cr3t" }]);
    expect(await getOrgA2ASecret("org1")).toBe("s3cr3t");
  });

  it("getOrgA2ASecret treats an empty secret as null", async () => {
    queueSelect([{ a2a_secret: "" }]);
    expect(await getOrgA2ASecret("org1")).toBeNull();
  });

  it("getA2ASecretByDomain lowercases the domain in the lookup", async () => {
    queueSelect([{ a2a_secret: "byDomain" }]);
    const secret = await getA2ASecretByDomain("ACME.com");
    expect(secret).toBe("byDomain");
    expect(mockExecute.mock.calls[0][0].args).toEqual(["acme.com"]);
  });

  it("getA2ASecretByDomain returns null on DB error", async () => {
    mockExecute.mockRejectedValueOnce(new Error("boom"));
    expect(await getA2ASecretByDomain("acme.com")).toBeNull();
  });

  it("resolveOrgByDomain returns {orgId, orgName} and lowercases the lookup", async () => {
    queueSelect([{ id: "org1", name: "Acme" }]);
    const out = await resolveOrgByDomain("Acme.COM");
    expect(out).toEqual({ orgId: "org1", orgName: "Acme" });
    expect(mockExecute.mock.calls[0][0].args).toEqual(["acme.com"]);
  });

  it("resolveOrgByDomain returns null when nothing matches", async () => {
    queueSelect([]);
    expect(await resolveOrgByDomain("nope.com")).toBeNull();
  });

  it("resolveOrgByDomain returns null on DB error", async () => {
    mockExecute.mockRejectedValueOnce(new Error("boom"));
    expect(await resolveOrgByDomain("acme.com")).toBeNull();
  });
});
