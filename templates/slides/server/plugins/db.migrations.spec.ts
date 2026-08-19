import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// guard:allow-unscoped — this isolated SQLite fixture verifies migration rows directly.

const originalDatabaseUrl = process.env.DATABASE_URL;
let tempDir: string | null = null;

describe("Slides share migrations", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "slides-migrations-"));
    process.env.DATABASE_URL = `file:${path.join(tempDir, "slides.db")}`;
    vi.resetModules();
  });

  afterEach(async () => {
    const { closeDbExec } = await import("@agent-native/core/db");
    await closeDbExec();
    vi.resetModules();

    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;

    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it("reconciles legacy duplicate user shares before creating the unique index", async () => {
    const [{ getDbExec }, { runSlidesMigrations }] = await Promise.all([
      import("@agent-native/core/db"),
      import("./db"),
    ]);
    const exec = getDbExec();

    await exec.execute(`
      CREATE TABLE deck_shares (
        id TEXT PRIMARY KEY,
        resource_id TEXT NOT NULL,
        principal_type TEXT NOT NULL,
        principal_id TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'viewer',
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    await exec.execute(
      "CREATE TABLE slides_migrations (version INTEGER PRIMARY KEY)",
    );
    await exec.execute(
      "CREATE TABLE slides_migrations_named (name TEXT PRIMARY KEY, version INTEGER, applied_at TEXT NOT NULL DEFAULT (datetime('now')))",
    );
    for (let version = 1; version <= 23; version++) {
      await exec.execute({
        sql: "INSERT INTO slides_migrations (version) VALUES (?)",
        args: [version],
      });
    }
    for (const [name, version] of [
      ["slides-uploaded-assets-table", 20],
      ["slides-share-design-system-snapshot", 21],
      ["slides-deck-access-requests", 22],
      ["slides-deck-access-request-rate-limits", 23],
    ] as const) {
      await exec.execute({
        sql: "INSERT INTO slides_migrations_named (name, version) VALUES (?, ?)",
        args: [name, version],
      });
    }

    const legacyRows = [
      ["share-viewer", "deck-1", "User@Example.com", "viewer", "2026-01-01"],
      ["share-editor", "deck-1", "user@example.com", "editor", "2026-01-02"],
      ["share-admin", "deck-1", "USER@EXAMPLE.COM", "admin", "2026-01-03"],
      [
        "share-other-deck",
        "deck-2",
        "USER@example.com",
        "viewer",
        "2026-01-04",
      ],
      ["share-group-a", "deck-1", "User@Example.com", "viewer", "2026-01-05"],
    ] as const;
    for (const [id, resourceId, principalId, role, createdAt] of legacyRows) {
      await exec.execute({
        sql: `INSERT INTO deck_shares
          (id, resource_id, principal_type, principal_id, role, created_by, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [
          id,
          resourceId,
          id.startsWith("share-group") ? "group" : "user",
          principalId,
          role,
          "owner@example.com",
          createdAt,
        ],
      });
    }

    await runSlidesMigrations({});

    const { rows } = await exec.execute(
      `SELECT id, resource_id, principal_type, principal_id, role
       FROM deck_shares
       ORDER BY id`,
    );
    expect(rows).toEqual([
      {
        id: "share-admin",
        resource_id: "deck-1",
        principal_type: "user",
        principal_id: "user@example.com",
        role: "admin",
      },
      {
        id: "share-group-a",
        resource_id: "deck-1",
        principal_type: "group",
        principal_id: "User@Example.com",
        role: "viewer",
      },
      {
        id: "share-other-deck",
        resource_id: "deck-2",
        principal_type: "user",
        principal_id: "user@example.com",
        role: "viewer",
      },
    ]);

    const { rows: indexRows } = await exec.execute(
      `SELECT name
       FROM sqlite_master
       WHERE type = 'index' AND name = 'deck_shares_resource_user_principal_uidx'`,
    );
    expect(indexRows).toEqual([
      { name: "deck_shares_resource_user_principal_uidx" },
    ]);

    await expect(
      exec.execute({
        sql: `INSERT INTO deck_shares
          (id, resource_id, principal_type, principal_id, role, created_by)
          VALUES (?, ?, ?, ?, ?, ?)`,
        args: [
          "share-duplicate",
          "deck-1",
          "user",
          "uSeR@example.com",
          "viewer",
          "owner@example.com",
        ],
      }),
    ).rejects.toThrow(/unique/i);
  }, 20_000);
});
