import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseJobFrontmatter } from "./scheduler.js";
import { createJobTools } from "./tools.js";

// ── Mocks ──────────────────────────────────────────────────────────────────
const resourcePutMock = vi.hoisted(() => vi.fn());
const resourceGetByPathMock = vi.hoisted(() => vi.fn());
const resourceListMock = vi.hoisted(() => vi.fn());
const resourceDeleteMock = vi.hoisted(() => vi.fn());

const getRequestUserEmailMock = vi.hoisted(() => vi.fn());
const getRequestOrgIdMock = vi.hoisted(() => vi.fn());
const getIntegrationRequestContextMock = vi.hoisted(() => vi.fn());

const dbExecuteMock = vi.hoisted(() => vi.fn());

vi.mock("../resources/store.js", () => ({
  resourcePut: resourcePutMock,
  resourceGetByPath: resourceGetByPathMock,
  resourceList: resourceListMock,
  resourceDelete: resourceDeleteMock,
  sharedResourceOwner: (orgId?: string | null) =>
    orgId ? `__organization__:${orgId}` : "__shared__",
  organizationIdFromResourceOwner: (owner: string) =>
    owner.startsWith("__organization__:")
      ? owner.slice("__organization__:".length)
      : null,
  SHARED_OWNER: "__shared__",
}));

vi.mock("../server/request-context.js", () => ({
  getRequestUserEmail: getRequestUserEmailMock,
  getRequestOrgId: getRequestOrgIdMock,
  getIntegrationRequestContext: getIntegrationRequestContextMock,
}));

// Partial-mock db/client so the org-admin lookup is stubbed while other
// exports (getDialect, etc.) used transitively by db/schema stay real.
vi.mock(import("../db/client.js"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getDbExec: () => ({ execute: dbExecuteMock }) as any,
  };
});

const SHARED_OWNER = "__organization__:org-1";

function run(args: Record<string, unknown>): Promise<string> {
  const tools = createJobTools();
  return tools["manage-jobs"].run(args as any, {} as any) as Promise<string>;
}

function sharedJobContent(opts: {
  createdBy?: string;
  orgId?: string;
  runAs?: string;
}): string {
  const lines = ["---", 'schedule: "0 9 * * *"', "enabled: true"];
  if (opts.createdBy) lines.push(`createdBy: ${opts.createdBy}`);
  if (opts.orgId) lines.push(`orgId: ${opts.orgId}`);
  if (opts.runAs) lines.push(`runAs: ${opts.runAs}`);
  lines.push("---", "", "Summarize the inbox.");
  return lines.join("\n");
}

describe("manage-jobs tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRequestUserEmailMock.mockReturnValue("alice@example.com");
    getRequestOrgIdMock.mockReturnValue("org-1");
    getIntegrationRequestContextMock.mockReturnValue(undefined);
    resourcePutMock.mockResolvedValue(undefined);
    resourceDeleteMock.mockResolvedValue(true);
  });

  describe("create", () => {
    it("validates required fields", async () => {
      const out = JSON.parse(await run({ action: "create", name: "x" }));
      expect(out.error).toMatch(
        /name, schedule, and instructions are required/,
      );
      expect(resourcePutMock).not.toHaveBeenCalled();
    });

    it("rejects an invalid cron schedule", async () => {
      const out = JSON.parse(
        await run({
          action: "create",
          name: "x",
          schedule: "not a cron",
          instructions: "do it",
        }),
      );
      expect(out.error).toMatch(/Invalid cron expression/);
      expect(resourcePutMock).not.toHaveBeenCalled();
    });

    it("creates a shared job in the active org partition", async () => {
      const out = JSON.parse(
        await run({
          action: "create",
          name: "daily-report",
          schedule: "0 9 * * *",
          instructions: "Summarize the inbox.",
        }),
      );

      expect(out.created).toBe(true);
      expect(out.path).toBe("jobs/daily-report.md");
      expect(out.scope).toBe("shared");
      expect(typeof out.nextRun).toBe("string");

      const [owner, path, content] = resourcePutMock.mock.calls[0];
      expect(owner).toBe(SHARED_OWNER);
      expect(path).toBe("jobs/daily-report.md");
      const { meta } = parseJobFrontmatter(content);
      expect(meta.createdBy).toBe("alice@example.com");
      expect(meta.orgId).toBe("org-1");
      // Default runAs is "creator" unless explicitly "shared".
      expect(meta.runAs).toBe("creator");
      expect(meta.nextRun).toBeTruthy();
    });

    it("creates a personal job owned by the caller", async () => {
      await run({
        action: "create",
        name: "my-job",
        schedule: "0 9 * * *",
        instructions: "do it",
        scope: "personal",
      });
      expect(resourcePutMock.mock.calls[0][0]).toBe("alice@example.com");
    });

    it("partitions shared jobs by the active request org", async () => {
      getRequestOrgIdMock.mockReturnValue("org-2");
      await run({
        action: "create",
        name: "org-two-job",
        schedule: "0 9 * * *",
        instructions: "do it",
      });

      expect(resourcePutMock.mock.calls[0][0]).toBe("__organization__:org-2");
    });

    it("honors runAs: shared when requested", async () => {
      await run({
        action: "create",
        name: "j",
        schedule: "0 9 * * *",
        instructions: "do it",
        runAs: "shared",
      });
      const { meta } = parseJobFrontmatter(resourcePutMock.mock.calls[0][2]);
      expect(meta.runAs).toBe("shared");
    });

    it("binds routines created from a messaging scope back to that channel", async () => {
      getIntegrationRequestContextMock.mockReturnValue({
        scopeId: "scope:slack:T1:C1",
        incoming: {
          platform: "slack",
          tenantId: "T1",
          threadRef: "123.456",
          platformContext: { channelId: "C1" },
        },
      });

      await run({
        action: "create",
        name: "channel-digest",
        schedule: "0 9 * * *",
        instructions: "Post the digest.",
        model: "channel-model",
      });

      const { meta } = parseJobFrontmatter(resourcePutMock.mock.calls[0][2]);
      expect(meta).toMatchObject({
        originScopeId: "scope:slack:T1:C1",
        deliveryPlatform: "slack",
        deliveryDestination: "C1",
        deliveryThreadRef: "123.456",
        deliveryTenantId: "T1",
        model: "channel-model",
      });
    });
  });

  describe("update authorization (shared-job privilege escalation guard)", () => {
    it("lets the original creator update their shared job", async () => {
      resourceGetByPathMock.mockResolvedValueOnce({
        id: "r1",
        owner: SHARED_OWNER,
        path: "jobs/j.md",
        content: sharedJobContent({ createdBy: "alice@example.com" }),
      });

      const out = JSON.parse(
        await run({ action: "update", name: "j", enabled: "false" }),
      );
      expect(out.updated).toBe(true);
      expect(out.enabled).toBe(false);
      expect(resourcePutMock).toHaveBeenCalledTimes(1);
    });

    it("BLOCKS a non-creator non-admin from updating another user's shared job", async () => {
      // Caller is mallory; job was created by alice; mallory is not an admin.
      getRequestUserEmailMock.mockReturnValue("mallory@example.com");
      resourceGetByPathMock.mockResolvedValueOnce({
        id: "r1",
        owner: SHARED_OWNER,
        path: "jobs/j.md",
        content: sharedJobContent({
          createdBy: "alice@example.com",
          orgId: "org-1",
        }),
      });
      // org_members lookup returns no membership row -> not admin.
      dbExecuteMock.mockResolvedValue({ rows: [] });

      const out = JSON.parse(
        await run({ action: "update", name: "j", instructions: "evil" }),
      );

      expect(out.error).toMatch(/Only the job's creator \(or an org admin\)/);
      // The mutation must never reach the store.
      expect(resourcePutMock).not.toHaveBeenCalled();
    });

    it("ALLOWS an org admin to update another user's shared job", async () => {
      getRequestUserEmailMock.mockReturnValue("admin@example.com");
      resourceGetByPathMock.mockResolvedValueOnce({
        id: "r1",
        owner: SHARED_OWNER,
        path: "jobs/j.md",
        content: sharedJobContent({
          createdBy: "alice@example.com",
          orgId: "org-1",
        }),
      });
      // Membership row with admin role.
      dbExecuteMock.mockResolvedValue({ rows: [{ role: "owner" }] });

      const out = JSON.parse(
        await run({ action: "update", name: "j", enabled: "false" }),
      );
      expect(out.updated).toBe(true);
      expect(resourcePutMock).toHaveBeenCalledTimes(1);
    });

    it("fails closed (denies) when the admin role lookup throws", async () => {
      getRequestUserEmailMock.mockReturnValue("mallory@example.com");
      resourceGetByPathMock.mockResolvedValueOnce({
        id: "r1",
        owner: SHARED_OWNER,
        path: "jobs/j.md",
        content: sharedJobContent({
          createdBy: "alice@example.com",
          orgId: "org-1",
        }),
      });
      dbExecuteMock.mockRejectedValue(new Error("db error"));

      const out = JSON.parse(
        await run({ action: "update", name: "j", enabled: "false" }),
      );
      expect(out.error).toMatch(/Only the job's creator/);
      expect(resourcePutMock).not.toHaveBeenCalled();
    });

    it("allows a personal-scope job update without an admin check", async () => {
      // resource owner is the caller, not SHARED_OWNER -> authorizeJobMutation
      // returns null immediately and never queries org_members.
      resourceGetByPathMock
        .mockResolvedValueOnce(null) // shared lookup misses
        .mockResolvedValueOnce({
          id: "r2",
          owner: "alice@example.com",
          path: "jobs/j.md",
          content: sharedJobContent({ createdBy: "alice@example.com" }),
        });

      const out = JSON.parse(
        await run({ action: "update", name: "j", enabled: "false" }),
      );
      expect(out.updated).toBe(true);
      expect(dbExecuteMock).not.toHaveBeenCalled();
    });
  });

  describe("update behavior", () => {
    it("returns an error when the job is not found", async () => {
      resourceGetByPathMock.mockResolvedValue(null);
      const out = JSON.parse(await run({ action: "update", name: "ghost" }));
      expect(out.error).toMatch(/Job "ghost" not found/);
    });

    it("rejects an invalid new schedule and does not persist", async () => {
      resourceGetByPathMock.mockResolvedValueOnce({
        id: "r1",
        owner: SHARED_OWNER,
        path: "jobs/j.md",
        content: sharedJobContent({ createdBy: "alice@example.com" }),
      });
      const out = JSON.parse(
        await run({ action: "update", name: "j", schedule: "garbage" }),
      );
      expect(out.error).toMatch(/Invalid cron expression/);
      expect(resourcePutMock).not.toHaveBeenCalled();
    });

    it("recomputes nextRun when a valid new schedule is supplied", async () => {
      resourceGetByPathMock.mockResolvedValueOnce({
        id: "r1",
        owner: SHARED_OWNER,
        path: "jobs/j.md",
        content: sharedJobContent({ createdBy: "alice@example.com" }),
      });
      const out = JSON.parse(
        await run({ action: "update", name: "j", schedule: "*/30 * * * *" }),
      );
      expect(out.schedule).toBe("*/30 * * * *");
      expect(out.nextRun).toBeTruthy();
      const { meta } = parseJobFrontmatter(resourcePutMock.mock.calls[0][2]);
      expect(meta.schedule).toBe("*/30 * * * *");
    });
  });

  describe("delete", () => {
    it("deletes a shared job by its creator", async () => {
      resourceGetByPathMock.mockResolvedValueOnce({
        id: "r1",
        owner: SHARED_OWNER,
        path: "jobs/j.md",
        content: sharedJobContent({ createdBy: "alice@example.com" }),
      });
      const out = JSON.parse(await run({ action: "delete", name: "j" }));
      expect(out.deleted).toBe(true);
      expect(resourceDeleteMock).toHaveBeenCalledWith("r1");
    });

    it("BLOCKS deleting another user's shared job and never calls resourceDelete", async () => {
      getRequestUserEmailMock.mockReturnValue("mallory@example.com");
      resourceGetByPathMock.mockResolvedValueOnce({
        id: "r1",
        owner: SHARED_OWNER,
        path: "jobs/j.md",
        content: sharedJobContent({
          createdBy: "alice@example.com",
          orgId: "org-1",
        }),
      });
      dbExecuteMock.mockResolvedValue({ rows: [] });

      const out = JSON.parse(await run({ action: "delete", name: "j" }));
      expect(out.error).toMatch(/Only the job's creator/);
      expect(resourceDeleteMock).not.toHaveBeenCalled();
    });

    it("returns not-found for a missing job", async () => {
      resourceGetByPathMock.mockResolvedValue(null);
      const out = JSON.parse(await run({ action: "delete", name: "ghost" }));
      expect(out.error).toMatch(/not found/);
    });
  });

  describe("list", () => {
    it("merges the caller's personal and shared jobs (org isolation: no other users')", async () => {
      // resourceList is called for the caller and active org partition.
      resourceListMock.mockImplementation(async (owner: string) => {
        if (owner === "alice@example.com") {
          return [{ owner: "alice@example.com", path: "jobs/personal.md" }];
        }
        return [{ owner: SHARED_OWNER, path: "jobs/team.md" }];
      });
      resourceGetByPathMock.mockImplementation(
        async (_owner: string, path: string) => ({
          id: path,
          owner: _owner,
          path,
          content: sharedJobContent({ createdBy: "alice@example.com" }),
        }),
      );

      const jobs = JSON.parse(await run({ action: "list" }));
      const names = jobs.map((j: any) => j.name).sort();
      expect(names).toEqual(["personal", "team"]);
      const scopes = Object.fromEntries(
        jobs.map((j: any) => [j.name, j.scope]),
      );
      expect(scopes.personal).toBe("personal");
      expect(scopes.team).toBe("shared");

      // The two list queries are scoped to the caller and SHARED_OWNER only —
      // never an arbitrary other user.
      const queriedOwners = resourceListMock.mock.calls.map((c) => c[0]).sort();
      expect(queriedOwners).toEqual([SHARED_OWNER, "alice@example.com"].sort());
    });

    it("filters to personal scope only", async () => {
      resourceListMock.mockImplementation(async (owner: string) =>
        owner === "alice@example.com"
          ? [{ owner: "alice@example.com", path: "jobs/personal.md" }]
          : [{ owner: SHARED_OWNER, path: "jobs/team.md" }],
      );
      resourceGetByPathMock.mockResolvedValue({
        content: sharedJobContent({ createdBy: "alice@example.com" }),
      });

      const jobs = JSON.parse(await run({ action: "list", scope: "personal" }));
      expect(jobs.map((j: any) => j.name)).toEqual(["personal"]);
    });

    it("never lists another org's shared partition", async () => {
      resourceListMock.mockResolvedValue([]);

      await run({ action: "list", scope: "shared" });

      expect(resourceListMock).toHaveBeenCalledWith(
        "__organization__:org-1",
        "jobs/",
      );
      expect(resourceListMock).not.toHaveBeenCalledWith(
        "__organization__:org-2",
        "jobs/",
      );
    });

    it("returns the empty-state message when there are no jobs", async () => {
      resourceListMock.mockResolvedValue([]);
      const out = await run({ action: "list" });
      expect(out).toMatch(/No recurring jobs configured/);
    });

    it("ignores .keep placeholder files", async () => {
      resourceListMock.mockImplementation(async (owner: string) =>
        owner === "alice@example.com"
          ? [{ owner: "alice@example.com", path: "jobs/.keep" }]
          : [],
      );
      const out = await run({ action: "list" });
      expect(out).toMatch(/No recurring jobs configured/);
    });
  });

  describe("unknown action", () => {
    it("returns an error for an unrecognized action", async () => {
      const out = JSON.parse(await run({ action: "frobnicate" }));
      expect(out.error).toMatch(/Unknown action "frobnicate"/);
    });
  });

  describe("unauthenticated caller", () => {
    it("throws when there is no authenticated user (getOwner guard)", async () => {
      getRequestUserEmailMock.mockReturnValue(undefined);
      await expect(run({ action: "list" })).rejects.toThrow(
        /no authenticated user/,
      );
    });
  });
});
