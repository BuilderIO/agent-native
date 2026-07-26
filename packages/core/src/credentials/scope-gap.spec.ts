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

    const message = await describeCredentialScopeGap(["SLACK_BOT_TOKEN"], {
      userEmail: "owner@example.com",
    });

    expect(message).toBeNull();
    expect(execCalls).toHaveLength(0);
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
