export const DIAGNOSTIC_CONTEXT_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS recording_diagnostic_contexts (
 id TEXT PRIMARY KEY, recording_id TEXT NOT NULL, capture_id TEXT NOT NULL, context_version INTEGER NOT NULL,
 digest TEXT NOT NULL, recording_started_at TEXT NOT NULL, requested_from TEXT NOT NULL, requested_to TEXT NOT NULL,
 coverage_json TEXT NOT NULL, gaps_json TEXT NOT NULL, pauses_json TEXT NOT NULL, dropped_events INTEGER NOT NULL,
 captured TEXT NOT NULL, failure_code TEXT, blob_json TEXT NOT NULL, expires_at TEXT NOT NULL, removed_at TEXT,
 created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP), owner_email TEXT NOT NULL, org_id TEXT, visibility TEXT NOT NULL DEFAULT 'private'
);
CREATE UNIQUE INDEX IF NOT EXISTS recording_diagnostic_capture_unique_idx ON recording_diagnostic_contexts(owner_email,capture_id,context_version);
CREATE INDEX IF NOT EXISTS recording_diagnostic_recording_idx ON recording_diagnostic_contexts(recording_id,owner_email);
CREATE INDEX IF NOT EXISTS recording_diagnostic_expiry_idx ON recording_diagnostic_contexts(expires_at);
CREATE TABLE IF NOT EXISTS recording_diagnostic_context_shares (
 id TEXT PRIMARY KEY, resource_id TEXT NOT NULL, principal_type TEXT NOT NULL, principal_id TEXT NOT NULL,
 role TEXT NOT NULL DEFAULT 'viewer', created_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP), notified_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS recording_diagnostic_named_share_idx ON recording_diagnostic_context_shares(resource_id,principal_type,principal_id);
CREATE TABLE IF NOT EXISTS recording_diagnostic_grants (
 id TEXT PRIMARY KEY, context_id TEXT NOT NULL, context_version INTEGER NOT NULL, label TEXT NOT NULL,
 scopes_json TEXT NOT NULL, from_ms REAL, to_ms REAL, issuer_email TEXT NOT NULL, org_id TEXT NOT NULL,
 expires_at TEXT NOT NULL, revoked_at TEXT, created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);
CREATE INDEX IF NOT EXISTS recording_diagnostic_grant_context_idx ON recording_diagnostic_grants(context_id);
CREATE INDEX IF NOT EXISTS recording_diagnostic_grant_expiry_idx ON recording_diagnostic_grants(expires_at);
CREATE TABLE IF NOT EXISTS recording_diagnostic_cleanup (
 context_id TEXT PRIMARY KEY, blob_json TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT,
 created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP), next_attempt_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);
ALTER TABLE recording_diagnostic_cleanup ADD COLUMN IF NOT EXISTS next_attempt_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP);
`;

export const DIAGNOSTIC_RAW_DB_POLICY_SQL = `
COMMENT ON TABLE recording_diagnostic_contexts IS 'agent-native:raw-db-denied';
COMMENT ON TABLE recording_diagnostic_context_shares IS 'agent-native:raw-db-denied';
COMMENT ON TABLE recording_diagnostic_grants IS 'agent-native:raw-db-denied';
COMMENT ON TABLE recording_diagnostic_cleanup IS 'agent-native:raw-db-denied';
COMMENT ON TABLE recording_browser_diagnostics IS 'agent-native:raw-db-denied';
COMMENT ON TABLE recording_bug_reports IS 'agent-native:raw-db-denied';
`;

export const DIAGNOSTIC_DESCRIPTION_POLICY_SQL = `
ALTER TABLE recordings ADD COLUMN IF NOT EXISTS description_source TEXT NOT NULL DEFAULT 'legacy';
COMMENT ON COLUMN recordings.description IS 'agent-native:raw-db-denied';
COMMENT ON COLUMN recordings.description_source IS 'agent-native:raw-db-denied';
COMMENT ON COLUMN recordings.source_app_name IS 'agent-native:raw-db-denied';
COMMENT ON COLUMN recordings.source_window_title IS 'agent-native:raw-db-denied';
`;
