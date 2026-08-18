import type { MigrationEntry } from "../db/migrations.js";

/**
 * Remote-device state is read on request paths, so its table must exist before
 * production serverless functions serve requests. The store keeps its local
 * development convergence path for older databases; release migrations own
 * production schema.
 */
export const REMOTE_DEVICE_MIGRATIONS: MigrationEntry[] = [
  {
    version: 1,
    name: "remote-device-table-and-indexes",
    sql: {
      postgres: `
        CREATE TABLE IF NOT EXISTS integration_remote_devices (
          id TEXT PRIMARY KEY,
          owner_email TEXT NOT NULL,
          org_id TEXT,
          label TEXT NOT NULL,
          platform TEXT,
          app_version TEXT,
          host_name TEXT,
          metadata_json TEXT,
          device_token_hash TEXT NOT NULL,
          last_seen_at BIGINT,
          status TEXT NOT NULL,
          revoked_at BIGINT,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_remote_devices_token_hash
          ON integration_remote_devices (device_token_hash);
        CREATE INDEX IF NOT EXISTS idx_remote_devices_owner
          ON integration_remote_devices (owner_email, org_id);
      `,
      sqlite: `
        CREATE TABLE IF NOT EXISTS integration_remote_devices (
          id TEXT PRIMARY KEY,
          owner_email TEXT NOT NULL,
          org_id TEXT,
          label TEXT NOT NULL,
          platform TEXT,
          app_version TEXT,
          host_name TEXT,
          metadata_json TEXT,
          device_token_hash TEXT NOT NULL,
          last_seen_at INTEGER,
          status TEXT NOT NULL,
          revoked_at INTEGER,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_remote_devices_token_hash
          ON integration_remote_devices (device_token_hash);
        CREATE INDEX IF NOT EXISTS idx_remote_devices_owner
          ON integration_remote_devices (owner_email, org_id);
      `,
    },
  },
];

export const REMOTE_DEVICE_MIGRATIONS_TABLE = "_remote_device_migrations";
