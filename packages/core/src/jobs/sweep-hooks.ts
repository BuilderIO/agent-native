export const RECURRING_SWEEP_BUDGET_MS = 90_000;

export interface RecurringSweepContext {
  deadlineAt: number;
}

export type RecurringSweepHandler = (
  context: RecurringSweepContext,
) => Promise<void>;

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

export async function runRecurringSweepHandlers(
  context: RecurringSweepContext,
): Promise<{ registered: number; failed: string[] }> {
  const snapshot = [...handlers.entries()];
  const outcomes = await Promise.allSettled(
    snapshot.map(async ([id, handler]) => {
      if (Date.now() >= context.deadlineAt) {
        throw new Error(
          "Recurring sweep deadline elapsed before handler start.",
        );
      }
      await handler(context);
      if (Date.now() > context.deadlineAt) {
        throw new Error("Recurring sweep handler exceeded its deadline.");
      }
      return id;
    }),
  );
  const failed = outcomes.flatMap((outcome, index) => {
    if (outcome.status === "fulfilled") return [];
    const id = snapshot[index]![0];
    console.error(`[recurring-sweep] handler ${id} failed:`, outcome.reason);
    return [id];
  });
  return { registered: snapshot.length, failed };
}
