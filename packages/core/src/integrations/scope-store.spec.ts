import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let sqlite: Database.Database;

const db = {
  execute: vi.fn(async (input: string | { sql: string; args?: unknown[] }) => {
    if (typeof input === "string") {
      sqlite.exec(input);
      return { rows: [], rowsAffected: 0 };
    }
    const statement = sqlite.prepare(input.sql);
    const args = input.args ?? [];
    if (statement.reader) {
      return { rows: statement.all(...args), rowsAffected: 0 };
    }
    const result = statement.run(...args);
    return { rows: [], rowsAffected: result.changes };
  }),
};

vi.mock("../db/client.js", () => ({
  getDbExec: () => db,
  intType: () => "INTEGER",
  isPostgres: () => false,
}));

const {
  _resetIntegrationScopeStoreForTests,
  deleteIntegrationScope,
  evaluateIntegrationScopePolicy,
  getIntegrationScope,
  listIntegrationScopes,
  saveIntegrationScope,
} = await import("./scope-store.js");

const key = {
  platform: "slack",
  tenantId: "team-example",
  conversationId: "channel-example",
};

beforeEach(() => {
  sqlite = new Database(":memory:");
  db.execute.mockClear();
  _resetIntegrationScopeStoreForTests();
});

afterEach(() => {
  sqlite.close();
});

describe("integration scope authorization", () => {
  it("types nullable org guards for Postgres parameter inference", async () => {
    await listIntegrationScopes({
      ownerEmail: "personal@example.com",
      orgId: null,
    });

    expect(db.execute).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining("CAST(? AS TEXT) IS NOT NULL"),
      }),
    );
  });

  it("does not reveal, update, or delete another org's scope", async () => {
    const orgA = { ownerEmail: "owner-a@example.com", orgId: "org-a" };
    const orgB = { ownerEmail: "owner-b@example.com", orgId: "org-b" };

    const created = await saveIntegrationScope(
      {
        ...key,
        conversationType: "channel",
        trust: "trusted",
        installationId: "install-example",
      },
      orgA,
    );
    expect(created.orgId).toBe("org-a");

    await expect(getIntegrationScope(key, orgB)).resolves.toBeNull();
    await expect(listIntegrationScopes(orgB)).resolves.toEqual([]);
    await expect(deleteIntegrationScope(key, orgB)).resolves.toBe(false);
    await expect(
      saveIntegrationScope(
        { ...key, conversationType: "channel", trust: "trusted" },
        orgB,
      ),
    ).rejects.toThrow("not available");

    const unchanged = await getIntegrationScope(key, orgA);
    expect(unchanged).toMatchObject({
      orgId: "org-a",
      ownerEmail: "owner-a@example.com",
      installationId: "install-example",
    });
  });

  it("keeps personal scopes owner-only even when another caller has an org", async () => {
    const owner = { ownerEmail: "personal@example.com", orgId: null };
    await saveIntegrationScope(
      { ...key, conversationType: "channel", trust: "trusted", orgId: null },
      owner,
    );

    await expect(
      getIntegrationScope(key, {
        ownerEmail: "different@example.com",
        orgId: "org-example",
      }),
    ).resolves.toBeNull();
    await expect(
      saveIntegrationScope(
        {
          ...key,
          conversationType: "channel",
          trust: "trusted",
          orgId: "other-org",
        },
        { ownerEmail: "personal@example.com", orgId: "org-example" },
      ),
    ).rejects.toThrow("Not authorized");
  });

  it("derives org service principals instead of accepting caller identities", async () => {
    const access = { ownerEmail: "owner@example.com", orgId: "org-example" };
    const first = await saveIntegrationScope(
      {
        ...key,
        conversationType: "channel",
        serviceOwnerEmail: "victim@example.com",
      } as Parameters<typeof saveIntegrationScope>[0],
      access,
    );
    const second = await saveIntegrationScope(
      {
        ...key,
        conversationType: "channel",
      },
      access,
    );

    expect(first.serviceOwnerEmail).toMatch(
      /^integration\+[a-f0-9]{24}@service\.agent-native\.local$/,
    );
    expect(first.serviceOwnerEmail).not.toBe("victim@example.com");
    expect(second.serviceOwnerEmail).toBe(first.serviceOwnerEmail);
  });

  it("keeps personal scopes bound to their verified owner", async () => {
    const scope = await saveIntegrationScope(
      {
        ...key,
        conversationType: "direct_message",
        orgId: null,
      },
      { ownerEmail: "personal@example.com", orgId: null },
    );

    expect(scope.serviceOwnerEmail).toBe("personal@example.com");
  });
});

describe("integration scope policy", () => {
  it("defaults to mention-required and fails closed for DMs and untrusted conversations", async () => {
    const access = { ownerEmail: "owner@example.com", orgId: "org-example" };
    const scope = await saveIntegrationScope(
      { ...key, conversationType: "channel" },
      access,
    );

    expect(scope.policy).toEqual({
      requireMention: true,
      allowDirectMessages: false,
      allowGuests: false,
      allowExternalShared: false,
      allowUnknownTrust: false,
    });
    expect(evaluateIntegrationScopePolicy(scope, { mentioned: false })).toEqual(
      { allowed: false, reason: "mention_required" },
    );
    expect(evaluateIntegrationScopePolicy(scope, { mentioned: true })).toEqual({
      allowed: false,
      reason: "unverified_conversation_disabled",
    });

    const dm = await saveIntegrationScope(
      {
        ...key,
        conversationType: "direct_message",
        trust: "trusted",
      },
      access,
    );
    expect(evaluateIntegrationScopePolicy(dm, { mentioned: true })).toEqual({
      allowed: false,
      reason: "direct_messages_disabled",
    });
  });

  it("only opens explicitly enabled policy paths", async () => {
    const scope = await saveIntegrationScope(
      {
        ...key,
        conversationType: "channel",
        trust: "external_shared",
        policy: { allowExternalShared: true },
      },
      { ownerEmail: "owner@example.com", orgId: "org-example" },
    );
    expect(evaluateIntegrationScopePolicy(scope, { mentioned: true })).toEqual({
      allowed: true,
    });
  });
});
