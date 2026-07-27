import { randomUUID } from "node:crypto";

import { getDbExec, intType, isPostgres } from "../db/client.js";
import {
  ensureColumnExists,
  ensureIndexExists,
  ensureTableExists,
} from "../db/ddl-guard.js";
import { isDuplicateColumnError } from "../db/migrations.js";
import type { IncomingMessage } from "./types.js";

let initPromise: Promise<void> | undefined;

export type IntegrationControlAction = "approve" | "deny" | "cancel";

export interface IntegrationControl {
  id: string;
  action: IntegrationControlAction;
  ownerEmail: string;
  orgId: string | null;
  requesterId: string;
  teamId: string;
  apiAppId: string | null;
  channelId: string;
  messageTs: string;
  runId: string | null;
  approvalKey: string | null;
  incoming: IncomingMessage;
  status: "pending" | "claimed" | "expired";
  expiresAt: number;
}

async function ensureTable(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const sql = `CREATE TABLE IF NOT EXISTS integration_controls (
        id TEXT PRIMARY KEY,
        action TEXT NOT NULL,
        owner_email TEXT NOT NULL,
        org_id TEXT,
        requester_id TEXT NOT NULL,
        team_id TEXT NOT NULL,
        api_app_id TEXT,
        channel_id TEXT NOT NULL,
        message_ts TEXT NOT NULL,
        run_id TEXT,
        approval_key TEXT,
        incoming_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        expires_at ${intType()} NOT NULL,
        created_at ${intType()} NOT NULL,
        claimed_at ${intType()}
      )`;
      if (isPostgres()) {
        await ensureTableExists("integration_controls", sql);
        await ensureColumnExists(
          "integration_controls",
          "api_app_id",
          "ALTER TABLE integration_controls ADD COLUMN IF NOT EXISTS api_app_id TEXT",
        );
        await ensureIndexExists(
          "idx_integration_controls_expiry",
          "CREATE INDEX IF NOT EXISTS idx_integration_controls_expiry ON integration_controls(status, expires_at)",
        );
      } else {
        await getDbExec().execute(sql);
        try {
          await getDbExec().execute(
            "ALTER TABLE integration_controls ADD COLUMN api_app_id TEXT",
          );
        } catch (error) {
          if (!isDuplicateColumnError(error)) throw error;
        }
        await getDbExec().execute(
          "CREATE INDEX IF NOT EXISTS idx_integration_controls_expiry ON integration_controls(status, expires_at)",
        );
      }
    })().catch((error) => {
      initPromise = undefined;
      throw error;
    });
  }
  return initPromise;
}

export function _resetIntegrationControlsStoreForTests(): void {
  initPromise = undefined;
}

function rowToControl(row: Record<string, unknown>): IntegrationControl {
  return {
    id: String(row.id),
    action: row.action as IntegrationControlAction,
    ownerEmail: String(row.owner_email),
    orgId: row.org_id == null ? null : String(row.org_id),
    requesterId: String(row.requester_id),
    teamId: String(row.team_id),
    apiAppId: row.api_app_id == null ? null : String(row.api_app_id),
    channelId: String(row.channel_id),
    messageTs: String(row.message_ts),
    runId: row.run_id == null ? null : String(row.run_id),
    approvalKey: row.approval_key == null ? null : String(row.approval_key),
    incoming: JSON.parse(String(row.incoming_json)) as IncomingMessage,
    status: row.status as IntegrationControl["status"],
    expiresAt: Number(row.expires_at),
  };
}

export async function createIntegrationControl(input: {
  action: IntegrationControlAction;
  ownerEmail: string;
  orgId?: string | null;
  requesterId: string;
  teamId: string;
  apiAppId?: string | null;
  channelId: string;
  messageTs: string;
  runId?: string | null;
  approvalKey?: string | null;
  incoming: IncomingMessage;
  ttlMs?: number;
}): Promise<string> {
  await ensureTable();
  const id = `ctl_${randomUUID().replaceAll("-", "")}`;
  const now = Date.now();
  await getDbExec().execute({
    sql: `INSERT INTO integration_controls
      (id, action, owner_email, org_id, requester_id, team_id, api_app_id, channel_id,
       message_ts, run_id, approval_key, incoming_json, status, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    args: [
      id,
      input.action,
      input.ownerEmail.toLowerCase(),
      input.orgId ?? null,
      input.requesterId,
      input.teamId,
      input.apiAppId ?? null,
      input.channelId,
      input.messageTs,
      input.runId ?? null,
      input.approvalKey ?? null,
      JSON.stringify(input.incoming),
      now + (input.ttlMs ?? 15 * 60_000),
      now,
    ],
  });
  return id;
}

/** Atomically bind a one-shot Slack button to its original requester/thread. */
export async function claimIntegrationControl(input: {
  id: string;
  action: IntegrationControlAction;
  requesterId: string;
  teamId: string;
  apiAppId?: string;
  channelId: string;
  messageTs: string;
}): Promise<IntegrationControl | null> {
  await ensureTable();
  const now = Date.now();
  const result = await getDbExec().execute({
    sql: `UPDATE integration_controls SET status = 'claimed', claimed_at = ?
      WHERE id = ? AND action = ? AND requester_id = ? AND team_id = ?
        AND (api_app_id IS NULL OR api_app_id = ?)
        AND channel_id = ? AND message_ts = ? AND status = 'pending'
        AND expires_at > ?`,
    args: [
      now,
      input.id,
      input.action,
      input.requesterId,
      input.teamId,
      input.apiAppId ?? "",
      input.channelId,
      input.messageTs,
      now,
    ],
  });
  if (result.rowsAffected === 0) return null;
  const { rows } = await getDbExec().execute({
    sql: "SELECT * FROM integration_controls WHERE id = ? LIMIT 1",
    args: [input.id],
  });
  return rows[0] ? rowToControl(rows[0] as Record<string, unknown>) : null;
}
