import { beforeEach, describe, expect, it, vi } from "vitest";

import { runWithRequestContext } from "../server/request-context.js";

interface ExecCall {
  sql: string;
  args: unknown[];
}

const execCalls: ExecCall[] = [];
let execute: (query: { sql: string; args?: unknown[] }) => Promise<{
  rows: unknown[];
}>;

vi.mock("../db/client.js", () => ({
  getEnclosingTransactionDbExec: () => undefined,
  getDbExec: () => ({
    execute: (query: { sql: string; args?: unknown[] }) => {
      execCalls.push({ sql: query.sql, args: query.args ?? [] });
      return execute(query);
    },
  }),
}));

let resolveOrgIdForEmailResult: string | null = null;
vi.mock("../org/context.js", () => ({
  resolveOrgIdForEmail: async () => resolveOrgIdForEmailResult,
}));

vi.mock("../settings/store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../settings/store.js")>()),
  getSetting: vi.fn(async () => null),
  putSetting: vi.fn(async () => {}),
  deleteSetting: vi.fn(async () => {}),
}));

vi.mock("../secrets/storage.js", () => ({
  readAppSecret: vi.fn(async () => null),
  isMissingAppSecretsTableError: () => false,
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

  it.each([
    ["a person's own chat", {}, {}],
    ["an integration delivery", { isIntegrationCaller: true }, {}],
    ["an org-level A2A caller", { a2aIdentityAssurance: "organization" }, {}],
    [
      "a verified service token",
      {
        verifiedServiceIdentity: {
          userEmail: "owner@example.com",
          orgId: "org-1",
        },
      },
      {},
    ],
    ["a shared-keys-only lookup", {}, { credentialScope: "org" }],
  ] as const)(
    "gives %s the cause and fix that hold for every reader",
    async (_label, requestContext, lookup) => {
      execute = async () => ({ rows: [{ 1: 1 }] });

      const message = await runWithRequestContext(requestContext, () =>
        describeCredentialScopeGap(["GITHUB_TOKEN"], {
          userEmail: "owner@example.com",
          orgId: "org-1",
          ...lookup,
        }),
      );

      expect(message).toBe(
        "Ask an organization owner or admin to save it with Workspace or " +
          "Organization scope. This workspace has it only as a Personal " +
          "key, which works only for the member who saved it.",
      );
      expect(message).not.toContain("integration");
      expect(message).not.toContain("Save your own");
    },
  );

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
    resolveOrgIdForEmailResult = null;

    const message = await describeCredentialScopeGap(["SLACK_BOT_TOKEN"], {
      userEmail: "owner@example.com",
    });

    expect(message).toBeNull();
    expect(execCalls).toHaveLength(0);
  });

  it("resolves the org from the caller's email when ctx.orgId is unset, like a CLI or cron run", async () => {
    execute = async () => ({ rows: [{ 1: 1 }] });
    resolveOrgIdForEmailResult = "org-1";

    const message = await describeCredentialScopeGap(["SLACK_BOT_TOKEN"], {
      userEmail: "owner@example.com",
    });

    expect(message).toContain("Personal key");
  });

  it("ends by naming the key it found when several were tried", async () => {
    execute = async ({ args }) =>
      args?.[0] === "GH_TOKEN" ? { rows: [{ 1: 1 }] } : { rows: [] };

    const message = await describeCredentialScopeGap(
      ["GITHUB_TOKEN", "GH_TOKEN"],
      { userEmail: "owner@example.com", orgId: "org-1" },
    );

    expect(message).toBe(
      "Ask an organization owner or admin to save it with Workspace or " +
        "Organization scope. This workspace has it only as a Personal " +
        "key, which works only for the member who saved it. The saved key " +
        "is GH_TOKEN.",
    );
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
      throw new Error('relation "app_secrets" does not exist');
    };

    const message = await describeCredentialScopeGap(["SLACK_BOT_TOKEN"], {
      userEmail: "owner@example.com",
      orgId: "org-1",
    });

    expect(message).toBeNull();
  });
});

describe("describeCredentialScopeGap across organizations", () => {
  const CROSS_ORG_PROBE = "s.scope IN ('org', 'workspace')";

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

  it("leads with both fixes, naming the organization holding the key but not the key, then the cause", async () => {
    onlyAnotherMemberOrgHasKey("Builder.io");

    const message = await describeCredentialScopeGap(
      ["ACADEMY_CONVEX_SITE_URL"],
      { userEmail: "tim@example.com", orgId: "coach-org" },
    );

    // oracle-change: the message was reworded fix-first; one exact match replaces three partial matches on the old wording
    expect(message).toBe(
      "Save it in this organization, or switch your active organization " +
        "to \"Builder.io\", where it's saved. Credentials aren't shared " +
        "between organizations.",
    );
  });

  it("ends by naming the key it found when several were tried", async () => {
    execute = async ({ sql, args }) =>
      sql.includes(CROSS_ORG_PROBE) && args?.[1] === "GH_TOKEN"
        ? { rows: [{ org_name: "Builder.io" }] }
        : { rows: [] };

    const message = await describeCredentialScopeGap(
      ["GITHUB_TOKEN", "GH_TOKEN"],
      { userEmail: "owner@example.com", orgId: "org-1" },
    );

    expect(message).toBe(
      "Save it in this organization, or switch your active organization " +
        "to \"Builder.io\", where it's saved. Credentials aren't shared " +
        "between organizations. The saved key is GH_TOKEN.",
    );
  });

  it("trims the organization's name", async () => {
    onlyAnotherMemberOrgHasKey("  Builder.io  ");

    const message = await describeCredentialScopeGap(["GITHUB_TOKEN"], {
      userEmail: "owner@example.com",
      orgId: "org-1",
    });

    expect(message).toContain('organization to "Builder.io", where');
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

    expect(message).toMatch(
      /^Save it in this organization, or switch your active organization to one where it's saved\. /,
    );
    expect(message).not.toContain("org-1");
  });

  it("prefers the Personal-scope explanation when both apply", async () => {
    execute = async () => ({ rows: [{ org_name: "Builder.io" }] });

    const message = await describeCredentialScopeGap(["SLACK_BOT_TOKEN"], {
      userEmail: "owner@example.com",
      orgId: "org-1",
    });

    expect(message).toContain("Personal key");
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

  it("does not inspect another org for an org-member assertion", async () => {
    execute = async ({ sql }) =>
      sql.includes(CROSS_ORG_PROBE)
        ? { rows: [{ org_name: "Other Org" }] }
        : { rows: [] };

    const message = await runWithRequestContext(
      {
        a2aIdentityAssurance: "org-member",
        userEmail: "tim@example.com",
        orgId: "coach-org",
      },
      () =>
        describeCredentialScopeGap(["ACADEMY_CONVEX_SITE_URL"], {
          userEmail: "tim@example.com",
          orgId: "coach-org",
        }),
    );

    expect(message).toBeNull();
    expect(execCalls.some((call) => call.sql.includes(CROSS_ORG_PROBE))).toBe(
      false,
    );
  });

  it("declines diagnostics when an org-member context does not match the credential scope", async () => {
    const message = await runWithRequestContext(
      {
        a2aIdentityAssurance: "org-member",
        userEmail: "tim@example.com",
        orgId: "coach-org",
      },
      () =>
        describeCredentialScopeGap(["SLACK_BOT_TOKEN"], {
          userEmail: "tim@example.com",
          orgId: "other-org",
        }),
    );

    expect(message).toBeNull();
    expect(execCalls).toHaveLength(0);
  });
});
