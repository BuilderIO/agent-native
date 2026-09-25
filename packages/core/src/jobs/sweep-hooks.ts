export type RecurringSweepHandler = () => Promise<void>;

const handlers = new Map<string, RecurringSweepHandler>();

export function registerRecurringSweepHandler(
  id: string,
  handler: RecurringSweepHandler,
): () => void {
  const key = id.trim();
  if (!key) throw new Error("Recurring sweep handler id is required.");
  handlers.set(key, handler);
  return () => {
    if (handlers.get(key) === handler) handlers.delete(key);
  };
}

export function hasRecurringSweepHandler(id: string): boolean {
  return handlers.has(id);
}

export async function runRecurringSweepHandlers(): Promise<{
  registered: number;
  failed: string[];
}> {
  const failed: string[] = [];
  const snapshot = [...handlers.entries()];
  for (const [id, handler] of snapshot) {
    try {
      await handler();
    } catch (error) {
      console.error(`[recurring-sweep] handler ${id} failed:`, error);
      failed.push(id);
    }
  }
  return { registered: snapshot.length, failed };
}
