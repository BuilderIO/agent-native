import { runMigrations } from "@agent-native/core/db";

export default runMigrations([
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS dispatch_destinations (
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

      CREATE TABLE IF NOT EXISTS dispatch_identity_links (
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

      CREATE TABLE IF NOT EXISTS dispatch_link_tokens (
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

      CREATE TABLE IF NOT EXISTS dispatch_approval_requests (
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

      CREATE TABLE IF NOT EXISTS dispatch_audit_events (
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
  {
    version: 2,
    sql: `
      CREATE TABLE IF NOT EXISTS vault_secrets (
        id TEXT PRIMARY KEY,
        owner_email TEXT NOT NULL,
        org_id TEXT,
        name TEXT NOT NULL,
        credential_key TEXT NOT NULL,
        value TEXT NOT NULL,
        provider TEXT,
        description TEXT,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS vault_grants (
        id TEXT PRIMARY KEY,
        owner_email TEXT NOT NULL,
        org_id TEXT,
        secret_id TEXT NOT NULL,
        app_id TEXT NOT NULL,
        granted_by TEXT NOT NULL,
        status TEXT NOT NULL,
        synced_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS vault_requests (
        id TEXT PRIMARY KEY,
        owner_email TEXT NOT NULL,
        org_id TEXT,
        credential_key TEXT NOT NULL,
        app_id TEXT NOT NULL,
        reason TEXT,
        requested_by TEXT NOT NULL,
        status TEXT NOT NULL,
        reviewed_by TEXT,
        reviewed_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS vault_audit_log (
        id TEXT PRIMARY KEY,
        owner_email TEXT NOT NULL,
        org_id TEXT,
        secret_id TEXT,
        app_id TEXT,
        action TEXT NOT NULL,
        actor TEXT NOT NULL,
        summary TEXT NOT NULL,
        metadata TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workspace_resources (
        id TEXT PRIMARY KEY,
        owner_email TEXT NOT NULL,
        org_id TEXT,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        path TEXT NOT NULL,
        content TEXT NOT NULL,
        scope TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workspace_resource_grants (
        id TEXT PRIMARY KEY,
        owner_email TEXT NOT NULL,
        org_id TEXT,
        resource_id TEXT NOT NULL,
        app_id TEXT NOT NULL,
        status TEXT NOT NULL,
        synced_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `,
  },
], { table: "dispatch_migrations" });
