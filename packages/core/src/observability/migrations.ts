import type { MigrationEntry } from "../db/migrations.js";

export const OBSERVABILITY_MIGRATIONS_TABLE = "_observability_migrations";

export const OBSERVABILITY_MIGRATIONS: MigrationEntry[] = [
  {
    version: 1,
    name: "observability-org-scope-legacy-traces",
    sql: `
      UPDATE agent_trace_summaries AS summary
        SET org_id = thread.org_id
        FROM chat_threads AS thread
        WHERE summary.org_id IS NULL
          AND summary.thread_id = thread.id
          AND summary.user_id IS NOT NULL
          AND LOWER(summary.user_id) = LOWER(thread.owner_email)
          AND thread.org_id IS NOT NULL;

      UPDATE agent_trace_spans AS span
        SET org_id = summary.org_id
        FROM agent_trace_summaries AS summary
        WHERE span.org_id IS NULL
          AND span.run_id = summary.run_id
          AND span.thread_id = summary.thread_id
          AND span.user_id IS NOT NULL
          AND LOWER(span.user_id) = LOWER(summary.user_id)
          AND summary.org_id IS NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_trace_spans_org_type_name_run_id
        ON agent_trace_spans (org_id, span_type, name, run_id);
      CREATE INDEX IF NOT EXISTS idx_trace_spans_org_run_type_status_created
        ON agent_trace_spans (org_id, run_id, span_type, status, created_at);
    `,
  },
];
