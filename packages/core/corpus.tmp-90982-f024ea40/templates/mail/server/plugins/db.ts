import {
  ensureAdditiveColumns,
  getDbExec,
  runMigrations,
  intType,
} from "@agent-native/core/db";

import * as schema from "../db/schema.js";

/**
 * Every Drizzle table exported from schema.ts. Filters out type-only and
 * helper exports the same way db.spec.ts's `isDrizzleTable` regression guard
 * does: a real table carries a Symbol-keyed drizzle metadata bag, plain
 * exports don't.
 */
function isDrizzleTable(value: unknown): value is object {
  return (
    !!value &&
    typeof value === "object" &&
    Object.getOwnPropertySymbols(value).some((s) =>
      s.toString().includes("drizzle"),
    )
  );
}

const schemaTables = Object.values(schema).filter(isDrizzleTable);

// Convention: every new migration below MUST set a unique `name:` slug (see
// packages/core/src/db/migrations.ts for the full rationale). Version numbers
// alone are not a safe identity across parallel branches that each extend
// this list independently.
const runMailMigrations = runMigrations(
  [
    {
      version: 1,
      sql: `CREATE TABLE IF NOT EXISTS scheduled_jobs (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK(type IN ('snooze', 'send_later')),
    email_id TEXT,
    payload TEXT NOT NULL,
    run_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'done', 'cancelled')),
    created_at INTEGER NOT NULL
  )`,
    },
    {
      version: 2,
      sql: `ALTER TABLE scheduled_jobs ADD COLUMN IF NOT EXISTS account_email TEXT`,
    },
    {
      version: 3,
      sql: `ALTER TABLE scheduled_jobs ADD COLUMN IF NOT EXISTS owner_email TEXT`,
    },
    {
      version: 4,
      sql: `ALTER TABLE scheduled_jobs ADD COLUMN IF NOT EXISTS thread_id TEXT`,
    },
    {
      version: 5,
      sql: `CREATE TABLE IF NOT EXISTS automation_rules (
    id TEXT PRIMARY KEY,
    owner_email TEXT NOT NULL,
    domain TEXT NOT NULL,
    name TEXT NOT NULL,
    condition TEXT NOT NULL,
    actions TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
    },
    {
      version: 6,
      sql: `CREATE TABLE IF NOT EXISTS contact_frequency (
    id TEXT PRIMARY KEY,
    owner_email TEXT NOT NULL,
    contact_email TEXT NOT NULL,
    contact_name TEXT NOT NULL DEFAULT '',
    send_count ${intType()} NOT NULL DEFAULT 0,
    receive_count ${intType()} NOT NULL DEFAULT 0,
    last_contacted_at ${intType()} NOT NULL
  )`,
    },
    {
      version: 7,
      sql: `CREATE TABLE IF NOT EXISTS email_tracking (
    pixel_token TEXT PRIMARY KEY,
    message_id TEXT NOT NULL,
    owner_email TEXT NOT NULL,
    sent_at ${intType()} NOT NULL,
    opens_count ${intType()} NOT NULL DEFAULT 0,
    first_opened_at ${intType()},
    last_opened_at ${intType()},
    last_user_agent TEXT
  )`,
    },
    {
      version: 8,
      sql: `CREATE INDEX IF NOT EXISTS idx_email_tracking_message_id ON email_tracking(message_id)`,
    },
    {
      version: 9,
      sql: `CREATE TABLE IF NOT EXISTS email_link_tracking (
    click_token TEXT PRIMARY KEY,
    pixel_token TEXT NOT NULL,
    url TEXT NOT NULL,
    clicks_count ${intType()} NOT NULL DEFAULT 0,
    first_clicked_at ${intType()},
    last_clicked_at ${intType()}
  )`,
    },
    {
      version: 10,
      sql: `CREATE INDEX IF NOT EXISTS idx_email_link_tracking_pixel_token ON email_link_tracking(pixel_token)`,
    },
    {
      version: 11,
      sql: `CREATE TABLE IF NOT EXISTS queued_email_drafts (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    owner_email TEXT NOT NULL,
    requester_email TEXT NOT NULL,
    requester_name TEXT,
    to_recipients TEXT NOT NULL,
    cc_recipients TEXT,
    bcc_recipients TEXT,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    context TEXT,
    source TEXT NOT NULL DEFAULT 'agent',
    source_thread_id TEXT,
    account_email TEXT,
    compose_id TEXT,
    sent_message_id TEXT,
    status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued', 'in_review', 'sent', 'dismissed')),
    created_at ${intType()} NOT NULL,
    updated_at ${intType()} NOT NULL,
    sent_at ${intType()}
  )`,
    },
    {
      version: 12,
      sql: `CREATE INDEX IF NOT EXISTS idx_queued_email_drafts_owner_status ON queued_email_drafts(org_id, owner_email, status, created_at)`,
    },
    {
      version: 13,
      sql: `CREATE INDEX IF NOT EXISTS idx_queued_email_drafts_requester ON queued_email_drafts(org_id, requester_email, created_at)`,
    },
    {
      // Cover the hot list/read paths that previously had no supporting index:
      // - scheduled_jobs is filtered by status on the inbox snooze-filter path
      //   (listPendingJobs) and the due-job cron (status + run_at).
      // - contact_frequency is filtered by owner_email on the contacts
      //   autocomplete path (getContactFrequencyMap).
      // - automation_rules is filtered by owner_email on the automations list
      //   and the per-account automation engine load.
      version: 14,
      sql: `CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_status_run_at ON scheduled_jobs(status, run_at);
CREATE INDEX IF NOT EXISTS idx_contact_frequency_owner ON contact_frequency(owner_email);
CREATE INDEX IF NOT EXISTS idx_automation_rules_owner ON automation_rules(owner_email)`,
    },
    {
      version: 15,
      name: "snippets-table",
      sql: `CREATE TABLE IF NOT EXISTS snippets (
    id TEXT PRIMARY KEY,
    owner_email TEXT NOT NULL,
    name TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at ${intType()} NOT NULL,
    updated_at ${intType()} NOT NULL
  );
CREATE INDEX IF NOT EXISTS idx_snippets_owner_name ON snippets(owner_email, name)`,
    },
    {
      // listPendingJobs (jobs.ts) scopes its WHERE clause to
      // (status, owner_email) on every inbox/unread list load. The v14 index
      // only covers (status, run_at), which doesn't serve the owner-scoped
      // lookup, so add the composite index so that read stays indexed as the
      // scheduled_jobs table grows across all users.
      version: 16,
      name: "scheduled-jobs-owner-status-run-at-idx",
      sql: `CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_owner_status_run_at ON scheduled_jobs(owner_email, status, run_at)`,
    },
    {
      version: 17,
      name: "queued-draft-send-claim",
      sql: `ALTER TABLE queued_email_drafts ADD COLUMN IF NOT EXISTS send_claim_id TEXT;
ALTER TABLE queued_email_drafts ADD COLUMN IF NOT EXISTS send_claimed_at ${intType()}`,
    },
  ],
  { table: "mail_migrations" },
);

/**
 * The migration list above is the authoritative source for tables, indexes,
 * and data transforms. `ensureAdditiveColumns` runs after it as a
 * belt-and-braces safety net for the failure mode where a column is added to
 * schema.ts without a matching hand-written ALTER migration, which silently
 * 500s every query touching a pre-existing production table. It only ever
 * adds missing columns — never drops, renames, or retypes anything — and any
 * failure here is logged and swallowed so it can never fail boot.
 */
export default async (nitroApp: any): Promise<void> => {
  await runMailMigrations(nitroApp);
  try {
    const summary = await ensureAdditiveColumns({
      db: getDbExec(),
      tables: schemaTables,
    });
    if (summary.errors.length > 0) {
      console.warn(
        "[db] ensureAdditiveColumns completed with errors:",
        summary.errors,
      );
    }
  } catch (err) {
    // Never fail boot over the safety net itself — the authoritative
    // migrations above already ran.
    console.warn(
      "[db] ensureAdditiveColumns failed (non-fatal):",
      err instanceof Error ? err.message : err,
    );
  }
};
