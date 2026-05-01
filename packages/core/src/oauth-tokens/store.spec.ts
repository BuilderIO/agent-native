import { beforeEach, describe, expect, it, vi } from "vitest";

interface ExecCall {
  sql: string;
  args: unknown[];
}

const execCalls: ExecCall[] = [];
let existingOwner: string | null = null;

const mockDb = {
  execute: vi.fn(async (input: string | { sql: string; args?: unknown[] }) => {
    const sql = typeof input === "string" ? input : input.sql;
    const args = typeof input === "string" ? [] : (input.args ?? []);
    execCalls.push({ sql, args });

    if (/SELECT owner, display_name FROM oauth_tokens/i.test(sql)) {
      return {
        rows: existingOwner
          ? [{ owner: existingOwner, display_name: null }]
          : [],
        rowsAffected: 0,
      };
    }

    return { rows: [], rowsAffected: 0 };
  }),
};

vi.mock("../db/client.js", () => ({
  getDbExec: () => mockDb,
  intType: () => "INTEGER",
  isPostgres: () => false,
}));

const { saveOAuthTokens } = await import("./store.js");

function lastInsert(): ExecCall {
  const inserts = execCalls.filter((c) => /^\s*INSERT\b/i.test(c.sql));
  if (inserts.length === 0) throw new Error("no INSERT was executed");
  return inserts[inserts.length - 1];
}

describe("oauth token store", () => {
  beforeEach(() => {
    execCalls.length = 0;
    existingOwner = null;
    vi.clearAllMocks();
  });

  it("repairs legacy local ownership when the Google account reconnects", async () => {
    existingOwner = "local@localhost";

    await saveOAuthTokens(
      "google",
      "steve@builder.io",
      { access_token: "new-token" },
      "steve@builder.io",
    );

    expect(lastInsert().args[2]).toBe("steve@builder.io");
  });

  it("still refuses to rebind a Google account owned by a real user", async () => {
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
});
