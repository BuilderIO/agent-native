/**
 * The canonical `plans` table DDL for specs that stand up their own PGlite
 * database instead of running the migration list.
 *
 * It lives here because it drifted three times: a column was added to
 * `schema.ts` and to the migrations, and ten spec files kept their own copy of
 * the CREATE TABLE, so every one of them started failing with
 * `column "…" does not exist`. Keep this in step with `server/db/schema.ts`
 * and the drift becomes a single edit.
 */
export const PLANS_TABLE_DDL = `CREATE TABLE plans (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, brief TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'plan',
  status TEXT NOT NULL DEFAULT 'draft', source TEXT NOT NULL DEFAULT 'manual',
  repo_path TEXT, current_focus TEXT, html TEXT, markdown TEXT, content TEXT,
  hosted_plan_id TEXT, hosted_plan_url TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, approved_at TEXT,
  usage_agent TEXT, usage_model TEXT,
  usage_input_tokens INTEGER, usage_output_tokens INTEGER,
  usage_cache_read_tokens INTEGER, usage_cache_write_tokens INTEGER,
  usage_cost_cents_x100 INTEGER, usage_cost_source TEXT, usage_recorded_at TEXT,
  source_url TEXT, source_type TEXT, source_repo TEXT, source_pr_number INTEGER,
  source_pr_state TEXT, source_pr_merged_at TEXT, source_author_email TEXT,
  source_author_name TEXT, source_author_login TEXT, recap_idempotency_key TEXT,
  edition_date_key TEXT, edition_window_start TEXT, edition_window_end TEXT,
  edition_timezone TEXT, edition_coverage_json TEXT, edition_issue_number INTEGER,
  edition_series TEXT, edition_notes TEXT,
  deleted_at TEXT, deleted_by TEXT,
  owner_email TEXT NOT NULL, org_id TEXT,
  visibility TEXT NOT NULL DEFAULT 'private'
)`;
