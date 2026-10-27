import type { DbExec } from "../db/client.js";

const CANDIDATES = `
  WITH thread_sources AS (
    SELECT thread_id,
      lower(btrim(owner)) AS owner_email,
      count(DISTINCT NULLIF(btrim(app_id), '')) AS app_count,
      bool_or(NULLIF(btrim(app_id), '') IS NULL) AS has_unattributed_run,
      min(NULLIF(btrim(app_id), '')) AS app_id
    FROM automation_run_history
    WHERE thread_id IS NOT NULL
    GROUP BY thread_id, lower(btrim(owner))
  ), candidates AS (
    SELECT t.id, sources.owner_email, sources.app_id
    FROM chat_threads t
    JOIN thread_sources sources ON sources.thread_id = t.id
    WHERE t.source_app_id IS NULL
      AND lower(t.owner_email) = sources.owner_email
      AND sources.app_count = 1
      AND NOT sources.has_unattributed_run
  )`;

export interface AutomationChatSourceBackfillCounts {
  untaggedAutomationThreads: number;
  eligibleThreads: number;
  ambiguousThreads: number;
  unattributedThreads: number;
  updatedThreads: number;
}

export async function backfillAutomationChatSources(
  db: DbExec,
  options: { apply?: boolean } = {},
): Promise<AutomationChatSourceBackfillCounts> {
  if (!db.transaction)
    throw new Error("Automation chat source backfill requires transactions.");

  return db.transaction(async (tx) => {
    await tx.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    if (!options.apply) await tx.execute("SET TRANSACTION READ ONLY");
    await tx.execute("SET LOCAL statement_timeout = '30s'");
    if (options.apply) await tx.execute("SET LOCAL lock_timeout = '2s'");

    const result = await tx.execute(`${CANDIDATES}
      SELECT
        (SELECT count(DISTINCT t.id)::int FROM chat_threads t
          JOIN thread_sources sources ON sources.thread_id = t.id
          WHERE t.source_app_id IS NULL
            AND lower(t.owner_email) = sources.owner_email) AS untagged_automation_threads,
        (SELECT count(*)::int FROM candidates) AS eligible_threads,
        (SELECT count(*)::int FROM chat_threads t
          WHERE t.source_app_id IS NULL AND EXISTS (
            SELECT 1 FROM thread_sources sources
            WHERE sources.thread_id = t.id
              AND sources.owner_email = lower(t.owner_email)
              AND (sources.app_count > 1 OR (
                sources.app_count = 1 AND sources.has_unattributed_run
              ))
          )) AS ambiguous_threads,
        (SELECT count(*)::int FROM chat_threads t
          WHERE t.source_app_id IS NULL AND EXISTS (
            SELECT 1 FROM thread_sources sources
            WHERE sources.thread_id = t.id
              AND sources.owner_email = lower(t.owner_email)
              AND sources.app_count = 0
          )) AS unattributed_threads`);
    const counts = result.rows[0] as
      | {
          untagged_automation_threads: number;
          eligible_threads: number;
          ambiguous_threads: number;
          unattributed_threads: number;
        }
      | undefined;
    if (!counts) throw new Error("Automation chat source counts are missing.");

    let updatedThreads = 0;
    if (options.apply) {
      const updated = await tx.execute(`${CANDIDATES}
        UPDATE chat_threads t
        SET source_app_id = candidates.app_id
        FROM candidates
        WHERE t.id = candidates.id
          AND lower(t.owner_email) = candidates.owner_email
          AND t.source_app_id IS NULL
        RETURNING t.id`);
      updatedThreads = updated.rows.length;
      if (updatedThreads !== Number(counts.eligible_threads)) {
        throw new Error(
          "Automation chat sources changed during backfill; transaction rolled back.",
        );
      }
    }

    return {
      untaggedAutomationThreads: Number(counts.untagged_automation_threads),
      eligibleThreads: Number(counts.eligible_threads),
      ambiguousThreads: Number(counts.ambiguous_threads),
      unattributedThreads: Number(counts.unattributed_threads),
      updatedThreads,
    };
  });
}
