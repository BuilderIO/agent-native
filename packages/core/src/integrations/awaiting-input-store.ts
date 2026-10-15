import { getDbExec } from "../db/client.js";
import { ensureTableExists } from "../db/ddl-guard.js";
import { defineStore } from "../db/store-registry.js";

export const INTEGRATION_AWAITING_INPUT_TTL_MS = 24 * 60 * 60 * 1000;

export const awaitingInputsStore = defineStore({
  id: "awaiting_inputs",
  migrations: [
    {
      name: "baseline",
      run: async () => {
        const createSql = `
        CREATE TABLE IF NOT EXISTS integration_awaiting_inputs (
          platform TEXT NOT NULL,
          external_thread_id TEXT NOT NULL,
          requester_id TEXT NOT NULL,
          expires_at BIGINT NOT NULL,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL,
          PRIMARY KEY (platform, external_thread_id)
        )
      `;
        await ensureTableExists("integration_awaiting_inputs", createSql);
      },
    },
  ],
});

export function ensureTable(): Promise<void> {
  return awaitingInputsStore.ready();
}

export async function setIntegrationAwaitingInput(input: {
  platform: string;
  externalThreadId: string;
  requesterId: string;
  expiresAt?: number;
}): Promise<void> {
  await ensureTable();
  const requesterId = input.requesterId.trim();
  if (!requesterId) throw new Error("requesterId is required");
  const now = Date.now();
  const expiresAt = input.expiresAt ?? now + INTEGRATION_AWAITING_INPUT_TTL_MS;
  const client = getDbExec();
  await client.execute({
    sql: `INSERT INTO integration_awaiting_inputs (platform, external_thread_id, requester_id, expires_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (platform, external_thread_id) DO UPDATE SET
             requester_id = EXCLUDED.requester_id,
             expires_at = EXCLUDED.expires_at,
             updated_at = EXCLUDED.updated_at`,
    args: [
      input.platform,
      input.externalThreadId,
      requesterId,
      expiresAt,
      now,
      now,
    ],
  });
}

export async function consumeIntegrationAwaitingInput(input: {
  platform: string;
  externalThreadId: string;
  requesterId: string;
}): Promise<boolean> {
  await ensureTable();
  const client = getDbExec();
  const result = await client.execute({
    sql: `DELETE FROM integration_awaiting_inputs
           WHERE platform = ?
             AND external_thread_id = ?
             AND requester_id = ?
             AND expires_at > ?
           RETURNING platform`,
    args: [
      input.platform,
      input.externalThreadId,
      input.requesterId,
      Date.now(),
    ],
  });

  return (result.rows ?? []).length > 0;
  const affected =
    (result as { rowsAffected?: number; rowCount?: number }).rowsAffected ??
    (result as { rowsAffected?: number; rowCount?: number }).rowCount ??
    0;
  return affected > 0;
}

export async function clearIntegrationAwaitingInput(
  platform: string,
  externalThreadId: string,
): Promise<void> {
  await ensureTable();
  await getDbExec().execute({
    sql: `DELETE FROM integration_awaiting_inputs WHERE platform = ? AND external_thread_id = ?`,
    args: [platform, externalThreadId],
  });
}

export function _resetIntegrationAwaitingInputStoreForTests(): void {
  awaitingInputsStore.reset();
}
