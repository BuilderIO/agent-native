import { randomUUID } from "node:crypto";

import { getDbExec } from "@agent-native/core/db";

const SWEEP_INTERVAL_MS = 60_000;
const BATCH_SIZE = 250;
const LEASE_MS = 30_000;
const LEASE_KEY = "recording-failure-codes";
const holder = randomUUID();
let running = false;

export async function runRecordingFailureBackfillOnce(): Promise<void> {
  const exec = getDbExec();
  const now = Date.now();
  await exec.execute({
    sql: `INSERT INTO clips_backfill_leases (lease_key, holder, expires_at, cursor_id)
      VALUES ($1, $2, $3, NULL)
      ON CONFLICT (lease_key) DO UPDATE SET
        holder = excluded.holder,
        expires_at = excluded.expires_at
      WHERE clips_backfill_leases.expires_at <= $4`,
    args: [LEASE_KEY, holder, now + LEASE_MS, now],
  });
  const lease = await exec.execute({
    sql: `SELECT cursor_id FROM clips_backfill_leases
      WHERE lease_key = $1 AND holder = $2 AND expires_at > $3`,
    args: [LEASE_KEY, holder, now],
  });
  if (!lease.rows.length) return;

  try {
    const cursorId =
      typeof lease.rows[0]?.cursor_id === "string"
        ? lease.rows[0].cursor_id
        : null;
    // guard:allow-unscoped — leased, bounded historical failure-code backfill.
    const result = await exec.execute({
      sql: `UPDATE recordings SET
        failure_code = CASE
          WHEN failure_reason IN ('Recording cancelled by user', 'Recording cancelled during countdown', 'Upload cancelled') THEN 'user_cancelled'
          WHEN failure_reason = 'Upload stopped sending data before the recording finished saving.' THEN 'upload_timed_out'
          WHEN failure_reason LIKE 'Video storage could not start an upload: S3 CreateMultipartUpload failed%' THEN 'multipart_start_failed'
          WHEN failure_reason LIKE 'Video storage is not connected yet%' THEN 'storage_setup_required'
          WHEN failure_reason ILIKE 'Chunk % upload failed%<!DOCTYPE html>%' THEN 'chunk_html_error'
          ELSE 'unknown'
        END,
        recording_platform = COALESCE(recording_platform, 'unknown')
        WHERE id IN (
          SELECT id FROM recordings
          WHERE ($1::TEXT IS NULL OR id > $1::TEXT)
            AND status = 'failed'
            AND (failure_code IS NULL OR failure_code = 'unknown')
          ORDER BY id LIMIT $2
        ) RETURNING id`,
      args: [cursorId, BATCH_SIZE],
    });
    const nextCursor = result.rows.reduce<string | null>((last, row) => {
      const id = typeof row.id === "string" ? row.id : null;
      return id && (!last || id > last) ? id : last;
    }, cursorId);
    if (nextCursor && result.rowsAffected) {
      await exec.execute({
        sql: `UPDATE clips_backfill_leases SET cursor_id = $1
          WHERE lease_key = $2 AND holder = $3`,
        args: [nextCursor, LEASE_KEY, holder],
      });
    }
  } finally {
    await exec
      .execute({
        sql: `UPDATE clips_backfill_leases SET expires_at = $1
          WHERE lease_key = $2 AND holder = $3`,
        args: [Date.now(), LEASE_KEY, holder],
      })
      .catch(() => undefined);
  }
}

export default function registerRecordingFailureBackfillJob(): void {
  const isProd = process.env.NODE_ENV === "production";
  const flag = process.env.RUN_BACKGROUND_JOBS;
  const enabled = flag === "1" || (isProd && flag !== "0");
  if (!enabled) return;

  setInterval(() => {
    if (running) return;
    running = true;
    runRecordingFailureBackfillOnce()
      .catch((err) =>
        console.error("[recording-failure-backfill] interval failed:", err),
      )
      .finally(() => {
        running = false;
      });
  }, SWEEP_INTERVAL_MS);
}
