import { runMigrations } from "@agent-native/core/db";

export default runMigrations(
  [
    {
      version: 1,
      sql: `CREATE TABLE IF NOT EXISTS contracts (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  goal TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  source TEXT NOT NULL DEFAULT 'manual',
  repo_path TEXT,
  current_phase TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  approved_at TEXT,
  owner_email TEXT NOT NULL DEFAULT 'local@localhost',
  org_id TEXT,
  visibility TEXT NOT NULL DEFAULT 'private'
)`,
    },
    {
      version: 2,
      sql: `CREATE TABLE IF NOT EXISTS contract_items (
  id TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL REFERENCES contracts(id),
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  risk TEXT NOT NULL DEFAULT 'medium',
  review_state TEXT NOT NULL DEFAULT 'unreviewed',
  acted_on TEXT NOT NULL DEFAULT 'unknown',
  impact_summary TEXT,
  affected_files TEXT NOT NULL DEFAULT '[]',
  source_refs TEXT NOT NULL DEFAULT '[]',
  linked_item_ids TEXT NOT NULL DEFAULT '[]',
  created_by TEXT NOT NULL DEFAULT 'agent',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`,
    },
    {
      version: 3,
      sql: `CREATE TABLE IF NOT EXISTS contract_evidence (
  id TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL REFERENCES contracts(id),
  linked_item_ids TEXT NOT NULL DEFAULT '[]',
  type TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'agent_attestation',
  trust_level TEXT NOT NULL DEFAULT 'low',
  summary TEXT NOT NULL,
  content TEXT,
  raw_output_path TEXT,
  cwd TEXT,
  command TEXT,
  exit_code INTEGER,
  timestamp TEXT NOT NULL,
  redaction_status TEXT NOT NULL DEFAULT 'not_needed',
  attached_by TEXT NOT NULL DEFAULT 'agent',
  created_at TEXT NOT NULL
)`,
    },
    {
      version: 4,
      sql: `CREATE TABLE IF NOT EXISTS contract_verifications (
  id TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL REFERENCES contracts(id),
  criterion_item_id TEXT NOT NULL REFERENCES contract_items(id),
  evidence_ids TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'missing',
  verified_by TEXT,
  verified_at TEXT,
  note TEXT,
  created_at TEXT NOT NULL
)`,
    },
    {
      version: 5,
      sql: `CREATE TABLE IF NOT EXISTS contract_feedback (
  id TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL REFERENCES contracts(id),
  target_item_id TEXT REFERENCES contract_items(id),
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  structured_patch TEXT,
  consumed_at TEXT,
  created_at TEXT NOT NULL
)`,
    },
    {
      version: 6,
      sql: `CREATE TABLE IF NOT EXISTS contract_events (
  id TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL REFERENCES contracts(id),
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  payload TEXT,
  created_by TEXT NOT NULL DEFAULT 'agent',
  created_at TEXT NOT NULL
)`,
    },
    {
      version: 7,
      sql: {
        postgres: `CREATE TABLE IF NOT EXISTS contract_shares (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL,
  principal_type TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (now())
)`,
        sqlite: `CREATE TABLE IF NOT EXISTS contract_shares (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL,
  principal_type TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`,
      },
    },
    {
      version: 8,
      sql: `CREATE INDEX IF NOT EXISTS contracts_owner_status_idx ON contracts(owner_email, org_id, status, updated_at)`,
    },
    {
      version: 9,
      sql: `CREATE INDEX IF NOT EXISTS contract_items_contract_review_idx ON contract_items(contract_id, review_state, risk)`,
    },
    {
      version: 10,
      sql: `CREATE INDEX IF NOT EXISTS contract_evidence_contract_idx ON contract_evidence(contract_id)`,
    },
    {
      version: 11,
      sql: `CREATE INDEX IF NOT EXISTS contract_feedback_contract_consumed_idx ON contract_feedback(contract_id, consumed_at)`,
    },
  ],
  { table: "contracts_migrations" },
);
