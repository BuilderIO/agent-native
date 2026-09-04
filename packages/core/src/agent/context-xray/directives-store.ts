import { appStateGet, appStatePut } from "../../application-state/store.js";
import { getDbExec } from "../../db/client.js";
import {
  CONTEXT_XRAY_MANIFEST_KEY,
  type ContextDirective,
  type ContextDirectiveAction,
  type ContextDirectiveCreator,
  type ContextManifest,
} from "../../shared/context-xray.js";
import { updateManifestSegmentStatus } from "./manifest.js";

function directiveId(): string {
  return `ctxdir-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function rowBool(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

function rowToDirective(row: Record<string, unknown>): ContextDirective {
  return {
    id: String(row.id),
    threadId: String(row.thread_id),
    segmentId: String(row.segment_id),
    action: row.action as ContextDirectiveAction,
    summaryText: typeof row.summary_text === "string" ? row.summary_text : null,
    createdBy: row.created_by as ContextDirectiveCreator,
    active: rowBool(row.active),
    originTurn: typeof row.origin_turn === "string" ? row.origin_turn : null,
    createdAt: Number(row.created_at) || undefined,
    updatedAt: Number(row.updated_at) || undefined,
  };
}

export async function loadContextDirectives(
  threadId: string,
  opts: { ownerEmail?: string | null } = {},
): Promise<Map<string, ContextDirective>> {
  const client = getDbExec();
  const ownerClause = opts.ownerEmail ? " AND owner_email = ?" : "";
  const args: unknown[] = [threadId, 1];
  if (opts.ownerEmail) args.push(opts.ownerEmail);
  const result = await client.execute({
    sql: `SELECT * FROM context_directives WHERE thread_id = ? AND active = ?${ownerClause} ORDER BY updated_at ASC`,
    args,
  });
  const out = new Map<string, ContextDirective>();
  for (const row of result.rows as Record<string, unknown>[]) {
    const directive = rowToDirective(row);
    out.set(directive.segmentId, directive);
  }
  return out;
}

export async function upsertContextDirective(input: {
  threadId: string;
  segmentId: string;
  action: ContextDirectiveAction;
  summaryText?: string | null;
  createdBy?: ContextDirectiveCreator;
  originTurn?: string | null;
  ownerEmail: string;
  orgId?: string | null;
}): Promise<ContextDirective> {
  const client = getDbExec();
  const now = Date.now();
  const existing = await client.execute({
    sql: `SELECT * FROM context_directives WHERE thread_id = ? AND segment_id = ? AND owner_email = ? ORDER BY updated_at DESC LIMIT 1`,
    args: [input.threadId, input.segmentId, input.ownerEmail],
  });
  const row = (existing.rows as Record<string, unknown>[])[0];
  if (row) {
    await client.execute({
      sql: `UPDATE context_directives
        SET action = ?, summary_text = ?, created_by = ?, active = ?, origin_turn = ?, updated_at = ?, org_id = COALESCE(?, org_id)
        WHERE id = ? AND owner_email = ?`,
      args: [
        input.action,
        input.summaryText ?? null,
        input.createdBy ?? "user",
        1,
        input.originTurn ?? null,
        now,
        input.orgId ?? null,
        row.id,
        input.ownerEmail,
      ],
    });
    return {
      ...rowToDirective(row),
      action: input.action,
      summaryText: input.summaryText ?? null,
      createdBy: input.createdBy ?? "user",
      active: true,
      originTurn: input.originTurn ?? null,
      updatedAt: now,
    };
  }

  const id = directiveId();
  await client.execute({
    sql: `INSERT INTO context_directives
      (id, thread_id, segment_id, action, summary_text, created_by, active, origin_turn, created_at, updated_at, owner_email, org_id, visibility)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      input.threadId,
      input.segmentId,
      input.action,
      input.summaryText ?? null,
      input.createdBy ?? "user",
      1,
      input.originTurn ?? null,
      now,
      now,
      input.ownerEmail,
      input.orgId ?? null,
      "private",
    ],
  });

  return {
    id,
    threadId: input.threadId,
    segmentId: input.segmentId,
    action: input.action,
    summaryText: input.summaryText ?? null,
    createdBy: input.createdBy ?? "user",
    active: true,
    originTurn: input.originTurn ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

export async function deactivateContextDirective(input: {
  threadId: string;
  segmentId: string;
  ownerEmail: string;
}): Promise<number> {
  const result = await getDbExec().execute({
    sql: `UPDATE context_directives SET active = ?, updated_at = ? WHERE thread_id = ? AND segment_id = ? AND owner_email = ?`,
    args: [0, Date.now(), input.threadId, input.segmentId, input.ownerEmail],
  });
  return result.rowsAffected;
}

export async function readContextManifest(
  threadId: string,
): Promise<ContextManifest | null> {
  return (await appStateGet(
    threadId,
    CONTEXT_XRAY_MANIFEST_KEY,
  )) as unknown as ContextManifest | null;
}

export async function writeContextManifestStatus(input: {
  threadId: string;
  segmentId: string;
  status: "active" | "pinned" | "evicted" | "summarized";
}): Promise<ContextManifest | null> {
  const current = await readContextManifest(input.threadId);
  if (!current) return null;
  const next = updateManifestSegmentStatus(
    current,
    input.segmentId,
    input.status,
  );
  await appStatePut(
    input.threadId,
    CONTEXT_XRAY_MANIFEST_KEY,
    next as unknown as Record<string, unknown>,
    {
      requestSource: "context-xray",
    },
  );
  return next;
}
