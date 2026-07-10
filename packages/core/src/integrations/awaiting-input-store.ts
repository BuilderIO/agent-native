import { getDbExec, intType, isPostgres } from "../db/client.js";
import { ensureTableExists } from "../db/ddl-guard.js";

let initPromise: Promise<void> | undefined;

/** Channel-thread clarification windows are deliberately short-lived. */
export const INTEGRATION_AWAITING_INPUT_TTL_MS = 24 * 60 * 60 * 1000;

async function ensureTable(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const client = getDbExec();
      const createSql = `
        CREATE TABLE IF NOT EXISTS integration_awaiting_inputs (
          platform TEXT NOT NULL,
          external_thread_id TEXT NOT NULL,
          requester_id TEXT NOT NULL,
          expires_at ${intType()} NOT NULL,
          created_at ${intType()} NOT NULL,
          updated_at ${intType()} NOT NULL,
          PRIMARY KEY (platform, external_thread_id)
        )
      `;
      if (isPostgres()) {
        await ensureTableExists("integration_awaiting_inputs", createSql);
        return;
      }
      await client.execute(createSql);
    })().catch((error) => {
      initPromise = undefined;
      throw error;
    });
  }
  return initPromise;
}

/**
 * Open (or refresh) the bounded reply window after an integration explicitly
 * asks the originating Slack user a question. The workspace-qualified external
 * thread id and requester id prevent unrelated channel messages from opting in.
 */
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
    sql: isPostgres()
      ? `INSERT INTO integration_awaiting_inputs (platform, external_thread_id, requester_id, expires_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (platform, external_thread_id) DO UPDATE SET
             requester_id = EXCLUDED.requester_id,
             expires_at = EXCLUDED.expires_at,
             updated_at = EXCLUDED.updated_at`
      : `INSERT OR REPLACE INTO integration_awaiting_inputs (platform, external_thread_id, requester_id, expires_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
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

/**
 * Atomically consume the one reply window for this exact requester. Competing
 * Slack deliveries cannot both claim it, and expired rows never authorize a
 * later unmentioned reply.
 */
export async function consumeIntegrationAwaitingInput(input: {
  platform: string;
  externalThreadId: string;
  requesterId: string;
}): Promise<boolean> {
  await ensureTable();
  const client = getDbExec();
  const result = await client.execute({
    sql: isPostgres()
      ? `DELETE FROM integration_awaiting_inputs
           WHERE platform = ?
             AND external_thread_id = ?
             AND requester_id = ?
             AND expires_at > ?
           RETURNING platform`
      : `DELETE FROM integration_awaiting_inputs
           WHERE platform = ?
             AND external_thread_id = ?
             AND requester_id = ?
             AND expires_at > ?`,
    args: [
      input.platform,
      input.externalThreadId,
      input.requesterId,
      Date.now(),
    ],
  });

  if (isPostgres()) return (result.rows ?? []).length > 0;
  const affected =
    (result as { rowsAffected?: number; rowCount?: number }).rowsAffected ??
    (result as { rowsAffected?: number; rowCount?: number }).rowCount ??
    0;
  return affected > 0;
}

/** Clear any outstanding clarification window once the thread resolves. */
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
  initPromise = undefined;
}
