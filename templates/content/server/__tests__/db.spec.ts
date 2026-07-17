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

  it("creates Builder MDX sidecar cache table additively", () => {
    const source = readFileSync(
      join(__dirname, "..", "plugins", "db.ts"),
      "utf8",
    );

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
    const source = readFileSync(
      join(__dirname, "..", "plugins", "db.ts"),
      "utf8",
    );

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

  it("creates the Content Private Vault opaque plane in one named additive migration", () => {
    const source = readFileSync(
      join(__dirname, "..", "plugins", "db.ts"),
      "utf8",
    );

    expect(source.match(/content-private-vault-opaque-plane/g)).toHaveLength(1);
    expect(source).toContain("version: 73");
    for (const table of [
      "content_encrypted_vaults",
      "content_encrypted_vault_endpoints",
      "content_encrypted_vault_key_epochs",
      "content_encrypted_vault_key_envelopes",
      "content_encrypted_vault_grants",
      "content_encrypted_vault_disclosures",
      "content_encrypted_vault_objects",
      "content_encrypted_vault_object_revisions",
      "content_encrypted_vault_sync_events",
      "content_encrypted_vault_jobs",
      "content_encrypted_vault_job_results",
      "content_encrypted_vault_access_events",
    ]) {
      expect(source).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
    const opaquePlane = source.slice(
      source.indexOf('name: "content-private-vault-opaque-plane"'),
      source.indexOf(
        "`,\n    },",
        source.indexOf("content-private-vault-opaque-plane"),
      ),
    );
    expect(opaquePlane.match(/owner_email TEXT NOT NULL,/g)).toHaveLength(12);
    expect(opaquePlane.match(/org_id TEXT NOT NULL DEFAULT '',/g)).toHaveLength(
      12,
    );
    expect(source).not.toContain(
      "content_encrypted_vaults (\n        vault_id TEXT PRIMARY KEY,\n        owner_email TEXT NOT NULL DEFAULT 'local@localhost'",
    );
    expect(source).not.toContain("content_encrypted_vault_shares");
  });

  it("binds child rows to the same physical tenant scope with composite foreign keys", () => {
    const source = readFileSync(
      join(__dirname, "..", "plugins", "db.ts"),
      "utf8",
    );

    expect(source).toContain("content_encrypted_vaults_vault_scope_unique");
    expect(
      source.match(/FOREIGN KEY \(vault_id, owner_email, org_id\)/g),
    ).toHaveLength(8);
    expect(source).toContain(
      "REFERENCES content_encrypted_vaults(vault_id, owner_email, org_id) ON DELETE CASCADE",
    );
    expect(source).toContain(
      "content_encrypted_vault_objects_object_scope_unique",
    );
    expect(source).toContain(
      "FOREIGN KEY (object_id, vault_id, owner_email, org_id)",
    );
    expect(source).toContain(
      "REFERENCES content_encrypted_vault_objects(object_id, vault_id, owner_email, org_id) ON DELETE CASCADE",
    );
    expect(source).toContain("content_encrypted_vault_jobs_job_scope_unique");
    expect(source).toContain(
      "FOREIGN KEY (job_id, vault_id, owner_email, org_id)",
    );
    expect(source).toContain(
      "REFERENCES content_encrypted_vault_jobs(job_id, vault_id, owner_email, org_id) ON DELETE CASCADE",
    );
  });

  it("keeps retained disclosure and access evidence independent of vault cascades", () => {
    const source = readFileSync(
      join(__dirname, "..", "plugins", "db.ts"),
      "utf8",
    );
    const disclosure = source.slice(
      source.indexOf(
        "CREATE TABLE IF NOT EXISTS content_encrypted_vault_disclosures",
      ),
      source.indexOf(
        "CREATE TABLE IF NOT EXISTS content_encrypted_vault_objects",
      ),
    );
    const access = source.slice(
      source.indexOf(
        "CREATE TABLE IF NOT EXISTS content_encrypted_vault_access_events",
      ),
      source.indexOf(
        "`,\n    },",
        source.indexOf("content_encrypted_vault_access_events"),
      ),
    );

    expect(disclosure).not.toContain("FOREIGN KEY");
    expect(access).not.toContain("FOREIGN KEY");
    expect(disclosure).toContain("scope_retention_idx");
    expect(access).toContain("scope_retention_idx");
  });

  it("stores only ciphertext coordinates, never protected bodies or provider handles", () => {
    const source = readFileSync(
      join(__dirname, "..", "plugins", "db.ts"),
      "utf8",
    );
    const opaquePlane = source.slice(
      source.indexOf('name: "content-private-vault-opaque-plane"'),
      source.indexOf(
        "`,\n    },",
        source.indexOf("content-private-vault-opaque-plane"),
      ),
    );

    expect(opaquePlane).not.toMatch(/\bblob_handle/);
    expect(opaquePlane).not.toMatch(/\bwrapped_key\b/);
    expect(opaquePlane).not.toMatch(/\brequest_ciphertext\b/);
    expect(opaquePlane).not.toMatch(/\bresult_ciphertext\b/);
    expect(opaquePlane).not.toMatch(/\bciphertext\s+TEXT/);
    expect(opaquePlane).toContain("ciphertext_byte_length INTEGER NOT NULL");
  });

  it("adds the immutable retention generation and terminal tombstone fence", () => {
    const source = readFileSync(
      join(__dirname, "..", "plugins", "db.ts"),
      "utf8",
    );
    const migration = source.slice(
      source.indexOf(
        'name: "content-private-vault-retention-generation-fence"',
      ),
      source.indexOf(
        "`,\n    },",
        source.indexOf(
          'name: "content-private-vault-retention-generation-fence"',
        ),
      ),
    );

    expect(source).toContain("version: 78");
    expect(migration).toContain(
      "trigger_generation TEXT NOT NULL DEFAULT 'legacy-v1'",
    );
    expect(migration).toContain("purged_at TEXT");
    expect(migration).toContain(
      "(phase, due_at, lease_expires_at, trigger_generation)",
    );
  });

  it("adds a content-free durable endpoint-request replay fence", () => {
    const source = readFileSync(
      join(__dirname, "..", "plugins", "db.ts"),
      "utf8",
    );
    const migration = source.slice(
      source.indexOf(
        'name: "content-private-vault-endpoint-request-replay-fence"',
      ),
      source.indexOf(
        "`,\n    },",
        source.indexOf(
          'name: "content-private-vault-endpoint-request-replay-fence"',
        ),
      ),
    );

    expect(source).toContain("version: 79");
    expect(migration).toContain(
      "CREATE TABLE IF NOT EXISTS content_encrypted_vault_endpoint_request_nonces",
    );
    expect(migration).toContain(
      "UNIQUE INDEX IF NOT EXISTS content_encrypted_vault_endpoint_request_nonces_unique",
    );
    expect(migration).toContain("(vault_id, endpoint_id, nonce)");
    expect(migration).toContain("(expires_at, id)");
    expect(migration).toContain(
      "REFERENCES content_encrypted_vault_endpoints(endpoint_id, vault_id, owner_email, org_id) ON DELETE CASCADE",
    );
    for (const forbidden of [
      "proof",
      "signature",
      "body_hash",
      "method",
      "path",
      "payload",
      "error",
      "provider",
    ]) {
      expect(migration).not.toMatch(new RegExp(`\\b${forbidden}\\b`));
    }
  });
});
