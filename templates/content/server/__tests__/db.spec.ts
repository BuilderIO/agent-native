import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("content database migrations", () => {
  it("keeps document_sync_links migrations aligned with queried columns", () => {
    const source = readFileSync(
      join(__dirname, "..", "plugins", "db.ts"),
      "utf8",
    );

    expect(source).toContain("sync_comments INTEGER NOT NULL DEFAULT 0");
    expect(source).toContain(
      "ALTER TABLE document_sync_links ADD COLUMN IF NOT EXISTS sync_comments INTEGER NOT NULL DEFAULT 0",
    );
  });

  it("keeps document source metadata migrations aligned with queried columns", () => {
    const source = readFileSync(
      join(__dirname, "..", "plugins", "db.ts"),
      "utf8",
    );

    expect(source).toContain('table: "content_source_migrations"');
    for (const column of [
      "source_mode",
      "source_kind",
      "source_path",
      "source_root_path",
      "source_updated_at",
    ]) {
      expect(source).toContain(`${column} TEXT`);
      expect(source).toContain(
        `ALTER TABLE documents ADD COLUMN IF NOT EXISTS ${column} TEXT`,
      );
    }
  });

  it("creates source-aware database foundation tables additively", () => {
    const source = readFileSync(
      join(__dirname, "..", "plugins", "db.ts"),
      "utf8",
    );

    expect(source).toContain(
      "CREATE TABLE IF NOT EXISTS content_database_sources",
    );
    expect(source).toContain(
      "CREATE TABLE IF NOT EXISTS content_database_source_fields",
    );
    expect(source).toContain(
      "CREATE TABLE IF NOT EXISTS content_database_source_rows",
    );
    expect(source).toContain(
      "CREATE TABLE IF NOT EXISTS content_database_source_change_sets",
    );
    expect(source).toContain("direction TEXT NOT NULL DEFAULT 'incoming'");
    expect(source).toContain("push_mode TEXT");
    expect(source).toContain("local_only INTEGER NOT NULL DEFAULT 1");
  });

  it("adds inline database ownership columns additively", () => {
    const source = readFileSync(
      join(__dirname, "..", "plugins", "db.ts"),
      "utf8",
    );

    expect(source).toContain("owner_document_id TEXT");
    expect(source).toContain("owner_block_id TEXT");
    expect(source).toContain(
      "ALTER TABLE content_databases ADD COLUMN IF NOT EXISTS owner_document_id TEXT",
    );
    expect(source).toContain(
      "ALTER TABLE content_databases ADD COLUMN IF NOT EXISTS owner_block_id TEXT",
    );
  });

  it("adds content database soft-delete marker additively", () => {
    const source = readFileSync(
      join(__dirname, "..", "plugins", "db.ts"),
      "utf8",
    );

    expect(source).toContain("deleted_at TEXT");
    expect(source).toContain(
      "ALTER TABLE content_databases ADD COLUMN IF NOT EXISTS deleted_at TEXT",
    );
  });

  it("cleans source review and execution rows when database pages are deleted", () => {
    const source = readFileSync(
      join(__dirname, "..", "..", "actions", "_database-utils.ts"),
      "utf8",
    );

    const executionDelete = source.indexOf(
      "delete(schema.contentDatabaseSourceExecutions)",
    );
    const reviewDelete = source.indexOf(
      "delete(schema.contentDatabaseSourceChangeReviews)",
    );
    const changeSetDelete = source.indexOf(
      "delete(schema.contentDatabaseSourceChangeSets)",
    );

    expect(executionDelete).toBeGreaterThan(-1);
    expect(reviewDelete).toBeGreaterThan(-1);
    expect(changeSetDelete).toBeGreaterThan(-1);
    expect(executionDelete).toBeLessThan(changeSetDelete);
    expect(reviewDelete).toBeLessThan(changeSetDelete);
  });
});
