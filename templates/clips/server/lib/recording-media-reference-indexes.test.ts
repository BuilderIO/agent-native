import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";

import { recordingMediaCleanupMigration } from "./recording-media-cleanup-schema.js";
import {
  buildRecordingMediaReferenceIndexes,
  recordingMediaReferenceIndexesReady,
} from "./recording-media-reference-indexes.js";

it("keeps reference index builds out of startup DDL and builds them concurrently at release", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE recordings(id TEXT PRIMARY KEY,video_url TEXT,thumbnail_url TEXT,animated_thumbnail_url TEXT,filmstrip_url TEXT,image_url TEXT,base_image_url TEXT,edits_json TEXT);
      CREATE TABLE recording_agent_frames(recording_id TEXT,storage_url TEXT);
      CREATE TABLE recording_browser_diagnostics(recording_id TEXT,app_activity_blob_json TEXT)`);
    await db.exec(recordingMediaCleanupMigration);
    const commands: string[] = [];
    const execute = async (statement: string) => {
      commands.push(statement);
      return db.query(statement);
    };
    expect(await recordingMediaReferenceIndexesReady(execute)).toBe(false);
    await buildRecordingMediaReferenceIndexes(execute);
    expect(await recordingMediaReferenceIndexesReady(execute)).toBe(true);
    await buildRecordingMediaReferenceIndexes(execute);
    expect(
      commands.filter((sql) => sql.startsWith("CREATE INDEX")),
    ).toHaveLength(4);
    expect(
      commands
        .filter((sql) => sql.startsWith("CREATE INDEX"))
        .every((sql) => sql.startsWith("CREATE INDEX CONCURRENTLY")),
    ).toBe(true);
  } finally {
    await db.close();
  }
});

it("does not report a failed or unreadable release index state as ready", async () => {
  await expect(
    buildRecordingMediaReferenceIndexes(async () => ({
      rows: [{ ready: false }],
    })),
  ).rejects.toThrow(/not ready/);
  await expect(
    recordingMediaReferenceIndexesReady(async () => ({ rows: [] })),
  ).rejects.toThrow(/unreadable/);
});
