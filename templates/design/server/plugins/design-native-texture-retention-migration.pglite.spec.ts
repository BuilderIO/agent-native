import {
  closeDbExec,
  getDbExec,
  runMigrations,
  withMigrationRuntime,
} from "@agent-native/core/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { designNativeTextureSharedRetentionMigration } from "./db.js";

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "pglite:memory://");
  vi.stubEnv("DATABASE_URL_UNPOOLED", "pglite:memory://");
  vi.stubEnv("DESIGN_DATABASE_URL", "pglite:memory://");
  vi.stubEnv("DESIGN_DATABASE_URL_UNPOOLED", "pglite:memory://");
  const exec = getDbExec();
  await exec.execute("CREATE TABLE designs (id TEXT PRIMARY KEY)");
  await exec.execute(`CREATE TABLE design_files (
    id TEXT PRIMARY KEY,
    design_id TEXT NOT NULL REFERENCES designs(id) ON DELETE CASCADE
  )`);
  await exec.execute(`CREATE TABLE design_native_texture_assets (
    id TEXT PRIMARY KEY,
    design_id TEXT NOT NULL REFERENCES designs(id) ON DELETE CASCADE,
    file_id TEXT NOT NULL REFERENCES design_files(id) ON DELETE CASCADE,
    idempotency_key TEXT NOT NULL,
    uploader_email TEXT NOT NULL,
    owner_email TEXT NOT NULL,
    org_id TEXT,
    visibility TEXT NOT NULL DEFAULT 'private',
    provider_url TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    byte_length INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (design_id, file_id, idempotency_key)
  )`);
  // The failed boot may have committed the first statement before reaching the function.
  await exec.execute(`CREATE TABLE design_native_texture_objects (
    id TEXT PRIMARY KEY,
    provider_url TEXT NOT NULL,
    uploader_email TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    byte_length INTEGER NOT NULL CHECK (byte_length BETWEEN 1 AND 1000000),
    sha256 TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  await exec.execute("INSERT INTO designs(id) VALUES ('kept'), ('deleted')");
  await exec.execute(
    "INSERT INTO design_files(id,design_id) VALUES ('kept-file','kept'), ('deleted-file','deleted')",
  );
});

afterAll(async () => {
  await closeDbExec();
  vi.unstubAllEnvs();
});

describe("native texture retention v41 through app migration runner", () => {
  it("applies, retries, and retains object bytes without an orphan binding on Design deletion", async () => {
    const migrate = runMigrations(
      [designNativeTextureSharedRetentionMigration],
      { table: "native_texture_retention_test_migrations" },
    );
    await withMigrationRuntime(async () => migrate({}));
    await withMigrationRuntime(async () => migrate({}));
    const exec = getDbExec();
    const versions = await exec.execute(
      "SELECT version FROM native_texture_retention_test_migrations",
    );
    expect(versions.rows).toEqual([{ version: 41 }]);
    const names = await exec.execute(
      "SELECT name FROM native_texture_retention_test_migrations_named",
    );
    expect(names.rows).toEqual([
      { name: "design-native-texture-shared-retention" },
    ]);
    for (const [id, designId, fileId] of [
      ["kept-asset", "kept", "kept-file"],
      ["deleted-asset", "deleted", "deleted-file"],
    ]) {
      await exec.execute({
        sql: `INSERT INTO design_native_texture_assets
          (id,design_id,file_id,idempotency_key,uploader_email,owner_email,provider_url,mime_type,byte_length,sha256)
          VALUES (?,?,?,?,?,?,?,?,?,?)`,
        args: [
          id,
          designId,
          fileId,
          id,
          "owner@example.test",
          "owner@example.test",
          `https://owned.example.test/${id}.png`,
          "image/png",
          10,
          "a".repeat(64),
        ],
      });
    }
    await exec.execute(
      "DELETE FROM design_native_texture_assets WHERE id='kept-asset'",
    );
    await exec.execute("DELETE FROM designs WHERE id='deleted'");
    const objects = await exec.execute(
      "SELECT id FROM design_native_texture_objects ORDER BY id",
    );
    expect(objects.rows).toEqual([
      { id: "deleted-asset" },
      { id: "kept-asset" },
    ]);
    const bindings = await exec.execute(
      "SELECT asset_id,design_id FROM design_native_texture_bindings ORDER BY asset_id",
    );
    expect(bindings.rows).toEqual([
      { asset_id: "kept-asset", design_id: "kept" },
    ]);
  });
});
