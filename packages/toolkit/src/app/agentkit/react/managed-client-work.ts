import type { AgentKitController } from "@agent-native/agentkit/client";

const pendingWork = new WeakMap<AgentKitController, Set<Promise<unknown>>>();

export function trackManagedClientWork<T>(
  controller: AgentKitController,
  work: Promise<T>,
): Promise<T> {
  let pending = pendingWork.get(controller);
  if (!pending) {
    pending = new Set();
    pendingWork.set(controller, pending);
  }
  pending.add(work);
  const tracked = pending;
  const release = () => {
    tracked.delete(work);
    if (tracked.size === 0) pendingWork.delete(controller);
  };
  void work.then(release, release);
  return work;
}

export async function waitForManagedClientWork(
  controller: AgentKitController,
): Promise<void> {
  let pending = pendingWork.get(controller);
  while (pending?.size) {
    await Promise.allSettled([...pending]);
    pending = pendingWork.get(controller);
  }
}
