import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import {
  OAUTH_TOKEN_MIGRATIONS,
  OAUTH_TOKEN_MIGRATIONS_TABLE,
} from "./migrations.js";

describe("OAuth token migrations", () => {
  it("adds the current token columns and backfills existing owners", () => {
    const db = new Database(":memory:");

    for (const migration of OAUTH_TOKEN_MIGRATIONS) {
      if (typeof migration.sql !== "string") {
        throw new Error(`Expected ${migration.name} to use shared SQL`);
      }
      const sql = migration.sql;
      db.exec(sql.replace(/ADD COLUMN IF NOT EXISTS/gi, "ADD COLUMN").trim());
      if (migration.name === "oauth-tokens-display-name-column") {
        db.prepare(
          "INSERT INTO oauth_tokens (provider, account_id, tokens, updated_at) VALUES (?, ?, ?, ?)",
        ).run("google", "person@example.com", "{}", 1);
      }
    }

    const columns = db
      .prepare("PRAGMA table_info(oauth_tokens)")
      .all() as Array<{
      name: string;
    }>;
    expect(columns.map((column) => column.name)).toEqual([
      "provider",
      "account_id",
      "tokens",
      "updated_at",
      "owner",
      "display_name",
    ]);
    expect(
      db
        .prepare(
          "SELECT owner FROM oauth_tokens WHERE provider = ? AND account_id = ?",
        )
        .get("google", "person@example.com"),
    ).toEqual({ owner: "person@example.com" });
    expect(OAUTH_TOKEN_MIGRATIONS_TABLE).toBe("_oauth_token_migrations");

    db.close();
  });
});
