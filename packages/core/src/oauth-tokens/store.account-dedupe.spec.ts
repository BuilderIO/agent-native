import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.SECRETS_ENCRYPTION_KEY ||= "oauth-store-dedupe-test-key";

interface Row {
  provider: string;
  account_id: string;
  owner: string;
  display_name: string | null;
  tokens: string;
  updated_at: number;
  revision: number;
}

const table: Row[] = [];

function normalizedId(value: unknown): string {
  return String(value).trim().toLowerCase();
}

const mockDb = {
  execute: vi.fn(async (input: string | { sql: string; args?: unknown[] }) => {
    const sql = typeof input === "string" ? input : input.sql;
    const args = (
      typeof input === "string" ? [] : (input.args ?? [])
    ) as unknown[];

    if (/^\s*INSERT\s+INTO/i.test(sql)) {
      const [provider, accountId, owner, displayName, tokens, updatedAt, rev] =
        args as [string, string, string, string | null, string, number, number];
      const existing = table.find(
        (row) => row.provider === provider && row.account_id === accountId,
      );
      if (existing) {
        existing.tokens = tokens;
        existing.updated_at = updatedAt;
        existing.revision = Math.max(existing.revision + 1, rev);
        existing.display_name = displayName ?? existing.display_name;
        return { rows: [], rowsAffected: 1 };
      }
      table.push({
        provider,
        account_id: accountId,
        owner,
        display_name: displayName,
        tokens,
        updated_at: updatedAt,
        revision: rev,
      });
      return { rows: [], rowsAffected: 1 };
    }

    if (/SELECT owner, display_name, tokens FROM/i.test(sql)) {
      const row = table.find(
        (r) => r.provider === args[0] && r.account_id === args[1],
      );
      return { rows: row ? [row] : [], rowsAffected: 0 };
    }

    if (/SELECT account_id, owner, revision FROM/i.test(sql)) {
      return {
        rows: table.filter(
          (r) =>
            r.provider === args[0] && normalizedId(r.account_id) === args[1],
        ),
        rowsAffected: 0,
      };
    }

    if (/SELECT account_id, display_name, tokens, revision/i.test(sql)) {
      return {
        rows: table.filter(
          (r) => r.provider === args[0] && r.owner === args[1],
        ),
        rowsAffected: 0,
      };
    }

    if (/^\s*DELETE\s+FROM/i.test(sql)) {
      const ownerScoped = /owner = \?/.test(sql);
      const byNormalizedId = /LOWER\(TRIM\(account_id\)\)/i.test(sql);
      const before = table.length;
      for (let i = table.length - 1; i >= 0; i--) {
        const row = table[i];
        const idMatches = byNormalizedId
          ? normalizedId(row.account_id) === args[1]
          : row.account_id === args[1];
        if (
          row.provider === args[0] &&
          idMatches &&
          (!ownerScoped || row.owner === args[2])
        ) {
          table.splice(i, 1);
        }
      }
      return { rows: [], rowsAffected: before - table.length };
    }

    return { rows: [], rowsAffected: 0 };
  }),
};

vi.mock("../db/client.js", () => ({
  getEnclosingTransactionDbExec: () => undefined,
  getDbExec: () => mockDb,
  withDbExec: (_exec: unknown, run: () => unknown) => run(),
}));

vi.mock("../db/ddl-guard.js", () => ({
  ensureColumnExists: vi.fn().mockResolvedValue(undefined),
  ensureTableExists: vi.fn().mockResolvedValue(undefined),
}));

const { deleteOAuthTokens, listOAuthAccountsByOwner, saveOAuthTokens } =
  await import("./store.js");

const { encryptSecretValue } = await import("../secrets/crypto.js");

function seed(accountId: string, owner: string, revision: number) {
  table.push({
    provider: "google",
    account_id: accountId,
    owner,
    display_name: null,
    tokens: encryptSecretValue(
      JSON.stringify({ access_token: `at-${revision}` }),
    ),
    updated_at: revision,
    revision,
  });
}

describe("oauth account dedupe", () => {
  beforeEach(() => {
    table.length = 0;
    vi.clearAllMocks();
  });

  it("keeps one entry when the same account id is added twice", async () => {
    await saveOAuthTokens("google", "1001", { access_token: "a" }, "me@x.com");
    await saveOAuthTokens("google", "1001", { access_token: "b" }, "me@x.com");

    const accounts = await listOAuthAccountsByOwner("google", "me@x.com");
    expect(accounts).toHaveLength(1);
    expect(accounts[0].tokens.access_token).toBe("b");
  });

  it("keeps one entry when the same email is re-added with different case or spacing", async () => {
    await saveOAuthTokens(
      "google",
      "Pat@Example.com",
      { access_token: "first", refresh_token: "r1" },
      "me@x.com",
    );
    await saveOAuthTokens(
      "google",
      " pat@example.com ",
      { access_token: "second" },
      "me@x.com",
    );

    const accounts = await listOAuthAccountsByOwner("google", "me@x.com");
    expect(accounts).toHaveLength(1);
    expect(accounts[0].accountId).toBe("Pat@Example.com");
    expect(accounts[0].tokens.access_token).toBe("second");
    expect(accounts[0].tokens.refresh_token).toBe("r1");
    expect(table).toHaveLength(1);
  });

  it("does not merge the same email owned by different users", async () => {
    await saveOAuthTokens("google", "pat@example.com", { a: 1 }, "me@x.com");
    await saveOAuthTokens("google", "PAT@example.com", { a: 2 }, "you@x.com");

    expect(await listOAuthAccountsByOwner("google", "me@x.com")).toHaveLength(
      1,
    );
    expect(await listOAuthAccountsByOwner("google", "you@x.com")).toHaveLength(
      1,
    );
    expect(table).toHaveLength(2);
  });

  it("lists rows that were already duplicated once, without deleting them", async () => {
    seed("pat@example.com", "me@x.com", 10);
    seed("Pat@Example.com", "me@x.com", 20);
    seed("other@example.com", "me@x.com", 5);

    const accounts = await listOAuthAccountsByOwner("google", "me@x.com");
    expect(accounts.map((a) => a.accountId)).toEqual([
      "Pat@Example.com",
      "other@example.com",
    ]);
    expect(accounts[0].tokens.access_token).toBe("at-20");
    expect(table).toHaveLength(3);
  });

  it("removes every case variant when an account is disconnected", async () => {
    seed("pat@example.com", "me@x.com", 10);
    seed("Pat@Example.com", "me@x.com", 20);

    await deleteOAuthTokens("google", "Pat@Example.com", "me@x.com");

    expect(await listOAuthAccountsByOwner("google", "me@x.com")).toEqual([]);
    expect(table).toHaveLength(0);
  });
});
