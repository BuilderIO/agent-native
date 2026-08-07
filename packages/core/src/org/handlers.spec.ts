import { beforeEach, describe, expect, it, vi } from "vitest";

const mockExecute = vi.fn();
const mockTransaction = vi.fn(
  async (fn: (tx: { execute: typeof mockExecute }) => unknown) =>
    fn({ execute: mockExecute }),
);
const mockGetOrgContext = vi.fn();

vi.mock("h3", () => ({
  defineEventHandler: (handler: any) => handler,
  getRouterParam: (event: any, key: string) => event._params?.[key],
  getRequestURL: (event: any) => new URL(event._url),
  createError: ({ statusCode, message }: any) =>
    Object.assign(new Error(message), { statusCode }),
}));

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: mockExecute, transaction: mockTransaction }),
  isPostgres: () => false,
}));

vi.mock("./context.js", () => ({
  getOrgContext: (...args: any[]) => mockGetOrgContext(...args),
  createOrganization: vi.fn(),
}));

vi.mock("../extensions/url-safety.js", () => ({
  ssrfSafeFetch: vi.fn(),
}));

vi.mock("../server/app-url.js", () => ({
  getAppProductionUrl: () => "https://app.example.test",
}));

vi.mock("../server/auth.js", () => ({
  getSession: vi.fn(),
}));

vi.mock("../server/email-templates.js", () => ({
  renderInviteEmail: vi.fn(() => ({ subject: "", html: "", text: "" })),
}));

vi.mock("../server/email.js", () => ({
  isEmailConfigured: vi.fn(() => false),
  sendEmail: vi.fn(),
}));

vi.mock("../server/h3-helpers.js", () => ({
  readBody: (event: any) => Promise.resolve(event._body),
}));

vi.mock("../settings/user-settings.js", () => ({
  putUserSetting: vi.fn(),
}));

import { putUserSetting } from "../settings/user-settings.js";
import {
  listMembersHandler,
  deleteOrgHandler,
  changeMemberRoleHandler,
  updateOrgHandler,
  setDomainHandler,
} from "./handlers.js";
import {
  cachedMemberships,
  __resetProcessMemberOrgCacheForTests,
} from "./request-org-cache.js";

function makeEvent(path: string, body?: unknown) {
  return { _url: `https://app.example.test${path}`, _body: body } as any;
}

describe("org handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOrgContext.mockResolvedValue({
      email: "owner@example.test",
      orgId: "org-1",
      orgName: "Example",
      role: "owner",
    });
    mockExecute.mockResolvedValue({ rows: [], rowsAffected: 0 });
  });

  it("uses a non-backslash LIKE escape for paginated member search", async () => {
    await listMembersHandler(
      makeEvent("/_agent-native/org/members?q=Alice%25_Bob!&limit=8&offset=16"),
    );

    expect(mockExecute).toHaveBeenCalledTimes(1);
    const call = mockExecute.mock.calls[0][0];
    expect(call.sql).toContain("LOWER(email) LIKE ? ESCAPE '!'");
    expect(call.sql).toContain("LIMIT ? OFFSET ?");
    expect(call.sql).not.toContain("ESCAPE '\\'");
    expect(call.args).toEqual(["org-1", "%alice!%!_bob!!%", 9, 16]);
  });

  describe("deleteOrgHandler", () => {
    it("deletes invitations, settings, members, and the org, then repoints active-org-id", async () => {
      mockExecute
        .mockResolvedValueOnce({ rows: [{ name: "Example" }], rowsAffected: 0 }) // SELECT name
        .mockResolvedValueOnce({ rows: [], rowsAffected: 2 }) // DELETE org_invitations
        .mockResolvedValueOnce({ rows: [], rowsAffected: 4 }) // DELETE app_secrets
        .mockResolvedValueOnce({ rows: [], rowsAffected: 5 }) // DELETE settings
        .mockResolvedValueOnce({ rows: [], rowsAffected: 3 }) // DELETE org_members
        .mockResolvedValueOnce({ rows: [], rowsAffected: 1 }) // DELETE organizations
        .mockResolvedValueOnce({ rows: [{ orgId: "org-2" }], rowsAffected: 0 }); // SELECT next org

      const result = await deleteOrgHandler(
        makeEvent("/_agent-native/org", { name: "  example  " }),
      );

      expect(result).toEqual({
        success: true,
        orgId: "org-1",
        nextOrgId: "org-2",
      });

      expect(mockTransaction).toHaveBeenCalledTimes(1);
      expect(mockExecute).toHaveBeenCalledTimes(7);
      expect(mockExecute.mock.calls[1][0].sql).toContain(
        "DELETE FROM org_invitations WHERE org_id = ?",
      );
      expect(mockExecute.mock.calls[1][0].args).toEqual(["org-1"]);
      expect(mockExecute.mock.calls[2][0].sql).toContain(
        "DELETE FROM app_secrets WHERE scope IN ('org', 'workspace') AND scope_id = ?",
      );
      expect(mockExecute.mock.calls[2][0].args).toEqual(["org-1"]);
      expect(mockExecute.mock.calls[3][0].sql).toContain(
        "DELETE FROM settings WHERE key LIKE ? ESCAPE '!'",
      );
      expect(mockExecute.mock.calls[3][0].args).toEqual(["o:org-1:%"]);
      expect(mockExecute.mock.calls[4][0].sql).toContain(
        "DELETE FROM org_members WHERE org_id = ?",
      );
      expect(mockExecute.mock.calls[4][0].args).toEqual(["org-1"]);
      expect(mockExecute.mock.calls[5][0].sql).toContain(
        "DELETE FROM organizations WHERE id = ?",
      );
      expect(mockExecute.mock.calls[5][0].args).toEqual(["org-1"]);

      expect(putUserSetting).toHaveBeenCalledWith(
        "owner@example.test",
        "active-org-id",
        {
          orgId: "org-2",
        },
      );
    });

    it("repoints active-org-id to null (Personal) when the caller has no other org", async () => {
      mockExecute
        .mockResolvedValueOnce({ rows: [{ name: "Example" }], rowsAffected: 0 })
        .mockResolvedValueOnce({ rows: [], rowsAffected: 2 })
        .mockResolvedValueOnce({ rows: [], rowsAffected: 4 })
        .mockResolvedValueOnce({ rows: [], rowsAffected: 5 })
        .mockResolvedValueOnce({ rows: [], rowsAffected: 3 })
        .mockResolvedValueOnce({ rows: [], rowsAffected: 1 })
        .mockResolvedValueOnce({ rows: [], rowsAffected: 0 }); // no other membership

      const result = await deleteOrgHandler(
        makeEvent("/_agent-native/org", { name: "Example" }),
      );

      expect(result).toEqual({
        success: true,
        orgId: "org-1",
        nextOrgId: null,
      });
      expect(putUserSetting).toHaveBeenCalledWith(
        "owner@example.test",
        "active-org-id",
        {
          orgId: null,
        },
      );
    });

    it("rejects a non-owner with 403 and performs no queries", async () => {
      mockGetOrgContext.mockResolvedValue({
        email: "admin@example.test",
        orgId: "org-1",
        orgName: "Example",
        role: "admin",
      });

      await expect(
        deleteOrgHandler(makeEvent("/_agent-native/org", { name: "Example" })),
      ).rejects.toMatchObject({
        statusCode: 403,
        message: "Only the organization owner can delete an organization",
      });
      expect(mockExecute).not.toHaveBeenCalled();
      expect(putUserSetting).not.toHaveBeenCalled();
    });

    it("rejects a mismatched confirmation name with 400 and performs no deletes", async () => {
      mockExecute.mockResolvedValueOnce({
        rows: [{ name: "Example" }],
        rowsAffected: 0,
      });

      await expect(
        deleteOrgHandler(
          makeEvent("/_agent-native/org", { name: "Not The Org Name" }),
        ),
      ).rejects.toMatchObject({
        statusCode: 400,
        message: "Organization name does not match",
      });
      expect(mockExecute).toHaveBeenCalledTimes(1);
      expect(mockTransaction).not.toHaveBeenCalled();
      expect(putUserSetting).not.toHaveBeenCalled();
    });

    it("rejects with 400 when there is no active organization", async () => {
      mockGetOrgContext.mockResolvedValue({
        email: "owner@example.test",
        orgId: null,
        orgName: null,
        role: null,
      });

      await expect(
        deleteOrgHandler(makeEvent("/_agent-native/org", { name: "Example" })),
      ).rejects.toMatchObject({ statusCode: 400 });
      expect(mockExecute).not.toHaveBeenCalled();
    });
  });

  // `cachedMemberships` holds a JOIN of org_members and organizations for 15s
  // across requests. Anything that edits a column inside that projection —
  // `role`, `name`, `allowed_domain` — must evict it, or the process keeps
  // authorizing and rendering from the pre-write snapshot until the TTL lapses.
  describe("membership cache invalidation", () => {
    function seedCachedMemberships() {
      const load = vi.fn(async () => [{ orgId: "org-1", role: "admin" }]);
      return {
        load,
        prime: () => cachedMemberships("member@example.test", load),
      };
    }

    beforeEach(() => {
      __resetProcessMemberOrgCacheForTests();
    });

    it("evicts the cached role when a member is demoted", async () => {
      const { load, prime } = seedCachedMemberships();
      await prime();
      await prime();
      expect(load).toHaveBeenCalledTimes(1);

      mockExecute.mockResolvedValue({ rows: [{ role: "admin" }] });
      await changeMemberRoleHandler(
        makeEvent("/_agent-native/org/members/member@example.test/role", {
          role: "member",
        }),
      );

      await prime();
      expect(load).toHaveBeenCalledTimes(2);
    });

    it("evicts the cached org name when the org is renamed", async () => {
      const { load, prime } = seedCachedMemberships();
      await prime();
      expect(load).toHaveBeenCalledTimes(1);

      await updateOrgHandler(
        makeEvent("/_agent-native/org", { name: "Renamed" }),
      );

      await prime();
      expect(load).toHaveBeenCalledTimes(2);
    });

    it("evicts the cached allowed domain when domain auto-join is set", async () => {
      const { load, prime } = seedCachedMemberships();
      await prime();
      expect(load).toHaveBeenCalledTimes(1);

      await setDomainHandler(
        makeEvent("/_agent-native/org/domain", { domain: "example.test" }),
      );

      await prime();
      expect(load).toHaveBeenCalledTimes(2);
    });
  });
});
