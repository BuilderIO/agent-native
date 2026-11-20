import { runMigrations, type MigrationEntry } from "@agent-native/core/db";

export const formsMigrationEntries: MigrationEntry[] = [
  {
    version: 1,
    name: "forms-foundation",
    sql: `
      CREATE TABLE IF NOT EXISTS forms_workspaces (id TEXT PRIMARY KEY, org_id TEXT, created_by TEXT NOT NULL, name TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0, deleted_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS forms_workspaces_scope ON forms_workspaces (org_id, created_by, position);
      CREATE TABLE IF NOT EXISTS forms_forms (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES forms_workspaces(id) ON DELETE CASCADE, folder_id TEXT, name TEXT NOT NULL DEFAULT '', name_is_custom BOOLEAN NOT NULL DEFAULT FALSE, status TEXT NOT NULL DEFAULT 'blank', published_blocks JSONB NOT NULL DEFAULT '[]', draft_blocks JSONB, settings JSONB NOT NULL DEFAULT '{}', is_closed BOOLEAN NOT NULL DEFAULT FALSE, position INTEGER NOT NULL DEFAULT 0, published_at TEXT, revision_updated_at TEXT NOT NULL, draft_client_at BIGINT, deleted_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS forms_forms_workspace ON forms_forms (workspace_id, position);
      CREATE INDEX IF NOT EXISTS forms_forms_status ON forms_forms (status, updated_at);
      CREATE TABLE IF NOT EXISTS forms_questions (id TEXT PRIMARY KEY, form_id TEXT NOT NULL REFERENCES forms_forms(id) ON DELETE CASCADE, block_group_id TEXT NOT NULL, type TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', options JSONB NOT NULL DEFAULT '[]', is_deleted BOOLEAN NOT NULL DEFAULT FALSE, position INTEGER NOT NULL DEFAULT 0);
      CREATE UNIQUE INDEX IF NOT EXISTS forms_questions_group ON forms_questions (form_id, block_group_id);
      CREATE TABLE IF NOT EXISTS forms_submissions (id TEXT PRIMARY KEY, form_id TEXT NOT NULL REFERENCES forms_forms(id) ON DELETE CASCADE, session_id TEXT NOT NULL, respondent_id TEXT NOT NULL, is_completed BOOLEAN NOT NULL DEFAULT FALSE, submitted_at TEXT NOT NULL, deleted_at TEXT);
      CREATE UNIQUE INDEX IF NOT EXISTS forms_submissions_session ON forms_submissions (session_id);
      CREATE INDEX IF NOT EXISTS forms_submissions_form ON forms_submissions (form_id, submitted_at);
      CREATE TABLE IF NOT EXISTS forms_responses (id TEXT PRIMARY KEY, submission_id TEXT NOT NULL REFERENCES forms_submissions(id) ON DELETE CASCADE, question_id TEXT NOT NULL REFERENCES forms_questions(id) ON DELETE CASCADE, answer JSONB NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS forms_responses_answer ON forms_responses (submission_id, question_id);
      CREATE INDEX IF NOT EXISTS forms_responses_question ON forms_responses (question_id);
      CREATE TABLE IF NOT EXISTS forms_events (id TEXT PRIMARY KEY, form_id TEXT NOT NULL REFERENCES forms_forms(id) ON DELETE CASCADE, session_id TEXT NOT NULL, type TEXT NOT NULL, data JSONB, at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS forms_events_form ON forms_events (form_id, at);
      CREATE INDEX IF NOT EXISTS forms_events_session ON forms_events (session_id);
    `,
  },
  {
    version: 2,
    name: "forms-org-scope",
    sql: `
      ALTER TABLE forms_forms ADD COLUMN IF NOT EXISTS org_id TEXT;
      ALTER TABLE forms_questions ADD COLUMN IF NOT EXISTS org_id TEXT;
      ALTER TABLE forms_submissions ADD COLUMN IF NOT EXISTS org_id TEXT;
      ALTER TABLE forms_responses ADD COLUMN IF NOT EXISTS org_id TEXT;
      ALTER TABLE forms_events ADD COLUMN IF NOT EXISTS org_id TEXT;
      CREATE INDEX IF NOT EXISTS forms_forms_org ON forms_forms (org_id);
      UPDATE forms_forms SET org_id = (SELECT w.org_id FROM forms_workspaces w WHERE w.id = forms_forms.workspace_id) WHERE org_id IS NULL;
      UPDATE forms_questions SET org_id = (SELECT f.org_id FROM forms_forms f WHERE f.id = forms_questions.form_id) WHERE org_id IS NULL;
      UPDATE forms_submissions SET org_id = (SELECT f.org_id FROM forms_forms f WHERE f.id = forms_submissions.form_id) WHERE org_id IS NULL;
      UPDATE forms_responses SET org_id = (SELECT s.org_id FROM forms_submissions s WHERE s.id = forms_responses.submission_id) WHERE org_id IS NULL;
      UPDATE forms_events SET org_id = (SELECT f.org_id FROM forms_forms f WHERE f.id = forms_events.form_id) WHERE org_id IS NULL;
    `,
  },
  {
    version: 3,
    name: "forms-matrix-rows",
    sql: `
      ALTER TABLE forms_questions ADD COLUMN IF NOT EXISTS matrix_rows JSONB NOT NULL DEFAULT '[]';
    `,
  },
  {
    version: 4,
    name: "forms-collection",
    sql: `
      ALTER TABLE forms_forms ADD COLUMN IF NOT EXISTS password_hash TEXT;
      ALTER TABLE forms_submissions ADD COLUMN IF NOT EXISTS ip_hash TEXT;
      CREATE INDEX IF NOT EXISTS forms_submissions_ip ON forms_submissions (form_id, ip_hash);
    `,
  },
  {
    version: 5,
    name: "forms-organize",
    sql: `
      CREATE TABLE IF NOT EXISTS forms_folders (id TEXT PRIMARY KEY, org_id TEXT, workspace_id TEXT NOT NULL REFERENCES forms_workspaces(id) ON DELETE CASCADE, name TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0, deleted_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS forms_folders_workspace ON forms_folders (workspace_id, position);
      CREATE TABLE IF NOT EXISTS forms_form_versions (id TEXT PRIMARY KEY, org_id TEXT, form_id TEXT NOT NULL REFERENCES forms_forms(id) ON DELETE CASCADE, kind TEXT NOT NULL, blocks JSONB NOT NULL, settings JSONB NOT NULL DEFAULT '{}', author TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS forms_form_versions_form ON forms_form_versions (form_id, created_at);
    `,
  },
  {
    version: 6,
    name: "forms-domains",
    sql: `
      CREATE TABLE IF NOT EXISTS forms_domains (id TEXT PRIMARY KEY, org_id TEXT, created_by TEXT NOT NULL, host TEXT NOT NULL, verification_token TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', last_checked_at TEXT, verified_at TEXT, created_at TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS forms_domains_host ON forms_domains (host);
      CREATE INDEX IF NOT EXISTS forms_domains_org ON forms_domains (org_id);
      CREATE TABLE IF NOT EXISTS forms_domain_forms (id TEXT PRIMARY KEY, org_id TEXT, domain_id TEXT NOT NULL REFERENCES forms_domains(id) ON DELETE CASCADE, form_id TEXT NOT NULL REFERENCES forms_forms(id) ON DELETE CASCADE, slug TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS forms_domain_forms_slug ON forms_domain_forms (domain_id, slug);
      CREATE UNIQUE INDEX IF NOT EXISTS forms_domain_forms_form ON forms_domain_forms (domain_id, form_id);
    `,
  },
  {
    version: 7,
    name: "forms-email-verifications",
    sql: `
      CREATE TABLE IF NOT EXISTS forms_email_verifications (id TEXT PRIMARY KEY, form_id TEXT NOT NULL REFERENCES forms_forms(id) ON DELETE CASCADE, session_id TEXT NOT NULL, question_id TEXT NOT NULL, email TEXT NOT NULL, code_hash TEXT NOT NULL, expires_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, send_count INTEGER NOT NULL DEFAULT 1, ip_hash TEXT, verified_at TEXT, last_sent_at TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS forms_email_verifications_slot ON forms_email_verifications (form_id, session_id, question_id);
      CREATE INDEX IF NOT EXISTS forms_email_verifications_ip ON forms_email_verifications (form_id, ip_hash, created_at);
    `,
  },
  {
    version: 9,
    name: "forms-upload-log",
    sql: `
      CREATE TABLE IF NOT EXISTS forms_upload_log (id TEXT PRIMARY KEY, form_id TEXT NOT NULL REFERENCES forms_forms(id) ON DELETE CASCADE, session_id TEXT NOT NULL, at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS forms_upload_log_form ON forms_upload_log (form_id, at);
      CREATE INDEX IF NOT EXISTS forms_upload_log_session ON forms_upload_log (session_id, at);
    `,
  },
  {
    version: 10,
    name: "forms-collection-hardening",
    sql: `
      ALTER TABLE forms_submissions ADD COLUMN IF NOT EXISTS dedupe_key TEXT;
      CREATE UNIQUE INDEX IF NOT EXISTS forms_submissions_dedupe ON forms_submissions (form_id, dedupe_key) WHERE is_completed AND dedupe_key IS NOT NULL AND deleted_at IS NULL;
      CREATE TABLE IF NOT EXISTS forms_password_attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, window_start TEXT NOT NULL);
    `,
  },
  {
    version: 11,
    name: "forms-abuse-limits",
    sql: `
      ALTER TABLE forms_upload_log ADD COLUMN IF NOT EXISTS ip_hash TEXT;
      CREATE INDEX IF NOT EXISTS forms_upload_log_ip ON forms_upload_log (form_id, ip_hash, at);
      CREATE TABLE IF NOT EXISTS forms_respondent_mail_log (id TEXT PRIMARY KEY, form_id TEXT NOT NULL REFERENCES forms_forms(id) ON DELETE CASCADE, ip_hash TEXT, at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS forms_respondent_mail_log_form ON forms_respondent_mail_log (form_id, at);
      CREATE INDEX IF NOT EXISTS forms_respondent_mail_log_ip ON forms_respondent_mail_log (form_id, ip_hash, at);
    `,
  },
];

export default runMigrations(formsMigrationEntries, {
  table: "forms_migrations",
  runInServerlessRequest: true,
});
