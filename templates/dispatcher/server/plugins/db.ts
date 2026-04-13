import { runMigrations } from "@agent-native/core/db";

export default runMigrations([
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS dispatcher_destinations (
        id TEXT PRIMARY KEY,
        owner_email TEXT NOT NULL,
        org_id TEXT,
        name TEXT NOT NULL,
        platform TEXT NOT NULL,
        destination TEXT NOT NULL,
        thread_ref TEXT,
        notes TEXT,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS dispatcher_identity_links (
        id TEXT PRIMARY KEY,
        owner_email TEXT NOT NULL,
        org_id TEXT,
        platform TEXT NOT NULL,
        external_user_id TEXT NOT NULL,
        external_user_name TEXT,
        linked_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS dispatcher_link_tokens (
        id TEXT PRIMARY KEY,
        token TEXT NOT NULL,
        owner_email TEXT NOT NULL,
        org_id TEXT,
        platform TEXT NOT NULL,
        created_by TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        claimed_at INTEGER,
        claimed_by_external_user_id TEXT,
        claimed_by_external_user_name TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS dispatcher_approval_requests (
        id TEXT PRIMARY KEY,
        owner_email TEXT NOT NULL,
        org_id TEXT,
        change_type TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT,
        status TEXT NOT NULL,
        summary TEXT NOT NULL,
        payload TEXT NOT NULL,
        before_value TEXT,
        after_value TEXT,
        requested_by TEXT NOT NULL,
        reviewed_by TEXT,
        reviewed_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS dispatcher_audit_events (
        id TEXT PRIMARY KEY,
        owner_email TEXT NOT NULL,
        org_id TEXT,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT,
        summary TEXT NOT NULL,
        metadata TEXT,
        created_at INTEGER NOT NULL
      );
    `,
  },
]);
