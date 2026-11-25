import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

// source-read-ok: these pin the hand-written migration SQL itself (additive
// ALTERs, tables and indexes an existing production database must get), which
// is the contract; no schema read or fresh-database test sees a missing ALTER.
const source = readFileSync(join(__dirname, "..", "plugins", "db.ts"), "utf8");

// oracle-change: removed the _database-utils.ts delete-order source check; it pinned deleteDatabaseDataForDocument, which no production code calls (page deletion cleans sources in delete-document.ts, whose receipt cleanup content-database-lifecycle.db.test.ts covers), and the tables have no foreign keys, so the order is not observable
describe("content database migrations", () => {
  it("keeps document_sync_links migrations aligned with queried columns", () => {
    expect(source).toContain("sync_comments INTEGER NOT NULL DEFAULT 0");
    expect(source).toContain(
      "ALTER TABLE document_sync_links ADD COLUMN IF NOT EXISTS sync_comments INTEGER NOT NULL DEFAULT 0",
    );
  });

  it("keeps document source metadata migrations aligned with queried columns", () => {
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
    expect(source).toContain("deleted_at TEXT");
    expect(source).toContain(
      "ALTER TABLE content_databases ADD COLUMN IF NOT EXISTS deleted_at TEXT",
    );
  });

  it("adds the document trash lifecycle additively", () => {
    expect(source).toContain(
      "ALTER TABLE documents ADD COLUMN IF NOT EXISTS trashed_at TEXT",
    );
    expect(source).toContain(
      "ALTER TABLE documents ADD COLUMN IF NOT EXISTS trash_root_id TEXT",
    );
    expect(source).toContain(
      "documents_trash_idx ON documents (owner_email, trashed_at, trash_root_id)",
    );
  });

  it("creates bounded database migration receipts additively", () => {
    expect(source).toContain(
      "CREATE TABLE IF NOT EXISTS content_database_migration_receipts",
    );
    expect(source).toContain(
      "content_database_migration_receipts_database_key_unique",
    );
    expect(source).toContain('name: "content-database-migration-receipts"');
  });

  it("creates Builder MDX sidecar cache table additively", () => {
    expect(source).toContain("CREATE TABLE IF NOT EXISTS builder_doc_sidecars");
    for (const column of [
      "document_id TEXT NOT NULL",
      "path TEXT NOT NULL",
      "content TEXT NOT NULL",
      "content_hash TEXT NOT NULL",
    ]) {
      expect(source).toContain(column);
    }
    expect(source).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS builder_doc_sidecars_doc_path_idx",
    );
  });

  it("adds Builder body hydration state additively", () => {
    expect(source).toContain(
      "ALTER TABLE content_database_items ADD COLUMN IF NOT EXISTS body_hydration_status TEXT NOT NULL DEFAULT 'hydrated'",
    );
    expect(source).toContain(
      "CREATE TABLE IF NOT EXISTS content_database_body_hydration_queue",
    );
    expect(source).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS content_database_body_hydration_queue_item_idx",
    );
  });
});
