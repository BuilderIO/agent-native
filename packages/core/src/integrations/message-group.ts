import {
  absorbPendingTask,
  listPendingTasksForThread,
  type PendingTask,
} from "./pending-tasks-store.js";
import type { IncomingMessage, PlatformAdapter } from "./types.js";

// Telegram sends the updates of one album within moments of each other. A
// thread runs one task at a time, so the rest of the album is still waiting
// in the queue while its first update is being processed.
export const MESSAGE_GROUP_QUIET_MS = 1_000;
export const MESSAGE_GROUP_MAX_WAIT_MS = 3_000;
const MESSAGE_GROUP_POLL_MS = 200;

export interface CollectMessageGroupOptions {
  quietMs?: number;
  maxWaitMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

function waitingGroupMembers(
  task: PendingTask,
  incoming: IncomingMessage,
  pending: PendingTask[],
): Array<{ id: string; incoming: IncomingMessage }> {
  return pending.flatMap((row) => {
    if (row.id === task.id) return [];
    try {
      const other = (JSON.parse(row.payload) as { incoming?: IncomingMessage })
        .incoming;
      return other &&
        other.platform === incoming.platform &&
        other.messageGroupId === incoming.messageGroupId
        ? [{ id: row.id, incoming: other }]
        : [];
    } catch {
      return [];
    }
  });
}

/**
 * Fold the waiting updates of a message group (a Telegram album) into the
 * task being processed, so the group gets one agent turn. Waits until no new
 * update of the group has arrived for `quietMs`, at most `maxWaitMs`. An
 * update that arrives after that gets its own turn.
 *
 * Returns the merged message, or null when there was nothing to merge.
 */
export async function collectMessageGroup(
  task: PendingTask,
  incoming: IncomingMessage,
  adapter: PlatformAdapter,
  options: CollectMessageGroupOptions = {},
): Promise<IncomingMessage | null> {
  if (!incoming.messageGroupId || !adapter.mergeMessageGroup) return null;
  const quietMs = options.quietMs ?? MESSAGE_GROUP_QUIET_MS;
  const maxWaitMs = options.maxWaitMs ?? MESSAGE_GROUP_MAX_WAIT_MS;
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  let waitedMs = 0;
  let quietForMs = 0;
  let lastCount = -1;
  for (;;) {
    const count = waitingGroupMembers(
      task,
      incoming,
      await listPendingTasksForThread(task.platform, task.externalThreadId),
    ).length;
    if (count !== lastCount) {
      lastCount = count;
      quietForMs = 0;
    }
    if (quietForMs >= quietMs || waitedMs >= maxWaitMs) break;
    await sleep(MESSAGE_GROUP_POLL_MS);
    waitedMs += MESSAGE_GROUP_POLL_MS;
    quietForMs += MESSAGE_GROUP_POLL_MS;
  }

  const absorbed: IncomingMessage[] = [];
  for (const member of waitingGroupMembers(
    task,
    incoming,
    await listPendingTasksForThread(task.platform, task.externalThreadId),
  )) {
    if (await absorbPendingTask(member.id)) absorbed.push(member.incoming);
  }
  if (absorbed.length === 0) return null;
  return adapter.mergeMessageGroup([incoming, ...absorbed]);
}
