import { startTransition } from "react";

const IDLE_MOUNT_TIMEOUT_MS = 200;

const queue = new Set<() => void>();
let scheduled: (() => void) | undefined;

function flush(): void {
  scheduled = undefined;
  const tasks = Array.from(queue);
  queue.clear();
  // One interruptible render for every row that asked in this idle period.
  startTransition(() => {
    for (const task of tasks) task();
  });
}

function scheduleFlush(): () => void {
  if (typeof requestIdleCallback === "function") {
    const handle = requestIdleCallback(flush, {
      timeout: IDLE_MOUNT_TIMEOUT_MS,
    });
    return () => cancelIdleCallback(handle);
  }
  const handle = setTimeout(flush, 16);
  return () => clearTimeout(handle);
}

/**
 * Runs `task` (a state update that mounts deferred content) in the next idle
 * period, batched with every other deferred mount and rendered as a
 * transition, so off-screen history and collapsed content stay off the path
 * to the first paint. Returns a cancel function.
 */
export function scheduleIdleMount(task: () => void): () => void {
  queue.add(task);
  scheduled ??= scheduleFlush();
  return () => {
    queue.delete(task);
    if (queue.size === 0 && scheduled) {
      scheduled();
      scheduled = undefined;
    }
  };
}
