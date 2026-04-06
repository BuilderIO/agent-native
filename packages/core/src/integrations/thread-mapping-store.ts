import { getDbExec, isPostgres, intType } from "../db/client.js";

let _initPromise: Promise<void> | undefined;

async function ensureTable(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      const client = getDbExec();
      await client.execute(`
        CREATE TABLE IF NOT EXISTS integration_thread_mappings (
          platform TEXT NOT NULL,
          external_thread_id TEXT NOT NULL,
          internal_thread_id TEXT NOT NULL,
          platform_context TEXT NOT NULL DEFAULT '{}',
          created_at ${intType()} NOT NULL,
          updated_at ${intType()} NOT NULL,
          PRIMARY KEY (platform, external_thread_id)
        )
      `);
    })();
  }
  return _initPromise;
}

export interface ThreadMapping {
  platform: string;
  externalThreadId: string;
  internalThreadId: string;
  platformContext: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

/**
 * Look up the internal thread ID for an external platform thread.
 */
export async function getThreadMapping(
  platform: string,
  externalThreadId: string,
): Promise<ThreadMapping | null> {
  await ensureTable();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT platform, external_thread_id, internal_thread_id, platform_context, created_at, updated_at FROM integration_thread_mappings WHERE platform = ? AND external_thread_id = ?`,
    args: [platform, externalThreadId],
  });
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    platform: row.platform as string,
    externalThreadId: row.external_thread_id as string,
    internalThreadId: row.internal_thread_id as string,
    platformContext: JSON.parse(row.platform_context as string),
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  };
}

/**
 * Create or update a thread mapping.
 */
export async function saveThreadMapping(
  platform: string,
  externalThreadId: string,
  internalThreadId: string,
  platformContext: Record<string, unknown> = {},
): Promise<void> {
  await ensureTable();
  const client = getDbExec();
  const now = Date.now();
  await client.execute({
    sql: isPostgres()
      ? `INSERT INTO integration_thread_mappings (platform, external_thread_id, internal_thread_id, platform_context, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (platform, external_thread_id) DO UPDATE SET internal_thread_id=EXCLUDED.internal_thread_id, platform_context=EXCLUDED.platform_context, updated_at=EXCLUDED.updated_at`
      : `INSERT OR REPLACE INTO integration_thread_mappings (platform, external_thread_id, internal_thread_id, platform_context, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
    args: [
      platform,
      externalThreadId,
      internalThreadId,
      JSON.stringify(platformContext),
      now,
      now,
    ],
  });
}

/**
 * Delete a thread mapping.
 */
export async function deleteThreadMapping(
  platform: string,
  externalThreadId: string,
): Promise<void> {
  await ensureTable();
  const client = getDbExec();
  await client.execute({
    sql: `DELETE FROM integration_thread_mappings WHERE platform = ? AND external_thread_id = ?`,
    args: [platform, externalThreadId],
  });
}

/**
 * List all thread mappings for a platform.
 */
export async function listThreadMappings(
  platform: string,
): Promise<ThreadMapping[]> {
  await ensureTable();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT platform, external_thread_id, internal_thread_id, platform_context, created_at, updated_at FROM integration_thread_mappings WHERE platform = ?`,
    args: [platform],
  });
  return rows.map((row) => ({
    platform: row.platform as string,
    externalThreadId: row.external_thread_id as string,
    internalThreadId: row.internal_thread_id as string,
    platformContext: JSON.parse(row.platform_context as string),
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  }));
}
