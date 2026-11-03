import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { getTableName, type Table } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { PGlite } = createRequire(
  new URL("../../../../packages/core/package.json", import.meta.url),
)("@electric-sql/pglite");

import * as mediaCleanupTables from "../db/media-cleanup-tables.js";
import * as schema from "../db/schema";
import { recordingMediaCleanupMigration } from "../lib/recording-media-cleanup-schema.js";
import { getRecordingAccessTokenResourceId } from "../lib/share-password.js";

const dbTsSource = readFileSync(new URL("./db.ts", import.meta.url), "utf8");
const failureBackfillSource = readFileSync(
  new URL("../jobs/recording-failure-backfill.ts", import.meta.url),
  "utf8",
);

interface DrizzleColumn {
  name: string;
}

interface DrizzleTable {
  [column: string]: unknown;
}

function isDrizzleTable(value: unknown): value is DrizzleTable {
  return (
    !!value &&
    typeof value === "object" &&
    Object.getOwnPropertySymbols(value).some((s) =>
      s.toString().includes("drizzle"),
    )
  );
}

function columnsOf(table: DrizzleTable): DrizzleColumn[] {
  return Object.values(table).filter(
    (v): v is DrizzleColumn =>
      !!v && typeof v === "object" && typeof (v as any).name === "string",
  );
}

let migrationDb: Awaited<ReturnType<typeof PGlite.create>> | undefined;
let migrationRoot: string | undefined;
const migratedColumns = new Map<string, Set<string>>();

describe("recording media cleanup migration", () => {
  for (const [exportName, exported] of Object.entries(mediaCleanupTables)) {
    const columns = columnsOf(exported as unknown as DrizzleTable);

    it(`creates schema.${exportName} columns and can apply its DDL repeatedly`, async () => {
      const { splitSqlStatements } = await vi.importActual<{
        splitSqlStatements: (sql: string) => string[];
      }>("../../../../packages/core/src/db/migrations.js");
      const database = await PGlite.create("memory://");
      try {
        await database.exec(`CREATE TABLE recordings(id TEXT PRIMARY KEY,video_url TEXT,thumbnail_url TEXT,animated_thumbnail_url TEXT,filmstrip_url TEXT,image_url TEXT,base_image_url TEXT,edits_json TEXT DEFAULT '{}');
          CREATE TABLE recording_agent_frames(recording_id TEXT,storage_url TEXT);
          CREATE TABLE recording_browser_diagnostics(recording_id TEXT,app_activity_blob_json TEXT);`);
        for (let pass = 0; pass < 2; pass++)
          for (const statement of splitSqlStatements(
            recordingMediaCleanupMigration,
          ))
            await database.exec(statement);
        const result = await database.query(
          "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1",
          [getTableName(exported as unknown as Table)],
        );
        const actual = new Set(
          result.rows.map((row: { column_name: string }) => row.column_name),
        );
        expect(
          columns
            .map((column) => column.name)
            .filter((name) => !actual.has(name)),
        ).toEqual([]);
      } finally {
        await database.close();
      }
    });
  }
});

beforeAll(async () => {
  const scratch = fileURLToPath(new URL("../../../../.tmp/", import.meta.url));
  await mkdir(scratch, { recursive: true });
  migrationRoot = await mkdtemp(join(scratch, "clips-schema-test-"));
  const databasePath = join(migrationRoot, "db");
  await promisify(execFile)(
    process.execPath,
    ["--import", "tsx", "scripts/migrate-production.ts"],
    {
      cwd: fileURLToPath(new URL("../../", import.meta.url)),
      env: {
        ...process.env,
        DATABASE_URL: `pglite:${databasePath}`,
        NODE_ENV: "test",
      },
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  migrationDb = await PGlite.create(databasePath);
  const rows = await migrationDb.query(
    "SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public'",
  );
  for (const row of rows.rows as Array<{
    table_name: string;
    column_name: string;
  }>) {
    const columns = migratedColumns.get(row.table_name) ?? new Set<string>();
    columns.add(row.column_name);
    migratedColumns.set(row.table_name, columns);
  }
}, 60_000);
afterAll(async () => {
  await migrationDb?.close();
  if (migrationRoot) await rm(migrationRoot, { recursive: true, force: true });
});

describe("fresh Clips migrations create every declared schema column", () => {
  for (const [exportName, exported] of Object.entries(schema)) {
    if (!isDrizzleTable(exported)) continue;
    const columns = columnsOf(exported as DrizzleTable);
    if (!columns.length) continue;

    it(`every column on schema.${exportName} exists after production migrations`, () => {
      const tableName = getTableName(exported as unknown as Table);
      const actual = migratedColumns.get(tableName);
      expect(actual).toBeDefined();
      expect(
        columns
          .map((column) => column.name)
          .filter((column) => !actual?.has(column)),
      ).toEqual([]);
    });
  }
});

describe("clips db.ts migration entries follow the naming convention", () => {
  const entryRe = /version:\s*(\d+),\s*(?:name:\s*"([^"]+)",\s*)?/g;

  function extractEntries(source: string): Array<{
    version: number;
    name: string | null;
  }> {
    const entries: Array<{ version: number; name: string | null }> = [];
    for (const match of source.matchAll(entryRe)) {
      entries.push({
        version: Number(match[1]),
        name: match[2] ?? null,
      });
    }
    return entries;
  }

  const entries = extractEntries(dbTsSource);

  it("finds migration entries to check (sanity guard against a regex drift)", () => {
    expect(entries.length).toBeGreaterThan(35);
  });

  it("every declared migration name is unique", () => {
    const names = entries.map((e) => e.name).filter((n): n is string => !!n);
    const duplicates = names.filter((name, idx) => names.indexOf(name) !== idx);
    expect(duplicates).toEqual([]);
  });

  it("every migration entry with version > 44 has a name", () => {
    const missingNames = entries
      .filter((e) => e.version > 44)
      .filter((e) => !e.name)
      .map((e) => e.version);
    expect(missingNames).toEqual([]);
  });
});

describe("recording viewer identity migration", () => {
  it("is named, additive, and safe to apply repeatedly", () => {
    expect(dbTsSource).toMatch(
      /version:\s*48,\s*name:\s*"recording-viewers-canonical-viewer-key"/,
    );
    expect(dbTsSource).toMatch(
      /ALTER TABLE recording_viewers ADD COLUMN IF NOT EXISTS viewer_key TEXT/,
    );
    expect(dbTsSource).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS recording_viewers_recording_viewer_key_unique_idx ON recording_viewers \(recording_id, viewer_key\)/,
    );
  });
});

describe("recording share password version migration", () => {
  it("rotates the legacy scope when an older writer changes a password", async () => {
    const migrationSql = dbTsSource.match(
      /version:\s*77,\s*name:\s*"recording-share-password-version"[\s\S]*?sql:\s*`([\s\S]*?)`/,
    )?.[1];
    expect(migrationSql).toBeTruthy();
    expect(migrationSql?.trim()).toMatch(/^DO 'BEGIN[\s\S]*END';?$/);

    const db = await PGlite.create("memory://");
    try {
      await db.exec(`
        CREATE TABLE public.recordings (
          id TEXT PRIMARY KEY,
          password TEXT,
          updated_at TEXT NOT NULL
        );
        INSERT INTO public.recordings (id, password, updated_at)
        VALUES ('rec-1', NULL, '2026-01-01T00:00:00.000Z');
        ${migrationSql}
      `);

      const before = await db.query(
        "SELECT share_password_version FROM public.recordings WHERE id = 'rec-1'",
      );
      expect(before.rows[0]?.share_password_version).toBe(
        "legacy:2026-01-01T00:00:00.000Z",
      );
      expect(
        getRecordingAccessTokenResourceId(
          "rec-1",
          null,
          String(before.rows[0]?.share_password_version),
        ),
      ).toBe("rec-1");

      await db.query(
        "INSERT INTO public.recordings (id, password, updated_at) VALUES ('rec-2', NULL, '2026-01-01T00:00:00.000Z')",
      );
      const newRecording = await db.query(
        "SELECT share_password_version FROM public.recordings WHERE id = 'rec-2'",
      );
      expect(newRecording.rows[0]?.share_password_version).toBe("initial");

      await db.query(
        "UPDATE public.recordings SET password = 'old-writer-password', updated_at = '2026-01-02T00:00:00.000Z' WHERE id = 'rec-1'",
      );
      await db.query(
        "UPDATE public.recordings SET password = NULL, updated_at = '2026-01-03T00:00:00.000Z' WHERE id = 'rec-1'",
      );

      const after = await db.query(
        "SELECT share_password_version FROM public.recordings WHERE id = 'rec-1'",
      );
      expect(String(after.rows[0]?.share_password_version)).not.toMatch(
        /^legacy:/,
      );
      expect(
        getRecordingAccessTokenResourceId(
          "rec-1",
          null,
          String(after.rows[0]?.share_password_version),
        ),
      ).not.toBe("rec-1");
    } finally {
      await db.close();
    }
  });
});

describe("organization recording visibility default migration", () => {
  it("promotes untouched legacy private defaults without overwriting explicit choices", () => {
    expect(dbTsSource).toContain('name: "clips-public-organization-default"');
    expect(dbTsSource).toContain(
      "UPDATE workspaces SET default_visibility = 'public' WHERE default_visibility = 'private' AND updated_at = created_at",
    );
    expect(dbTsSource).toContain(
      "UPDATE organization_settings SET default_visibility = 'public' WHERE default_visibility = 'private' AND updated_at = created_at",
    );
  });
});

describe("recording failure code migration", () => {
  it("maps legacy reasons in bounded recurring batches after adding columns", () => {
    expect(failureBackfillSource).toContain(
      "failure_code = ${LEGACY_FAILURE_CODE_CASE}",
    );
    expect(failureBackfillSource).toContain(
      "WHEN failure_reason IN ('Recording cancelled by user', 'Recording cancelled during countdown', 'Upload cancelled') THEN 'user_cancelled'",
    );
    expect(failureBackfillSource).toContain(
      "WHEN failure_reason = 'Upload stopped sending data before the recording finished saving.' THEN 'upload_timed_out'",
    );
    expect(failureBackfillSource).toContain(
      "WHEN failure_reason LIKE 'Video storage could not start an upload: S3 CreateMultipartUpload failed%' THEN 'multipart_start_failed'",
    );
    expect(failureBackfillSource).toContain(
      "WHEN failure_reason LIKE 'Video storage is not connected yet%' THEN 'storage_setup_required'",
    );
    expect(failureBackfillSource).toContain(
      "WHEN failure_reason ILIKE 'Chunk % upload failed%<!DOCTYPE html>%' THEN 'chunk_html_error'",
    );
    expect(failureBackfillSource).toContain(
      "WHEN failure_reason ILIKE 'Couldn''t prepare the recording for re-upload (reset-chunks %). <!DOCTYPE html>%' THEN 'chunk_html_error'",
    );
    expect(failureBackfillSource).toContain("ELSE 'unknown'");
    const backfillUpdate = failureBackfillSource.slice(
      failureBackfillSource.indexOf("sql: `UPDATE recordings SET"),
    );
    const outerUpdatePredicate = backfillUpdate.slice(
      backfillUpdate.indexOf("ORDER BY id LIMIT $2"),
      backfillUpdate.indexOf("RETURNING id"),
    );
    expect(outerUpdatePredicate).toContain("AND status = 'failed'");
    expect(outerUpdatePredicate).toContain(
      "AND ${NEEDS_FAILURE_CODE_BACKFILL}",
    );
    expect(failureBackfillSource).toContain(
      "const NEEDS_FAILURE_CODE_BACKFILL =",
    );
    expect(failureBackfillSource).toContain("failure_code IS NULL");
    expect(failureBackfillSource).toContain("failure_code = 'unknown'");
    expect(failureBackfillSource).toContain(
      "failure_code IS DISTINCT FROM (${LEGACY_FAILURE_CODE_CASE})",
    );
    expect(failureBackfillSource).toContain("ORDER BY id LIMIT $2");
    expect(failureBackfillSource).toContain("BATCH_SIZE = 250");
    expect(failureBackfillSource).toContain("SWEEP_INTERVAL_MS = 60_000");
    expect(failureBackfillSource).toContain(
      "export async function runRecordingFailureBackfillOnce",
    );
    expect(dbTsSource).not.toContain("scheduleRecordingFailureBackfill");
    const migrationStart = dbTsSource.indexOf(
      'name: "recording-failure-codes-platform"',
    );
    const migrationEnd = dbTsSource.indexOf("version:", migrationStart + 10);
    const failureMigration = dbTsSource.slice(migrationStart, migrationEnd);
    expect(failureMigration).toContain(
      "ADD COLUMN IF NOT EXISTS failure_code TEXT",
    );
    expect(failureMigration).toContain(
      "ADD COLUMN IF NOT EXISTS recording_platform TEXT",
    );
    expect(failureMigration).not.toMatch(/UPDATE recordings/i);
    expect(dbTsSource).toMatch(
      /version: 75,[\s\S]*?name: "recording-failure-backfill-cursor"[\s\S]*?ADD COLUMN IF NOT EXISTS cursor_id TEXT/,
    );
    expect(dbTsSource).toMatch(
      /version: 76,[\s\S]*?name: "recording-failure-backfill-completion"[\s\S]*?ADD COLUMN IF NOT EXISTS completed_at TEXT/,
    );
    expect(failureBackfillSource).not.toContain("'Upload aborted by user'");
  });
});

describe("clips db.ts wires ensureAdditiveColumns after migrations", () => {
  it("calls ensureAdditiveColumns after runMigrations(...) completes", () => {
    const migrationsCallIdx = dbTsSource.indexOf("runMigrations(");
    const ensureCallIdx = dbTsSource.indexOf("ensureAdditiveColumns({");
    expect(migrationsCallIdx).toBeGreaterThan(-1);
    expect(ensureCallIdx).toBeGreaterThan(-1);
    expect(ensureCallIdx).toBeGreaterThan(migrationsCallIdx);

    expect(dbTsSource).toMatch(
      /await\s+migrations\([^)]*\)[\s\S]*?ensureAdditiveColumns\(\{/,
    );
  });

  it("does not remove the v41 hot-path index fix", () => {
    expect(dbTsSource).toMatch(
      /name:\s*"recordings-comments-shares-hot-path-indexes"/,
    );
  });
});
