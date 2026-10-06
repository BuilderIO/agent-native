import type { DbExec } from "../db/client.js";

const LINEAGE = `
  WITH lineage AS (
    SELECT h.id, h.owner AS source_owner, h.scope AS source_scope,
      h.org_id AS source_org_id, h.status, h.dispatch_pending,
      count(DISTINCT NULLIF(s.metadata::jsonb ->> 'automationId', '')) AS job_ids,
      count(DISTINCT s.user_id) AS actors,
      min(r.owner) AS resource_owner,
      min(r.id) AS resource_id,
      bool_and(COALESCE(
        r.owner = s.user_id AND NOT starts_with(r.owner, '__')
        AND s.org_id = h.org_id AND r.path = h.path
        AND r.created_at <= h.started_at, false
      )) AS personal_match,
      bool_and(COALESCE(
        r.owner = h.owner AND s.org_id = h.org_id
        AND r.path = h.path AND r.created_at <= h.started_at, false
      )) AS organization_match
    FROM automation_runs h
    LEFT JOIN agent_trace_spans s ON s.run_id = h.run_id
      AND s.span_type = 'agent_run'
      AND starts_with(s.name, 'background_automation_run:')
    LEFT JOIN resources r ON r.id = s.metadata::jsonb ->> 'automationId'
    WHERE starts_with(h.owner, '__organization__:')
    GROUP BY h.id, h.owner, h.scope, h.org_id, h.status, h.dispatch_pending
  ), candidates AS (
    SELECT * FROM lineage
    WHERE job_ids = 1 AND actors = 1 AND personal_match
      AND source_scope = 'organization' AND source_org_id IS NOT NULL
      AND status IN ('success', 'error', 'interrupted') AND dispatch_pending = 0
  )`;

export interface HistoryOwnershipBackfillCounts {
  organizationRows: number;
  eligibleRows: number;
  organizationJobRows: number;
  ambiguousRows: number;
  deferredRows: number;
  movedRows: number;
}

export async function backfillRunHistoryOwnership(
  db: DbExec,
  options: { apply?: boolean } = {},
): Promise<HistoryOwnershipBackfillCounts> {
  if (!db.transaction)
    throw new Error("History backfill requires transactions.");
  return db.transaction(async (tx) => {
    await tx.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    if (!options.apply) await tx.execute("SET TRANSACTION READ ONLY");
    await tx.execute("SET LOCAL statement_timeout = '30s'");
    if (options.apply) {
      // A terminal run's trace can still be amended. Freeze trace writers before
      // taking the first data snapshot, including inserts that row locks miss.
      await tx.execute("SET LOCAL lock_timeout = '2s'");
      await tx.execute("LOCK TABLE agent_trace_spans IN SHARE MODE");
      // Lock the resource identity until commit so a concurrent ownership change
      // cannot invalidate the provenance used to select the personal recipient.
      await tx.execute(`${LINEAGE}, locked_resources AS (
        SELECT r.id FROM resources r
        WHERE r.id IN (SELECT resource_id FROM candidates)
        FOR SHARE
      ) SELECT count(*) FROM locked_resources`);
    }
    const result = await tx.execute(`${LINEAGE}
      SELECT count(*)::int AS organization_rows,
        (SELECT count(*)::int FROM candidates) AS eligible_rows,
        count(*) FILTER (WHERE job_ids = 1 AND organization_match)::int AS organization_job_rows,
        count(*) FILTER (WHERE NOT (job_ids = 1 AND personal_match)
          AND NOT (job_ids = 1 AND organization_match))::int AS ambiguous_rows,
        count(*) FILTER (WHERE job_ids = 1 AND personal_match
          AND id NOT IN (SELECT id FROM candidates))::int AS deferred_rows
      FROM lineage`);
    const row = result.rows[0];
    if (!row) throw new Error("History backfill count query returned no row.");
    let movedRows = 0;
    if (options.apply) {
      const updated = await tx.execute(`${LINEAGE}
        UPDATE automation_runs h
        SET owner = c.resource_owner, scope = 'personal', org_id = NULL
        FROM candidates c
        WHERE h.id = c.id AND h.owner = c.source_owner
          AND h.scope = c.source_scope AND h.org_id = c.source_org_id
        RETURNING h.id`);
      movedRows = updated.rows.length;
      if (movedRows !== row.eligible_rows) {
        throw new Error(
          "History changed during backfill; transaction rolled back.",
        );
      }
    }
    return {
      organizationRows: row.organization_rows,
      eligibleRows: row.eligible_rows,
      organizationJobRows: row.organization_job_rows,
      ambiguousRows: row.ambiguous_rows,
      deferredRows: row.deferred_rows,
      movedRows,
    };
  });
}
