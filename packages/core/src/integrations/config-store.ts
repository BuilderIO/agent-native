import { getDbExec } from "../db/client.js";
import { ensureTableExists } from "../db/ddl-guard.js";

let _initPromise: Promise<void> | undefined;

export async function ensureTable(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      const createSql = `CREATE TABLE IF NOT EXISTS integration_configs (
  platform TEXT NOT NULL,
  config_key TEXT NOT NULL,
  config_data TEXT NOT NULL,
  owner TEXT,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (platform, config_key)
)`;

      {
        // PG guard: probe via information_schema, only issue DDL if missing, bounded lock_timeout
        await ensureTableExists("integration_configs", createSql);
        return;
      }
    })().catch((err) => {
      // Don't cache the rejection — let the next caller retry a fresh init.
      _initPromise = undefined;
      throw err;
    });
  }
  return _initPromise;
}

/**
 * Bumped on every in-process config write. Pollers that back off while their
 * integration is disabled watch this so enabling one takes effect on the next
 * tick instead of at the end of their backoff window.
 */
let _configWriteEpoch = 0;

export function integrationConfigWriteEpoch(): number {
  return _configWriteEpoch;
}

export interface IntegrationConfig {
  platform: string;
  configKey: string;
  configData: Record<string, unknown>;
  owner: string | null;
  updatedAt: number;
}

/**
 * Get the config for a platform integration.
 */
export async function getIntegrationConfig(
  platform: string,
  configKey = "default",
): Promise<IntegrationConfig | null> {
  await ensureTable();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT platform, config_key, config_data, owner, updated_at FROM integration_configs WHERE platform = ? AND config_key = ?`,
    args: [platform, configKey],
  });
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    platform: row.platform as string,
    configKey: row.config_key as string,
    configData: JSON.parse(row.config_data as string),
    owner: (row.owner as string) ?? null,
    updatedAt: row.updated_at as number,
  };
}

/**
 * Save or update a platform integration config.
 */
export async function saveIntegrationConfig(
  platform: string,
  configData: Record<string, unknown>,
  configKey = "default",
  owner?: string,
): Promise<void> {
  await ensureTable();
  const client = getDbExec();
  await client.execute({
    sql: `INSERT INTO integration_configs (platform, config_key, config_data, owner, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (platform, config_key) DO UPDATE SET config_data=EXCLUDED.config_data, owner=EXCLUDED.owner, updated_at=EXCLUDED.updated_at`,
    args: [
      platform,
      configKey,
      JSON.stringify(configData),
      owner ?? null,
      Date.now(),
    ],
  });
  _configWriteEpoch += 1;
}

/** Save only when the inspected config is still the current config. */
export async function saveIntegrationConfigIfUnchanged(
  platform: string,
  configData: Record<string, unknown>,
  configKey: string,
  expected: IntegrationConfig | null,
  owner?: string,
): Promise<boolean> {
  await ensureTable();
  const client = getDbExec();
  const nextRaw = JSON.stringify(configData);
  const result = expected
    ? await client.execute({
        sql: `UPDATE integration_configs SET config_data = ?, updated_at = updated_at + 1 WHERE platform = ? AND config_key = ? AND config_data = ? AND updated_at = ?`,
        args: [
          nextRaw,
          platform,
          configKey,
          JSON.stringify(expected.configData),
          expected.updatedAt,
        ],
      })
    : await client.execute({
        sql: `INSERT INTO integration_configs (platform, config_key, config_data, owner, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (platform, config_key) DO NOTHING`,
        args: [platform, configKey, nextRaw, owner ?? null, Date.now()],
      });

  if (result.rowsAffected === 0) return false;
  _configWriteEpoch += 1;
  return true;
}

/**
 * Delete a platform integration config.
 */
export async function deleteIntegrationConfig(
  platform: string,
  configKey = "default",
): Promise<void> {
  await ensureTable();
  const client = getDbExec();
  await client.execute({
    sql: `DELETE FROM integration_configs WHERE platform = ? AND config_key = ?`,
    args: [platform, configKey],
  });
  _configWriteEpoch += 1;
}

/**
 * List all configs for a platform.
 */
export async function listIntegrationConfigs(
  platform?: string,
): Promise<IntegrationConfig[]> {
  await ensureTable();
  const client = getDbExec();
  const { rows } = platform
    ? await client.execute({
        sql: `SELECT platform, config_key, config_data, owner, updated_at FROM integration_configs WHERE platform = ?`,
        args: [platform],
      })
    : await client.execute(
        `SELECT platform, config_key, config_data, owner, updated_at FROM integration_configs`,
      );
  return rows.map((row) => ({
    platform: row.platform as string,
    configKey: row.config_key as string,
    configData: JSON.parse(row.config_data as string),
    owner: (row.owner as string) ?? null,
    updatedAt: row.updated_at as number,
  }));
}
