import { getDbExec } from "@agent-native/core/db";

const RETENTION_MS = 90 * 24 * 60 * 60 * 1_000;
const BATCH_SIZE = 1_000;
const MAX_BATCHES = 100;
const WORK_MS = 20_000;

/** Daily logical expiry, not backup erasure. Outages/backlog can extend row age. */
export async function pruneBigQueryUsage() {
  const started = Date.now();
  const cutoff = new Date(started - RETENTION_MS).toISOString();
  const db = getDbExec();
  let deleted = 0;
  let batches = 0;
  try {
    while (batches < MAX_BATCHES && Date.now() - started < WORK_MS) {
      const result = await db.execute({
        timeoutMs: 1_500,
        maxAttempts: 1,
        sql: `WITH expired AS (
          SELECT project_id, job_id FROM analytics_bigquery_usage
          WHERE started_at < $1
          ORDER BY started_at, project_id, job_id
          LIMIT $2 FOR UPDATE SKIP LOCKED
        ) DELETE FROM analytics_bigquery_usage AS usage USING expired
          WHERE usage.project_id = expired.project_id AND usage.job_id = expired.job_id
          RETURNING usage.job_id`,
        args: [cutoff, BATCH_SIZE],
      });
      batches++;
      deleted += result.rows.length;
      if (result.rows.length < BATCH_SIZE) break;
    }
    // Bound this read too: an unavailable count is a failed sweep, never zero.
    const remaining = await db.execute({
      timeoutMs: 1_500,
      maxAttempts: 1,
      sql: "SELECT COUNT(*)::text AS remaining FROM analytics_bigquery_usage WHERE started_at < $1",
      args: [cutoff],
    });
    const count = remaining.rows[0]?.remaining;
    if (typeof count !== "string" || !/^\d+$/.test(count))
      throw new Error("Could not read expired usage backlog");
    const summary = { cutoff, deleted, batches, expiredRemaining: count };
    if (count !== "0")
      console.warn(
        "[bigquery-usage-retention] Expired backlog remains",
        summary,
      );
    else console.info("[bigquery-usage-retention] Sweep complete", summary);
    return summary;
  } catch (error) {
    console.error("[bigquery-usage-retention] Sweep failed", {
      cutoff,
      deleted,
      batches,
    });
    throw error;
  }
}
