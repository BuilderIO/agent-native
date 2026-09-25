import { createRequire } from "node:module";

const { PGlite } = createRequire(
  new URL("../../../../packages/core/package.json", import.meta.url),
)("@electric-sql/pglite");
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

type PGliteClient = Awaited<ReturnType<typeof PGlite.create>>;
let client: PGliteClient;

vi.mock("@agent-native/core/db", () => ({
  getDbExec: () => ({
    execute: async ({ sql, args = [] }: { sql: string; args?: unknown[] }) => {
      const result = await client.query(sql, args);
      return { ...result, rowsAffected: result.affectedRows };
    },
  }),
}));

vi.mock("@agent-native/core/server", () => ({
  getAppConfig: () => ({ runtime: {} }),
  resolveDeployEnvironment: () => "test",
}));

import { runRecordingFailureBackfillOnce } from "./recording-failure-backfill.js";

beforeAll(async () => {
  client = await PGlite.create("memory://");
  await client.exec(`
    CREATE TABLE clips_backfill_leases (
      lease_key TEXT PRIMARY KEY,
      holder TEXT NOT NULL,
      expires_at BIGINT NOT NULL,
      cursor_id TEXT,
      completed_at TEXT
    );
    CREATE TABLE recordings (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      failure_reason TEXT,
      failure_code TEXT,
      recording_platform TEXT
    );
  `);
}, 60_000);

beforeEach(async () => {
  await client.exec(`TRUNCATE recordings; DELETE FROM clips_backfill_leases`);
});

afterAll(async () => {
  await client.close();
});

describe("recording failure backfill", () => {
  it("maps known legacy reasons and leaves ambiguous reasons unknown", async () => {
    const cases = [
      ["01", "Recording cancelled by user", "user_cancelled"],
      ["02", "Recording cancelled during countdown", "user_cancelled"],
      ["03", "Upload cancelled", "user_cancelled"],
      [
        "04",
        "Upload stopped sending data before the recording finished saving.",
        "upload_timed_out",
      ],
      [
        "05",
        "Video storage could not start an upload: S3 CreateMultipartUpload failed (503)",
        "multipart_start_failed",
      ],
      [
        "06",
        "Video storage is not connected yet: configure storage",
        "storage_setup_required",
      ],
      [
        "07",
        "Chunk 4 upload failed with HTTP 500: <!DOCTYPE html><html>",
        "chunk_html_error",
      ],
      ["08", "Upload aborted by user", "unknown"],
      ["09", "Some other legacy failure", "unknown"],
      [
        "10",
        "Couldn't prepare the recording for re-upload (reset-chunks 2). <!DOCTYPE html><html>",
        "chunk_html_error",
      ],
    ] as const;
    for (const [id, failureReason] of cases) {
      await client.query(
        `INSERT INTO recordings (id, status, failure_reason) VALUES ($1, 'failed', $2)`,
        [id, failureReason],
      );
    }

    await runRecordingFailureBackfillOnce();

    const { rows } = await client.query(
      `SELECT id, failure_code FROM recordings ORDER BY id`,
    );
    expect(rows).toEqual(
      cases.map(([id, , failureCode]) => ({ id, failure_code: failureCode })),
    );
    const leases = await client.query(
      `SELECT completed_at FROM clips_backfill_leases WHERE lease_key = 'recording-failure-codes'`,
    );
    expect(leases.rows[0]?.completed_at).toEqual(expect.any(String));
  });

  it("persists exhaustion and does not reacquire an exhausted backfill", async () => {
    await client.query(
      `INSERT INTO recordings (id, status, failure_reason) VALUES ('01', 'failed', 'Upload aborted by user')`,
    );
    await runRecordingFailureBackfillOnce();
    const [{ completed_at: completedAt }] = (
      await client.query(
        `SELECT completed_at FROM clips_backfill_leases WHERE lease_key = 'recording-failure-codes'`,
      )
    ).rows as Array<{ completed_at: string }>;

    await client.query(
      `INSERT INTO recordings (id, status, failure_reason) VALUES ('02', 'failed', 'Recording cancelled by user')`,
    );
    await runRecordingFailureBackfillOnce();

    const leases = await client.query(
      `SELECT completed_at FROM clips_backfill_leases WHERE lease_key = 'recording-failure-codes'`,
    );
    expect(leases.rows[0]?.completed_at).toBe(completedAt);
    const rows = await client.query(
      `SELECT id, failure_code FROM recordings ORDER BY id`,
    );
    expect(rows.rows).toEqual([
      { id: "01", failure_code: "unknown" },
      { id: "02", failure_code: null },
    ]);
  });
});
