import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExecute = vi.fn();
const mockGetRequestUserEmail = vi.fn();
const mockGetRequestOrgId = vi.fn();

vi.mock("../db/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db/client.js")>()),
  getDbExec: () => ({ execute: mockExecute }),
  isPostgres: () => false,
  isLocalDatabase: () => true,
}));
vi.mock("../server/request-context.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/request-context.js")>()),
  getRequestUserEmail: () => mockGetRequestUserEmail(),
  getRequestOrgId: () => mockGetRequestOrgId(),
}));

import { ForbiddenError } from "../sharing/access.js";
import {
  defineAppRoles,
  resolveAppRole,
  listAppMemberRoles,
  setAppMemberRole,
  getRegisteredAppRoles,
} from "./app-roles.js";

const CALLER = { userEmail: "ae@acme.com", orgId: "org1" };

// The registry is module-level and rejects a second descriptor for the same
// appId, so every `defineAppRoles` call in this file needs its own id.
let idSeq = 0;
const uniqueAppId = (label: string) => `${label}-${++idSeq}`;

function defineTestRoles(overrides: Partial<{ defaultRole: "member" }> = {}) {
  return defineAppRoles({
    appId: uniqueAppId("coach"),
    roles: ["member", "coach-admin"] as const,
    ...overrides,
  });
}

/** One row shape from the membership + assignment join. */
const joinRow = (appRole: string | null) => ({ rows: [{ appRole }] });

describe("app roles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecute.mockResolvedValue({ rows: [] });
    // Ambient request context is empty unless a test opts in, so a caller
    // passed as `{ userEmail: null }` cannot silently inherit an identity.
    mockGetRequestUserEmail.mockReturnValue(undefined);
    mockGetRequestOrgId.mockReturnValue(undefined);
  });

  describe("guards deny an unassigned member", () => {
    // The load-bearing one: `defaultRole` is a display value. If it satisfied a
    // guard, "nobody assigned this person" and "this person was granted the
    // role" would be the same answer.
    it("requireAny rejects an org member with no assignment even when a defaultRole is declared", async () => {
      const access = defineAppRoles({
        appId: uniqueAppId("coach-default"),
        roles: ["member", "coach-admin"] as const,
        defaultRole: "member",
      });
      mockExecute.mockResolvedValueOnce(joinRow(null));

      const guard = access.requireAny("member");
      await expect(guard({}, CALLER as any)).rejects.toThrow(ForbiddenError);
    });

    it("assertAny rejects the same caller and names the missing assignment", async () => {
      const appId = uniqueAppId("coach-default");
      const access = defineAppRoles({
        appId,
        roles: ["member", "coach-admin"] as const,
        defaultRole: "member",
      });
      mockExecute.mockResolvedValueOnce(joinRow(null));

      await expect(access.assertAny(["member"], CALLER)).rejects.toThrow(
        `no ${appId} role assigned`,
      );
    });

    it("still reports the default as the display value for that member", async () => {
      const access = defineAppRoles({
        appId: uniqueAppId("coach-default"),
        roles: ["member", "coach-admin"] as const,
        defaultRole: "member",
      });
      mockExecute.mockResolvedValueOnce(joinRow(null));

      expect(await access.resolve(CALLER)).toEqual({
        status: "unassigned",
        orgId: "org1",
      });
      expect(access.descriptor.defaultRole).toBe("member");
    });
  });

  describe("a stale assignment cannot authorize", () => {
    it("denies a caller who is not in org_members for the active org", async () => {
      const access = defineTestRoles();
      // The join drives off org_members, so a leftover app_member_roles row for
      // this email+org produces no result set at all.
      mockExecute.mockResolvedValueOnce({ rows: [] });

      expect(await access.resolve(CALLER)).toEqual({
        status: "not-a-member",
        orgId: "org1",
      });
      mockExecute.mockResolvedValueOnce({ rows: [] });
      await expect(
        access.requireAny("coach-admin")({}, CALLER as any),
      ).rejects.toThrow(ForbiddenError);
    });

    it("resolves membership and assignment in one statement driven by org_members", async () => {
      const access = defineTestRoles();
      mockExecute.mockResolvedValueOnce(joinRow("member"));

      await access.resolve(CALLER);

      expect(mockExecute).toHaveBeenCalledTimes(1);
      const { sql, args } = mockExecute.mock.calls[0][0];
      expect(sql).toContain("FROM org_members");
      expect(sql).toContain("LEFT JOIN app_member_roles");
      expect(args).toEqual([access.appId, "org1", "ae@acme.com"]);
    });

    it("lowercases the caller email in the membership lookup", async () => {
      const access = defineTestRoles();
      mockExecute.mockResolvedValueOnce(joinRow("member"));

      await access.resolve({ userEmail: "  AE@Acme.COM ", orgId: "org1" });

      expect(mockExecute.mock.calls[0][0].args[2]).toBe("ae@acme.com");
    });
  });

  describe("an explicit assignment authorizes", () => {
    it("assertAny returns the matched role", async () => {
      const access = defineTestRoles();
      mockExecute.mockResolvedValueOnce(joinRow("coach-admin"));

      expect(await access.assertAny(["member", "coach-admin"], CALLER)).toBe(
        "coach-admin",
      );
    });

    it("requireAny passes and reads identity off the action context", async () => {
      const access = defineTestRoles();
      mockExecute.mockResolvedValueOnce(joinRow("member"));

      await expect(
        access.requireAny("member")({ some: "args" }, CALLER as any),
      ).resolves.toBeUndefined();
      expect(mockExecute.mock.calls[0][0].args[1]).toBe("org1");
    });

    it("denies a role outside the accepted list and says which one is held", async () => {
      const access = defineTestRoles();
      mockExecute.mockResolvedValueOnce(joinRow("member"));

      await expect(access.assertAny(["coach-admin"], CALLER)).rejects.toThrow(
        "have member",
      );
    });
  });

  describe("a retired role does not satisfy a guard", () => {
    it("resolves a stored role outside the declared vocabulary as unassigned", async () => {
      const access = defineTestRoles();
      mockExecute.mockResolvedValueOnce(joinRow("legacy-superuser"));

      expect(await access.resolve(CALLER)).toEqual({
        status: "unassigned",
        orgId: "org1",
      });
    });

    it("denies even when the retired value is the role the caller asks for", async () => {
      const access = defineTestRoles();
      mockExecute.mockResolvedValueOnce(joinRow("legacy-superuser"));

      await expect(
        access.assertAny(["legacy-superuser" as any], CALLER),
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe("a failed lookup is not an answer", () => {
    it("propagates the database error instead of resolving to a deny status", async () => {
      const access = defineTestRoles();
      const dbError = Object.assign(new Error("db query timed out"), {
        code: "57014",
      });
      mockExecute.mockRejectedValueOnce(dbError);

      await expect(access.resolve(CALLER)).rejects.toThrow(
        "db query timed out",
      );
    });

    it("does not disguise the failure as a permission denial", async () => {
      const access = defineTestRoles();
      mockExecute.mockRejectedValueOnce(new Error("db query timed out"));

      const thrown = await access.assertAny(["member"], CALLER).then(
        () => new Error("expected a rejection"),
        (e) => e,
      );
      expect(thrown).not.toBeInstanceOf(ForbiddenError);
      expect(String(thrown)).toContain("db query timed out");
    });
  });

  describe("resolve reports distinct statuses", () => {
    it("returns no-identity when there is no caller email anywhere", async () => {
      const access = defineTestRoles();
      expect(await access.resolve({ userEmail: null, orgId: "org1" })).toEqual({
        status: "no-identity",
      });
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it("returns no-identity for a whitespace-only email", async () => {
      const access = defineTestRoles();
      expect(await access.resolve({ userEmail: "   ", orgId: "org1" })).toEqual(
        {
          status: "no-identity",
        },
      );
    });

    it("returns no-org when the caller has an email but no active org", async () => {
      const access = defineTestRoles();
      expect(await access.resolve({ userEmail: "ae@acme.com" })).toEqual({
        status: "no-org",
      });
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it("returns not-a-member when the join produces no row", async () => {
      const access = defineTestRoles();
      mockExecute.mockResolvedValueOnce({ rows: [] });
      expect(await access.resolve(CALLER)).toEqual({
        status: "not-a-member",
        orgId: "org1",
      });
    });

    it("returns unassigned when the member has a row but a null role", async () => {
      const access = defineTestRoles();
      mockExecute.mockResolvedValueOnce(joinRow(null));
      expect(await access.resolve(CALLER)).toEqual({
        status: "unassigned",
        orgId: "org1",
      });
    });

    it("returns assigned with the role and org", async () => {
      const access = defineTestRoles();
      mockExecute.mockResolvedValueOnce(joinRow("coach-admin"));
      expect(await access.resolve(CALLER)).toEqual({
        status: "assigned",
        role: "coach-admin",
        orgId: "org1",
      });
    });

    it("reads a lowercased column alias from dialects that fold identifiers", async () => {
      const access = defineTestRoles();
      mockExecute.mockResolvedValueOnce({ rows: [{ approle: "member" }] });
      expect(await access.resolve(CALLER)).toMatchObject({
        status: "assigned",
        role: "member",
      });
    });

    it("falls back to the ambient request context when no caller is passed", async () => {
      const access = defineTestRoles();
      mockGetRequestUserEmail.mockReturnValue("ambient@acme.com");
      mockGetRequestOrgId.mockReturnValue("org-ambient");
      mockExecute.mockResolvedValueOnce(joinRow("member"));

      expect(await access.resolve()).toEqual({
        status: "assigned",
        role: "member",
        orgId: "org-ambient",
      });
    });

    it("is reachable through the standalone resolveAppRole for a raw descriptor", async () => {
      mockExecute.mockResolvedValueOnce(joinRow("member"));
      expect(
        await resolveAppRole(
          { appId: uniqueAppId("raw"), roles: ["member"] as const },
          CALLER,
        ),
      ).toEqual({ status: "assigned", role: "member", orgId: "org1" });
    });
  });

  describe("defineAppRoles validation", () => {
    it("throws on an empty appId", () => {
      expect(() => defineAppRoles({ appId: "  ", roles: ["a"] })).toThrow(
        "appId is required",
      );
    });

    it("throws when roles is empty", () => {
      expect(() =>
        defineAppRoles({ appId: uniqueAppId("empty"), roles: [] }),
      ).toThrow("at least one role is required");
    });

    it("throws when defaultRole is not one of roles", () => {
      expect(() =>
        defineAppRoles({
          appId: uniqueAppId("bad-default"),
          roles: ["member"] as const,
          defaultRole: "admin" as any,
        }),
      ).toThrow('defaultRole "admin" is not in roles');
    });

    it("throws when the same appId is declared with a different descriptor", () => {
      const appId = uniqueAppId("dupe");
      defineAppRoles({ appId, roles: ["member"] as const });
      expect(() =>
        defineAppRoles({ appId, roles: ["member", "admin"] as const }),
      ).toThrow("already declared with a different descriptor");
    });

    it("allows re-declaring the exact same descriptor object", () => {
      const descriptor = {
        appId: uniqueAppId("same-object"),
        roles: ["member"] as const,
      };
      defineAppRoles(descriptor);
      expect(() => defineAppRoles(descriptor)).not.toThrow();
    });

    it("registers the descriptor for the REST layer to look up", () => {
      const access = defineTestRoles();
      expect(getRegisteredAppRoles(access.appId)).toBe(access.descriptor);
      expect(getRegisteredAppRoles("never-declared")).toBeUndefined();
    });
  });

  describe("setAppMemberRole", () => {
    const base = {
      appId: "coach",
      orgId: "org1",
      email: "AE@Acme.com",
      updatedBy: "owner@acme.com",
    };

    it("deletes the assignment for role: null instead of writing a default", async () => {
      await setAppMemberRole({ ...base, role: null });

      expect(mockExecute).toHaveBeenCalledTimes(1);
      const { sql, args } = mockExecute.mock.calls[0][0];
      expect(sql).toContain("DELETE FROM app_member_roles");
      expect(sql).not.toContain("INSERT");
      expect(args).toEqual(["org1", "coach", "ae@acme.com"]);
    });

    it("atomically inserts or updates an assignment", async () => {
      await setAppMemberRole({ ...base, role: "member" });

      expect(mockExecute).toHaveBeenCalledTimes(1);
      const { sql, args } = mockExecute.mock.calls[0][0];
      expect(sql).toContain("INSERT INTO app_member_roles");
      expect(sql).toContain(
        "ON CONFLICT (org_id, app_id, LOWER(email)) DO UPDATE",
      );
      expect(sql).toContain("role = excluded.role");
      expect(args).toEqual(
        expect.arrayContaining(["org1", "coach", "ae@acme.com", "member"]),
      );
    });
  });

  describe("listAppMemberRoles", () => {
    it("returns assignments only for current members of one app in one org", async () => {
      mockExecute.mockResolvedValueOnce({
        rows: [
          { email: "ae@acme.com", role: "member" },
          { email: "boss@acme.com", role: "coach-admin" },
        ],
      });

      expect(await listAppMemberRoles("coach", "org1")).toEqual([
        { email: "ae@acme.com", role: "member" },
        { email: "boss@acme.com", role: "coach-admin" },
      ]);
      const { sql, args } = mockExecute.mock.calls[0][0];
      expect(sql).toContain("INNER JOIN org_members");
      expect(sql).toContain("LOWER(m.email) = LOWER(r.email)");
      expect(args).toEqual(["org1", "coach"]);
    });
  });

  describe("an explicitly absent identity is not an unspecified one", () => {
    // A system/cron caller that declares it has no user must not authorize as
    // whichever request happens to be on the stack.
    it("does not fall back to ambient identity when userEmail is null", async () => {
      mockGetRequestUserEmail.mockReturnValue("someone-else@acme.com");
      mockGetRequestOrgId.mockReturnValue("org1");
      const roles = defineTestRoles();

      expect(await roles.resolve({ userEmail: null, orgId: "org1" })).toEqual({
        status: "no-identity",
      });
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it("does not fall back to ambient org when orgId is null", async () => {
      mockGetRequestOrgId.mockReturnValue("org1");
      const roles = defineTestRoles();

      expect(
        await roles.resolve({ userEmail: "ae@acme.com", orgId: null }),
      ).toEqual({ status: "no-org" });
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it("still falls back to ambient identity when the caller says nothing", async () => {
      mockGetRequestUserEmail.mockReturnValue("ae@acme.com");
      mockGetRequestOrgId.mockReturnValue("org1");
      mockExecute.mockResolvedValueOnce(joinRow("coach-admin"));
      const roles = defineTestRoles();

      expect(await roles.resolve()).toEqual({
        status: "assigned",
        role: "coach-admin",
        orgId: "org1",
      });
    });
  });

  describe("requireAny rejects a guard that can never match", () => {
    it("throws when no accepted role is given", () => {
      const roles = defineTestRoles();
      expect(() => roles.requireAny()).toThrow(/at least one accepted role/);
    });

    it("throws when an accepted role is not in the declared vocabulary", () => {
      const roles = defineTestRoles();
      const requireAny = roles.requireAny as (...r: string[]) => unknown;
      expect(() => requireAny("coach-admin", "nope")).toThrow(
        /undeclared role\(s\) nope/,
      );
    });
  });
});
