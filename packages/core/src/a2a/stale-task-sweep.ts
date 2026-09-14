import { getDbExec } from "../db/client.js";
import {
  A2A_PROCESSING_STUCK_AFTER_MS,
  a2aProcessingLifetimeMaxMs,
  a2aQueuedLifetimeMaxMs,
  classifyStuckA2ATask,
  isA2ABackgroundRecoverable,
} from "./task-lifetime.js";
import {
  ensureTable,
  failStuckA2ATask,
  failStuckQueuedA2ATask,
} from "./task-store.js";

/**
 * Recovery for a stuck `a2a_tasks` row used to be reachable from exactly one
 * place: `refireStuckAsyncTaskIfNeeded`, called by an inbound `tasks/get`.
 * That makes it pull-only, and the only poller is the caller's agent — which
 * ends its turn. When the agent stops asking, nothing else ever looks, so a
 * task whose processor died stays `working`/`processing` forever and every
 * surface above it keeps reporting the generic in-progress state. The parent
 * `agent_runs` row is reaped in seconds by `reapAllStaleRuns`, so the database
 * ends up holding two different answers about the same work.
 *
 * This is the push side of the same rule: it applies only the terminal
 * verdicts from `classifyStuckA2ATask`, so a row it fails is a row an inbound
 * `tasks/get` would already have failed. Refiring stays pull-only, because
 * dispatch needs the inbound request's origin and the app's A2A config.
 */

const STALE_A2A_TASK_BATCH_LIMIT = 200;

export interface StaleA2ATaskSweepResult {
  /** Rows moved to `failed` by this pass. */
  reaped: number;
  /**
   * Rows that threw while being failed. A pass where every row failed must not
   * read as "nothing was stuck" — those are the same number otherwise.
   */
  failed: number;
  /** More stuck rows remain than the batch cap; the next tick continues. */
  truncated: boolean;
}

const NOTHING_STUCK: StaleA2ATaskSweepResult = {
  reaped: 0,
  failed: 0,
  truncated: false,
};

/**
 * Narrow to rows a terminal verdict could possibly apply to. The classifier is
 * still the authority per row — this predicate only keeps the scan off the
 * healthy majority, and mirrors the cutoffs the classifier will recompute.
 */
const STUCK_CANDIDATE_SQL = `
  metadata IS NOT NULL
  AND (
    (status_state IN ('submitted', 'working') AND created_at <= ?)
    OR
    (status_state = 'processing' AND (updated_at <= ? OR created_at <= ?))
  )
`;

function stuckCandidateArgs(now: number): number[] {
  return [
    now - a2aQueuedLifetimeMaxMs(),
    now - A2A_PROCESSING_STUCK_AFTER_MS,
    now - a2aProcessingLifetimeMaxMs(),
  ];
}

interface SweepCandidate {
  id: string;
  statusState: string;
  createdAt: number;
  updatedAt: number;
  metadata: Record<string, unknown> | undefined;
}

/**
 * Returns `null` for a row this pass could not evaluate, which the caller
 * counts rather than skipping quietly — an unreadable row is not a healthy
 * row. A row that parses but is simply not processor-dispatched is a different
 * outcome, handled by the eligibility gate below.
 */
function readRow(row: unknown): SweepCandidate | null {
  if (!row || typeof row !== "object") return null;
  const record = row as Record<string, unknown>;
  const id = record.id;
  const statusState = record.status_state;
  const createdAt = Number(record.created_at);
  const updatedAt = Number(record.updated_at);
  if (typeof id !== "string" || typeof statusState !== "string") return null;
  if (!Number.isFinite(createdAt) || !Number.isFinite(updatedAt)) return null;
  const raw = record.metadata;
  if (typeof raw !== "string") return null;
  let metadata: Record<string, unknown> | undefined;
  try {
    const parsed = JSON.parse(raw);
    metadata =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : undefined;
  } catch {
    // coercion-ok: `null` is the typed "could not evaluate" value the caller
    // counts in `failed` — it is never treated as a healthy or absent row.
    return null;
  }
  return { id, statusState, createdAt, updatedAt, metadata };
}

/**
 * Fail every A2A task that has stopped making progress, without waiting for a
 * caller to poll it. Safe to run concurrently with live processors: each
 * terminal write re-checks the same staleness predicate in its own UPDATE
 * WHERE clause, so a heartbeat landing between this SELECT and the write
 * naturally excludes the row.
 */
export async function reapAllStaleA2ATasks(): Promise<StaleA2ATaskSweepResult> {
  await ensureTable();
  const client = getDbExec();
  const now = Date.now();
  const args = stuckCandidateArgs(now);

  // One row over the cap is how a truncated pass is detected without a second
  // COUNT against the same predicate.
  const scanned = await client.execute({
    sql: `SELECT id, status_state, created_at, updated_at, metadata
          FROM a2a_tasks
          WHERE ${STUCK_CANDIDATE_SQL}
          ORDER BY created_at ASC
          LIMIT ${STALE_A2A_TASK_BATCH_LIMIT + 1}`,
    args,
  });

  const rows = Array.from(scanned.rows ?? []);
  if (rows.length === 0) return NOTHING_STUCK;
  const truncated = rows.length > STALE_A2A_TASK_BATCH_LIMIT;
  const batch = truncated ? rows.slice(0, STALE_A2A_TASK_BATCH_LIMIT) : rows;

  let reaped = 0;
  let failed = 0;
  for (const raw of batch) {
    const row = readRow(raw);
    if (!row) {
      // An unreadable row is not a healthy row. Count it so a pass over
      // garbage cannot report itself clean.
      failed += 1;
      continue;
    }
    // A synchronous A2A request sits in `working` for the whole inline handler
    // call and carries no processor metadata. Failing one would terminalize
    // live work, so the sweep only ever touches rows the pull path would.
    if (!isA2ABackgroundRecoverable(row.metadata)) continue;
    const verdict = classifyStuckA2ATask(row, now);
    try {
      if (verdict.kind === "fail-queued") {
        if (
          await failStuckQueuedA2ATask(
            row.id,
            verdict.createdAtCutoff,
            verdict.reason,
          )
        ) {
          reaped += 1;
        }
      } else if (verdict.kind === "fail-processing") {
        if (
          await failStuckA2ATask(
            row.id,
            verdict.processingCutoff,
            verdict.reason,
            verdict.createdAtCutoff,
          )
        ) {
          reaped += 1;
        }
      }
    } catch (error) {
      failed += 1;
      console.error(`[a2a] stale task sweep failed for task ${row.id}:`, error);
    }
  }

  return { reaped, failed, truncated };
}
