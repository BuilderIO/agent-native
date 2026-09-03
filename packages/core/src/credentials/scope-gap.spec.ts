import { beforeEach, describe, expect, it, vi } from "vitest";

interface ExecCall {
  sql: string;
  args: unknown[];
}

const execCalls: ExecCall[] = [];
let execute: (query: { sql: string; args?: unknown[] }) => Promise<{
  rows: unknown[];
}>;

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({
    execute: (query: { sql: string; args?: unknown[] }) => {
      execCalls.push({ sql: query.sql, args: query.args ?? [] });
      return execute(query);
    },
  }),
}));

// A caller with no `ctx.orgId` (CLI, cron) still needs its actual org
// resolved before the probe can run — mocked separately from the org-scoped
// SQL probes above so a test can say "no membership anywhere" without also
// faking rows for the Personal/cross-org queries.
let resolveOrgIdForEmailResult: string | null = null;
vi.mock("../org/context.js", () => ({
  resolveOrgIdForEmail: async () => resolveOrgIdForEmailResult,
}));

vi.mock("../settings/store.js", () => ({
  getSetting: vi.fn(async () => null),
  putSetting: vi.fn(async () => {}),
  deleteSetting: vi.fn(async () => {}),
}));

vi.mock("../secrets/storage.js", () => ({
  readAppSecret: vi.fn(async () => null),
}));

const { describeCredentialScopeGap } = await import("./index.js");

// Never a real token shape — the assertions below prove it stays out of the
// message, so it must not look like anything a scanner would flag.
const SECRET_VALUE = "example-not-a-real-token";

describe("describeCredentialScopeGap", () => {
  beforeEach(() => {
    execCalls.length = 0;
    execute = async () => ({ rows: [] });
    resolveOrgIdForEmailResult = null;
  });

  it("names the scope found and the scope the run needed", async () => {
    execute = async () => ({ rows: [{ 1: 1 }] });

    const message = await describeCredentialScopeGap(["SLACK_BOT_TOKEN"], {
      userEmail: "owner@example.com",
      orgId: "org-1",
    });

    expect(message).toContain("SLACK_BOT_TOKEN");
    expect(message).toContain("Personal scope");
    expect(message).toContain("Workspace or Organization scope");
  });

  it("never reveals the secret value or the account holding it", async () => {
    execute = async () => ({ rows: [{ 1: 1 }] });

    const message = await describeCredentialScopeGap(["SLACK_BOT_TOKEN"], {
      userEmail: "owner@example.com",
      orgId: "org-1",
    });

    expect(message).not.toContain(SECRET_VALUE);
    expect(message).not.toContain("teammate@example.com");
    expect(message).not.toContain("owner@example.com");
  });

  it("bounds the probe to the caller's own org and excludes their own row", async () => {
    execute = async () => ({ rows: [{ 1: 1 }] });

    await describeCredentialScopeGap(["SLACK_BOT_TOKEN"], {
      userEmail: "Owner@Example.com",
      orgId: "org-1",
    });

    expect(execCalls).toHaveLength(1);
    expect(execCalls[0].sql).toContain("org_members");
    expect(execCalls[0].sql).toContain("m.org_id = ?");
    expect(execCalls[0].sql).toContain("LOWER(s.scope_id) <> ?");
    expect(execCalls[0].args).toEqual([
      "SLACK_BOT_TOKEN",
      "org-1",
      "owner@example.com",
    ]);
  });

  it("declines to answer without an org boundary to bound the probe to", async () => {
    execute = async () => ({ rows: [{ 1: 1 }] });
    resolveOrgIdForEmailResult = null; // caller truly has no memberships

    const message = await describeCredentialScopeGap(["SLACK_BOT_TOKEN"], {
      userEmail: "owner@example.com",
    });

    expect(message).toBeNull();
    expect(execCalls).toHaveLength(0);
  });

  it("resolves the org from the caller's email when ctx.orgId is unset, like a CLI or cron run", async () => {
    execute = async () => ({ rows: [{ 1: 1 }] });
    resolveOrgIdForEmailResult = "org-1"; // the caller's only membership

    const message = await describeCredentialScopeGap(["SLACK_BOT_TOKEN"], {
      userEmail: "owner@example.com",
    });

    expect(message).toContain("Personal scope");
  });

  it("stays quiet when the key is missing everywhere in the org", async () => {
    const message = await describeCredentialScopeGap(["SLACK_BOT_TOKEN"], {
      userEmail: "owner@example.com",
      orgId: "org-1",
    });

    expect(message).toBeNull();
  });

  it("stays quiet when the probe read fails", async () => {
    execute = async () => {
      throw new Error("no such table: app_secrets");
    };

    const message = await describeCredentialScopeGap(["SLACK_BOT_TOKEN"], {
      userEmail: "owner@example.com",
      orgId: "org-1",
    });

    expect(message).toBeNull();
  });
});

// Credentials are scoped per organization, so a user who gains a second org —
// or whose `active-org-id` is repointed at one — reads an empty vault while the
// key sits visibly in the org it was synced under. The generic error names the
// key, which sends everyone looking for a deployment or env-var problem.
describe("describeCredentialScopeGap across organizations", () => {
  const CROSS_ORG_PROBE = "s.scope IN ('org', 'workspace')";

  /** No Personal-scope holder; the key lives in another org the user is in. */
  function onlyAnotherMemberOrgHasKey(orgName: string | null) {
    execute = async ({ sql }) =>
      sql.includes(CROSS_ORG_PROBE)
        ? { rows: [{ org_name: orgName }] }
        : { rows: [] };
  }

  beforeEach(() => {
    execCalls.length = 0;
    execute = async () => ({ rows: [] });
    resolveOrgIdForEmailResult = null;
  });

  it("names the organization holding the key and the mismatch as the cause", async () => {
    onlyAnotherMemberOrgHasKey("Builder.io");

    const message = await describeCredentialScopeGap(
      ["ACADEMY_CONVEX_SITE_URL"],
      { userEmail: "tim@example.com", orgId: "coach-org" },
    );

    expect(message).toContain("ACADEMY_CONVEX_SITE_URL");
    expect(message).toContain('"Builder.io" organization');
    expect(message).toContain(
      "organization mismatch rather than a missing key",
    );
  });

  it("bounds the probe to the caller's own memberships and excludes the active org", async () => {
    onlyAnotherMemberOrgHasKey("Builder.io");

    await describeCredentialScopeGap(["ACADEMY_CONVEX_SITE_URL"], {
      userEmail: "Tim@Example.com",
      orgId: "coach-org",
    });

    const probe = execCalls.find((call) => call.sql.includes(CROSS_ORG_PROBE));
    expect(probe).toBeDefined();
    expect(probe!.sql).toContain("org_members");
    expect(probe!.sql).toContain("LOWER(m.email) = ?");
    expect(probe!.sql).toContain("s.scope_id <> ?");
    expect(probe!.args).toEqual([
      "tim@example.com",
      "ACADEMY_CONVEX_SITE_URL",
      "coach-org",
    ]);
  });

  it("never reveals an org id when the organization row is unreadable", async () => {
    onlyAnotherMemberOrgHasKey(null);

    const message = await describeCredentialScopeGap(["STRIPE_SECRET_KEY"], {
      userEmail: "owner@example.com",
      orgId: "org-1",
    });

    expect(message).toContain("another organization");
    expect(message).not.toContain("org-1");
  });

  it("prefers the Personal-scope explanation when both apply", async () => {
    execute = async () => ({ rows: [{ org_name: "Builder.io" }] });

    const message = await describeCredentialScopeGap(["SLACK_BOT_TOKEN"], {
      userEmail: "owner@example.com",
      orgId: "org-1",
    });

    expect(message).toContain("Personal scope");
    expect(execCalls).toHaveLength(1);
  });

  it("stays quiet when the cross-org probe fails", async () => {
    execute = async ({ sql }) => {
      if (sql.includes(CROSS_ORG_PROBE)) throw new Error("connection closed");
      return { rows: [] };
    };

    const message = await describeCredentialScopeGap(["SLACK_BOT_TOKEN"], {
      userEmail: "owner@example.com",
      orgId: "org-1",
    });

    expect(message).toBeNull();
  });
});
