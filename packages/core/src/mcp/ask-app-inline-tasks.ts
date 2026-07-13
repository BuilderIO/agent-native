/**
 * Process-local fallback task tracker for `ask_app` (and the legacy
 * `ask-agent` meta-tool) for the one case where no app origin is derivable
 * from the MCP request — `selfA2AEndpointUrl(requestMeta)` returns null in
 * `builtin-tools.ts`. Without an origin there is no `/_agent-native/a2a`
 * endpoint to submit a durable task to, so `config.askAgent(message)` used
 * to be awaited unbounded, which can hold a hosted MCP request open past a
 * serverless gateway's inactivity timeout. This gives that path the same
 * bounded "return a taskId, keep working in the background" contract as the
 * durable A2A path, without needing a database.
 *
 * Entries are **process-local, not durable** — they live only in this
 * server instance's memory and are lost on restart or if a different
 * instance handles the poll. That is an acceptable trade-off here: this
 * fallback only exists because no app origin was derivable in the first
 * place, so there was never a reachable endpoint another instance could
 * have polled anyway.
 *
 * Eviction is lazy (checked on each map access) instead of timer-based, so
 * this stays serverless-safe — nothing keeps the process alive to sweep.
 */

type AskAppInlineTaskStatus = "working" | "completed" | "failed";

interface AskAppInlineTaskEntry {
  status: AskAppInlineTaskStatus;
  response?: string;
  error?: string;
  createdAt: number;
  settledAt?: number;
}

export interface AskAppInlineTaskSnapshot {
  taskId: string;
  status: AskAppInlineTaskStatus;
  response?: string;
  error?: string;
}

const SETTLED_TASK_TTL_MS = 10 * 60_000;
const UNSETTLED_TASK_TTL_MS = 30 * 60_000;

const inlineTasks = new Map<string, AskAppInlineTaskEntry>();

function evictStaleInlineTasks(now: number): void {
  for (const [taskId, entry] of inlineTasks) {
    const ttlMs =
      entry.settledAt != null ? SETTLED_TASK_TTL_MS : UNSETTLED_TASK_TTL_MS;
    const anchor = entry.settledAt ?? entry.createdAt;
    if (now - anchor > ttlMs) inlineTasks.delete(taskId);
  }
}

function toSnapshot(
  taskId: string,
  entry: AskAppInlineTaskEntry,
): AskAppInlineTaskSnapshot {
  return {
    taskId,
    status: entry.status,
    ...(entry.response !== undefined ? { response: entry.response } : {}),
    ...(entry.error !== undefined ? { error: entry.error } : {}),
  };
}

/**
 * Start `askAgent(message)` under a fresh process-local taskId and wait up
 * to `maxWaitMs` for it to settle. The map entry is written synchronously
 * before the async work starts, so a poll racing this call can never see a
 * missing taskId. Returns the settled snapshot when it finishes in time, or
 * a `"working"` snapshot once `maxWaitMs` elapses — the caller can hand that
 * taskId back to `getAskAppInlineTask` later to pick up the final result.
 */
export async function startAskAppInlineTask(
  askAgent: (message: string) => Promise<string>,
  message: string,
  maxWaitMs: number,
): Promise<AskAppInlineTaskSnapshot> {
  const now = Date.now();
  evictStaleInlineTasks(now);

  const taskId = globalThis.crypto.randomUUID();
  const entry: AskAppInlineTaskEntry = { status: "working", createdAt: now };
  inlineTasks.set(taskId, entry);

  const settled = askAgent(message).then(
    (response) => {
      entry.status = "completed";
      entry.response = response;
      entry.settledAt = Date.now();
    },
    (err) => {
      entry.status = "failed";
      entry.error =
        err instanceof Error
          ? err.message
          : String(err ?? "ask_app task failed.");
      entry.settledAt = Date.now();
    },
  );

  if (maxWaitMs > 0) {
    await Promise.race([
      settled,
      new Promise<void>((resolve) => setTimeout(resolve, maxWaitMs)),
    ]);
  }

  return toSnapshot(taskId, entry);
}

/**
 * Look up a process-local inline task started by `startAskAppInlineTask`.
 * Returns `undefined` when the id is unknown — never started here, already
 * evicted, or (in a multi-instance deployment) started on a different
 * instance. Callers should fall through to the normal A2A HTTP status path
 * in that case.
 */
export function getAskAppInlineTask(
  taskId: string,
): AskAppInlineTaskSnapshot | undefined {
  evictStaleInlineTasks(Date.now());
  const entry = inlineTasks.get(taskId);
  return entry ? toSnapshot(taskId, entry) : undefined;
}
