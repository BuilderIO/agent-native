import { beforeEach, describe, expect, it, vi } from "vitest";

// Deterministic key so the at-rest encryption round-trips within the test.
// Must be set before importing ./store.js (which pulls in secrets/crypto).
process.env.SECRETS_ENCRYPTION_KEY ||= "oauth-store-test-key";

const { decryptSecretValue, isEncryptedSecretValue } =
  await import("../secrets/crypto.js");

interface ExecCall {
  sql: string;
  args: unknown[];
}

const execCalls: ExecCall[] = [];
let existingOwner: string | null = null;
let existingTokens: Record<string, unknown> | null = null;
let mockPostgres = false;

const mockDb = {
  execute: vi.fn(async (input: string | { sql: string; args?: unknown[] }) => {
    const sql = typeof input === "string" ? input : input.sql;
    const args = typeof input === "string" ? [] : (input.args ?? []);
    execCalls.push({ sql, args });

    if (
      /SELECT owner, display_name, tokens FROM (?:public\.)?oauth_tokens/i.test(
        sql,
      )
    ) {
      return {
        rows: existingOwner
          ? [
              {
                owner: existingOwner,
                display_name: null,
                tokens: JSON.stringify(existingTokens ?? {}),
              },
            ]
          : [],
        rowsAffected: 0,
      };
    }

    return { rows: [], rowsAffected: 0 };
  }),
};

vi.mock("../db/client.js", () => ({
  getDbExec: () => mockDb,
  intType: () => (mockPostgres ? "BIGINT" : "INTEGER"),
  isPostgres: () => mockPostgres,
}));

const { deleteOAuthTokens, getOAuthTokens, saveOAuthTokens } =
  await import("./store.js");

function lastInsert(): ExecCall {
  const inserts = execCalls.filter((c) => /^\s*INSERT\b/i.test(c.sql));
  if (inserts.length === 0) throw new Error("no INSERT was executed");
  return inserts[inserts.length - 1];
}

describe("oauth token store", () => {
  beforeEach(() => {
    execCalls.length = 0;
    existingOwner = null;
    existingTokens = null;
    mockPostgres = false;
    vi.clearAllMocks();
  });

  it("refuses to rebind a Google account owned by a different user", async () => {
    existingOwner = "other@example.com";

    await expect(
      saveOAuthTokens(
        "google",
        "steve@builder.io",
        { access_token: "new-token" },
        "steve@builder.io",
      ),
    ).rejects.toMatchObject({
      name: "OAuthAccountOwnedByOtherUserError",
      existingOwner: "other@example.com",
      attemptedOwner: "steve@builder.io",
    });
  });

  it("supports owner-scoped reads and deletes for tenant-bound OAuth credentials", async () => {
    await getOAuthTokens("mcp", "mcp_oauth:test", "org:org-test");
    await deleteOAuthTokens("mcp", "mcp_oauth:test", "org:org-test");

    const scopedRead = execCalls.find((call) =>
      /SELECT tokens FROM (?:public\.)?oauth_tokens/i.test(call.sql),
    );
    expect(scopedRead?.sql).toContain("AND owner = ?");
    expect(scopedRead?.args).toEqual(["mcp", "mcp_oauth:test", "org:org-test"]);

    const scopedDelete = execCalls.find((call) =>
      /DELETE FROM (?:public\.)?oauth_tokens/i.test(call.sql),
    );
    expect(scopedDelete?.sql).toContain("AND owner = ?");
    expect(scopedDelete?.args).toEqual([
      "mcp",
      "mcp_oauth:test",
      "org:org-test",
    ]);
  });

  it("qualifies the real oauth_tokens table on Postgres so temp scoped views cannot shadow OAuth callbacks", async () => {
    mockPostgres = true;

    await saveOAuthTokens(
      "google",
      "steve@builder.io",
      { access_token: "new-token" },
      "steve@builder.io",
    );

    expect(
      execCalls.some((c) =>
        /SELECT owner, display_name, tokens FROM public\.oauth_tokens/i.test(
          c.sql,
        ),
      ),
    ).toBe(true);
    expect(lastInsert().sql).toContain("INSERT INTO public.oauth_tokens");
  });

  it("preserves an existing refresh token when an update only provides a new access token", async () => {
    existingOwner = "steve@builder.io";
    existingTokens = {
      access_token: "old-access",
      refresh_token: "keep-refresh",
      expiry_date: 100,
    };

    await saveOAuthTokens(
      "google",
      "steve@builder.io",
      { access_token: "new-access", expiry_date: 200 },
      "steve@builder.io",
    );

    const storedColumn = lastInsert().args[4] as string;
    // Tokens are encrypted at rest, not stored as plaintext JSON.
    expect(isEncryptedSecretValue(storedColumn)).toBe(true);
    const stored = JSON.parse(decryptSecretValue(storedColumn));
    expect(stored).toMatchObject({
      access_token: "new-access",
      refresh_token: "keep-refresh",
      expiry_date: 200,
    });
  });

  it("encrypts the token bundle at rest (no plaintext refresh token in the column)", async () => {
    existingOwner = null;

    await saveOAuthTokens(
      "google",
      "steve@builder.io",
      { access_token: "a-token", refresh_token: "super-secret-refresh" },
      "steve@builder.io",
    );

    const storedColumn = lastInsert().args[4] as string;
    expect(isEncryptedSecretValue(storedColumn)).toBe(true);
    expect(storedColumn).not.toContain("super-secret-refresh");
    expect(JSON.parse(decryptSecretValue(storedColumn))).toMatchObject({
      access_token: "a-token",
      refresh_token: "super-secret-refresh",
    });
  });
});
