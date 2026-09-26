
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

export function getAskAppInlineTask(
  taskId: string,
): AskAppInlineTaskSnapshot | undefined {
  evictStaleInlineTasks(Date.now());
  const entry = inlineTasks.get(taskId);
  return entry ? toSnapshot(taskId, entry) : undefined;
}
