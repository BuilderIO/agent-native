import { getDbExec } from "../db/client.js";
import { escapeLike } from "./store.js";

export interface ChatAuditFilter {
  email?: string;
  deck?: string;
  threadId?: string;
  runId?: string;
  limit?: number;
}

export interface ChatAuditRun {
  runId: string;
  turnId: string | null;
  status: string;
  startedAt: number;
  completedAt: number | null;
  terminalReason: string | null;
  errorCode: string | null;
  dispatchMode: string | null;
  initiatorEmail: string | null;
}

export interface ChatAuditThread {
  threadId: string;
  ownerEmail: string;
  title: string;
  messageCount: number;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
  scopeType: string | null;
  scopeId: string | null;
  sourceUrl: string | null;
  runs: ChatAuditRun[];
}

/** Deck links carry the id in the path, so match on the last segment. */
function deckIdFromInput(input: string): string {
  const trimmed = input
    .trim()
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "");
  return trimmed.slice(trimmed.lastIndexOf("/") + 1);
}

function threadConditions(filter: ChatAuditFilter): {
  sql: string[];
  args: string[];
} {
  const sql: string[] = [];
  const args: string[] = [];
  if (filter.email) {
    sql.push(
      `LOWER(t.owner_email) = LOWER(?) OR t.id IN (SELECT thread_id FROM agent_turn_initiators WHERE LOWER(principal_email) = LOWER(?))`,
    );
    args.push(filter.email, filter.email);
  }
  if (filter.deck) {
    const id = deckIdFromInput(filter.deck);
    const pattern = `%${escapeLike(id)}%`;
    sql.push(
      `t.scope_id = ? OR t.source_url LIKE ? ESCAPE '!' OR t.thread_data LIKE ? ESCAPE '!'`,
    );
    args.push(id, pattern, pattern);
  }
  if (filter.threadId) {
    sql.push(`t.id = ?`);
    args.push(filter.threadId);
  }
  if (filter.runId) {
    sql.push(`t.id IN (SELECT thread_id FROM agent_runs WHERE id = ?)`);
    args.push(filter.runId);
  }
  return { sql, args };
}

/**
 * Operator-only read across all owners: this bypasses the per-user ownership
 * filter on purpose, so it must only be reachable from the CLI, never a route.
 */
export async function auditChats(
  filter: ChatAuditFilter,
): Promise<ChatAuditThread[]> {
  const { sql, args } = threadConditions(filter);
  if (sql.length === 0) {
    throw new Error(
      "auditChats requires an email, deck, thread, or run filter",
    );
  }
  const where = sql.map((s) => `(${s})`).join(" OR ");
  const db = getDbExec();

  const { rows: threadRows } = await db.execute({
    sql: `SELECT t.id, t.owner_email, t.title, t.message_count, t.created_at, t.updated_at, t.archived_at, t.scope_type, t.scope_id, t.source_url
          FROM chat_threads t
          WHERE ${where}
          ORDER BY t.updated_at DESC
          LIMIT ?`,
    args: [...args, filter.limit ?? 20],
  });
  const threads = threadRows as Record<string, unknown>[];
  if (threads.length === 0) return [];

  const threadIds = threads.map((t) => String(t.id));
  const { rows: runRows } = await db.execute({
    sql: `SELECT r.id, r.thread_id, r.turn_id, r.status, r.started_at, r.completed_at, r.terminal_reason, r.error_code, r.dispatch_mode, i.principal_email
          FROM agent_runs r
          LEFT JOIN agent_turn_initiators i
            ON i.thread_id = r.thread_id
           AND i.turn_id = COALESCE(r.turn_id, r.id)
          WHERE r.thread_id IN (${threadIds.map(() => "?").join(", ")})
          ORDER BY r.started_at DESC`,
    args: threadIds,
  });

  const runsByThread = new Map<string, ChatAuditRun[]>();
  for (const r of runRows as Record<string, unknown>[]) {
    const threadId = String(r.thread_id);
    const runs = runsByThread.get(threadId) ?? [];
    runs.push({
      runId: String(r.id),
      turnId: r.turn_id == null ? null : String(r.turn_id),
      status: String(r.status),
      startedAt: Number(r.started_at),
      completedAt: r.completed_at == null ? null : Number(r.completed_at),
      terminalReason:
        r.terminal_reason == null ? null : String(r.terminal_reason),
      errorCode: r.error_code == null ? null : String(r.error_code),
      dispatchMode: r.dispatch_mode == null ? null : String(r.dispatch_mode),
      initiatorEmail:
        r.principal_email == null ? null : String(r.principal_email),
    });
    runsByThread.set(threadId, runs);
  }

  return threads.map((t) => ({
    threadId: String(t.id),
    ownerEmail: String(t.owner_email),
    title: String(t.title ?? ""),
    messageCount: Number(t.message_count),
    createdAt: Number(t.created_at),
    updatedAt: Number(t.updated_at),
    archivedAt: t.archived_at == null ? null : Number(t.archived_at),
    scopeType: t.scope_type == null ? null : String(t.scope_type),
    scopeId: t.scope_id == null ? null : String(t.scope_id),
    sourceUrl: t.source_url == null ? null : String(t.source_url),
    runs: runsByThread.get(String(t.id)) ?? [],
  }));
}
