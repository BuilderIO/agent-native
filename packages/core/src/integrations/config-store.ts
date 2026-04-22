import {
  getDbExec,
  isPostgres,
  intType,
  retryOnDdlRace,
} from "../db/client.js";

let _initPromise: Promise<void> | undefined;

async function ensureTable(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      const client = getDbExec();
      await retryOnDdlRace(() =>
        client.execute(`
          CREATE TABLE IF NOT EXISTS integration_configs (
            platform TEXT NOT NULL,
            config_key TEXT NOT NULL,
            config_data TEXT NOT NULL,
            owner TEXT,
            updated_at ${intType()} NOT NULL,
            PRIMARY KEY (platform, config_key)
          )
        `),
      );
    })().catch((err) => {
      // Don't cache the rejection — let the next caller retry a fresh init.
      _initPromise = undefined;
      throw err;
    });
  }
  return _initPromise;
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
    sql: isPostgres()
      ? `INSERT INTO integration_configs (platform, config_key, config_data, owner, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (platform, config_key) DO UPDATE SET config_data=EXCLUDED.config_data, owner=EXCLUDED.owner, updated_at=EXCLUDED.updated_at`
      : `INSERT OR REPLACE INTO integration_configs (platform, config_key, config_data, owner, updated_at) VALUES (?, ?, ?, ?, ?)`,
    args: [
      platform,
      configKey,
      JSON.stringify(configData),
      owner ?? null,
      Date.now(),
    ],
  });
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
