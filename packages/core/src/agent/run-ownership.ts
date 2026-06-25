import { getThread } from "../chat-threads/store.js";
/**
 * Ownership checks for the agent run HTTP routes (`/runs/:id/events`,
 * `/runs/:id/abort`, `/runs/active`).
 *
 * `agent_runs` has no owner column — a run's ownership lives on its
 * `chat_threads` row via `thread_id`. These helpers resolve that link and
 * compare the thread's owner to the requesting user, so the run routes can
 * reject cross-tenant access (any authenticated user who learns another
 * tenant's runId/threadId must not be able to stream their live agent turn or
 * abort their run).
 */
import { getRun } from "./run-manager.js";
import { getRunById } from "./run-store.js";

/**
 * Resolve a run's owning thread id. Checks in-memory run state first (populated
 * synchronously by startRun, so there is no race against the async SQL insert),
 * then falls back to SQL for cross-isolate / post-reload lookups. Returns null
 * when the run is unknown.
 */
export async function resolveRunThreadId(
  runId: string,
): Promise<string | null> {
  const memRun = getRun(runId);
  if (memRun) return memRun.threadId;
  const row = await getRunById(runId);
  return row?.threadId ?? null;
}

/** True when `owner` owns the chat thread `threadId`. */
export async function callerOwnsThread(
  owner: string,
  threadId: string | null | undefined,
): Promise<boolean> {
  if (!threadId) return false;
  const thread = await getThread(threadId);
  return !!thread && thread.ownerEmail === owner;
}

/** True when `owner` owns the thread that run `runId` belongs to. */
export async function callerOwnsRun(
  owner: string,
  runId: string,
): Promise<boolean> {
  return callerOwnsThread(owner, await resolveRunThreadId(runId));
}
