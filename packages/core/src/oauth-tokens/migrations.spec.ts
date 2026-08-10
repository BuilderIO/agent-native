import { describe, expect, it } from "vitest";

import {
  OAUTH_TOKEN_MIGRATIONS,
  OAUTH_TOKEN_MIGRATIONS_TABLE,
} from "./migrations.js";

describe("OAuth token release migrations", () => {
  it("creates fresh custody before applying additive upgrades", () => {
    expect(OAUTH_TOKEN_MIGRATIONS_TABLE).toBe("_oauth_token_migrations");
    expect(OAUTH_TOKEN_MIGRATIONS.map((migration) => migration.name)).toEqual([
      "oauth-tokens-table",
      "oauth-tokens-owner-column",
      "oauth-tokens-display-name-column",
      "oauth-tokens-owner-backfill",
      "oauth-tokens-revision-column",
      "oauth-tokens-revision-backfill",
    ]);
    expect(OAUTH_TOKEN_MIGRATIONS[0]?.sql).toContain(
      "CREATE TABLE IF NOT EXISTS oauth_tokens",
    );
    expect(OAUTH_TOKEN_MIGRATIONS[1]?.sql).toContain(
      "ADD COLUMN IF NOT EXISTS owner",
    );
    expect(OAUTH_TOKEN_MIGRATIONS[2]?.sql).toContain(
      "ADD COLUMN IF NOT EXISTS display_name",
    );
    expect(OAUTH_TOKEN_MIGRATIONS[4]?.sql).toContain(
      "ADD COLUMN IF NOT EXISTS revision BIGINT",
    );
    expect(OAUTH_TOKEN_MIGRATIONS[5]?.sql).toContain(
      "SET revision = updated_at WHERE revision IS NULL",
    );
  });
});
