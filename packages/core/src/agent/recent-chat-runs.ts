/**
 * Owner-scoped view of the durable `agent_runs` ledger for the Agent runs tray.
 *
 * Every chat turn - foreground included - already writes an `agent_runs` row,
 * but the tray only ever read `progress_runs` (explicit progress actions) and
 * the Agent Teams / harness background listings, so ordinary chat work was
 * invisible there. `agent_runs` has no owner column, so ownership is resolved
 * by joining `chat_threads` through the shared access predicate.
 */
import { chatThreadAccessSql } from "../chat-threads/store.js";
import { getDbExec } from "../db/client.js";
import { ensureRunTables } from "./run-store.js";

/**
 * A terminal run older than this is no longer "recent". Bounds the scan, and
 * matches the pruning window that already removes completed rows after ~1 day.
 * Running rows are always included regardless of age.
 */
const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Wire status vocabulary shared with the tray's background-run rows. */
export type ChatRunStatus = "running" | "completed" | "errored" | "cancelled";

export interface ChatBackgroundRun {
  schemaVersion: 1;
  id: string;
  kind: "chat";
  source: "agent-chat";
  sourceLabel: string;
  sourceRecord: { type: "agent-chat-run"; id: string; threadId: string };
  title: string;
  subtitle?: string;
  status: ChatRunStatus;
  goalId: "agent-chat";
  needsInput: false;
  needsApproval: false;
  createdAt: string;
  updatedAt: string;
  surfaceUrl: string;
  metadata: Record<string, unknown>;
}

export interface ListRecentChatRunsOptions {
  ownerEmail: string;
  orgId?: string | null;
  limit?: number;
  /** Thread ids already represented by another background-run surface. */
  excludeThreadIds?: Iterable<string>;
}

interface ChatRunRow {
  id: string;
  thread_id: string;
  turn_id: string | null;
  status: string;
  started_at: number | string;
  completed_at: number | string | null;
  heartbeat_at: number | string | null;
  last_progress_at: number | string | null;
  terminal_reason: string | null;
  error_code: string | null;
  dispatch_mode: string | null;
  title: string | null;
  preview: string | null;
}

function toWireStatus(status: string): ChatRunStatus {
  switch (status) {
    case "running":
      return "running";
    case "completed":
      return "completed";
    case "aborted":
      return "cancelled";
    default:
      // `errored`, `truncated`, and any future non-success terminal state read
      // as a failure rather than silently as a clean completion.
      return "errored";
  }
}

function toMillis(value: number | string | null): number | null {
  if (value == null) return null;
  const millis = Number(value);
  return Number.isFinite(millis) ? millis : null;
}

function runTitle(row: ChatRunRow): string {
  const title = row.title?.trim();
  if (title) return title;
  const preview = row.preview?.trim();
  if (preview)
    return preview.length > 80 ? `${preview.slice(0, 79)}…` : preview;
  return "Chat";
}

function runSubtitle(
  row: ChatRunRow,
  status: ChatRunStatus,
): string | undefined {
  if (status === "running") return undefined;
  return row.terminal_reason?.trim() || row.error_code?.trim() || undefined;
}

/**
 * Recent chat runs the caller can see, newest first, collapsed to one row per
 * logical turn. A turn that spans several continuation chunks is one unit of
 * work to the user, so only its latest chunk is surfaced.
 */
export async function listRecentChatRuns({
  ownerEmail,
  orgId,
  limit = 5,
  excludeThreadIds,
}: ListRecentChatRunsOptions): Promise<ChatBackgroundRun[]> {
  const normalizedLimit = Math.min(Math.max(Math.floor(limit) || 1, 1), 50);
  await ensureRunTables();
  const access = chatThreadAccessSql(ownerEmail, orgId);
  const client = getDbExec();
  // Over-fetch so collapsing continuation chunks and dropping threads owned by
  // another surface can still fill `normalizedLimit` rows.
  const scanLimit = Math.min(normalizedLimit * 4, 200);
  const columns = `agent_runs.id, agent_runs.thread_id, agent_runs.turn_id, agent_runs.status,
                   agent_runs.started_at, agent_runs.completed_at, agent_runs.heartbeat_at,
                   agent_runs.last_progress_at, agent_runs.terminal_reason, agent_runs.error_code,
                   agent_runs.dispatch_mode, chat_threads.title, chat_threads.preview`;
  const from = `FROM agent_runs
                JOIN chat_threads ON chat_threads.id = agent_runs.thread_id`;

  // Active runs are read separately rather than relying on the recent-window
  // scan to surface them. One `ORDER BY started_at DESC LIMIT n` would cut an
  // older still-running turn whenever `scanLimit` newer terminal rows exist,
  // and that is exactly the case the tray must not miss: it is the signal that
  // keeps its active polling alive. Both statements stay ordered by
  // `started_at` alone so each can walk the recency index instead of sorting
  // the accessible set.
  const [active, recent] = await Promise.all([
    client.execute({
      sql: `SELECT ${columns}
            ${from}
            WHERE ${access.sql}
              AND agent_runs.status = 'running'
            ORDER BY agent_runs.started_at DESC
            LIMIT ?`,
      args: [...access.args, scanLimit],
    }),
    client.execute({
      sql: `SELECT ${columns}
            ${from}
            WHERE ${access.sql}
              AND agent_runs.started_at >= ?
            ORDER BY agent_runs.started_at DESC
            LIMIT ?`,
      args: [...access.args, Date.now() - RECENT_WINDOW_MS, scanLimit],
    }),
  ]);

  // Newest-first across both reads, deduped: the collapse below depends on
  // meeting a turn's latest chunk first.
  const byId = new Map<string, ChatRunRow>();
  for (const raw of [...active.rows, ...recent.rows]) {
    const row = raw as unknown as ChatRunRow;
    if (!byId.has(row.id)) byId.set(row.id, row);
  }
  const rows = [...byId.values()].sort(
    (a, b) => (toMillis(b.started_at) ?? 0) - (toMillis(a.started_at) ?? 0),
  );

  const excluded = new Set(excludeThreadIds ?? []);
  const seenTurns = new Set<string>();
  const activeRows: ChatRunRow[] = [];
  const terminalRows: ChatRunRow[] = [];
  for (const row of rows) {
    if (excluded.has(row.thread_id)) continue;
    if (toMillis(row.started_at) == null) continue;
    // Rows are newest-first, so the first row for a turn is its latest chunk.
    const turnKey = row.turn_id ?? row.id;
    if (seenTurns.has(turnKey)) continue;
    seenTurns.add(turnKey);
    (row.status === "running" ? activeRows : terminalRows).push(row);
  }

  // Active turns claim their slots before finished ones. Truncating in plain
  // recency order would let a burst of completed turns push a run that is
  // still going out of the list, which reads as an idle tray and stops the
  // polling that would have corrected it.
  return [...activeRows.slice(0, normalizedLimit), ...terminalRows]
    .slice(0, normalizedLimit)
    .sort(
      (a, b) => (toMillis(b.started_at) ?? 0) - (toMillis(a.started_at) ?? 0),
    )
    .map(toChatRun);
}

function toChatRun(row: ChatRunRow): ChatBackgroundRun {
  const status = toWireStatus(row.status);
  const startedAt = toMillis(row.started_at) ?? 0;
  const updatedAt =
    toMillis(row.completed_at) ??
    toMillis(row.last_progress_at) ??
    toMillis(row.heartbeat_at) ??
    startedAt;
  return {
    schemaVersion: 1,
    id: row.id,
    kind: "chat",
    source: "agent-chat",
    sourceLabel: "Chat",
    sourceRecord: {
      type: "agent-chat-run",
      id: row.id,
      threadId: row.thread_id,
    },
    title: runTitle(row),
    subtitle: runSubtitle(row, status),
    status,
    goalId: "agent-chat",
    needsInput: false,
    needsApproval: false,
    createdAt: new Date(startedAt).toISOString(),
    updatedAt: new Date(updatedAt).toISOString(),
    surfaceUrl: `agent-native://threads/${encodeURIComponent(row.thread_id)}`,
    metadata: {
      threadId: row.thread_id,
      turnId: row.turn_id,
      dispatchMode: row.dispatch_mode,
      terminalReason: row.terminal_reason,
      errorCode: row.error_code,
    },
  };
}
