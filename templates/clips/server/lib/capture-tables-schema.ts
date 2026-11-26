export const captureTablesMigration = `
CREATE TABLE IF NOT EXISTS clips_capture_hosts (
  id TEXT PRIMARY KEY, owner_email TEXT NOT NULL, secret_hash TEXT NOT NULL,
  kind TEXT NOT NULL, label TEXT NOT NULL, surface TEXT NOT NULL, state TEXT NOT NULL,
  active_session_id TEXT, expires_at TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS clips_capture_hosts_owner_idx ON clips_capture_hosts (owner_email, expires_at);
CREATE TABLE IF NOT EXISTS clips_capture_sessions (
  id TEXT PRIMARY KEY, owner_email TEXT NOT NULL, host_id TEXT NOT NULL, request_id TEXT NOT NULL,
  capture_mode TEXT NOT NULL, max_duration_ms INTEGER NOT NULL, state TEXT NOT NULL,
  recording_id TEXT, started_at_ms DOUBLE PRECISION, start_uncertainty_ms DOUBLE PRECISION, observed_frame_rate DOUBLE PRECISION,
  error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS clips_capture_request_idx ON clips_capture_sessions (owner_email, request_id);
`;

export const captureSessionPendingOutcomeMigration = `ALTER TABLE clips_capture_sessions ADD COLUMN IF NOT EXISTS pending_outcome TEXT`;

export const captureMarkersMigration = `
CREATE TABLE IF NOT EXISTS clips_capture_markers (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, label TEXT NOT NULL, kind TEXT NOT NULL,
  requested_at TEXT NOT NULL, media_time_ms DOUBLE PRECISION, uncertainty_ms DOUBLE PRECISION
);
CREATE INDEX IF NOT EXISTS clips_capture_markers_session_idx ON clips_capture_markers (session_id, requested_at);
`;
