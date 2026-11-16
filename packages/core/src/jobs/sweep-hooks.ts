import { dbConnectGateRemainingMs, dbRecentTimeoutMs } from "../db/client.js";

export const RECURRING_SWEEP_BUDGET_MS = 90_000;
/**
 * How long a query timeout stands background work down for.
 *
 * 30s was too short to matter: measured on 11/5 evening, the guard fired (21
 * stand-down lines in seven minutes) but every retry 30s later still paid one
 * timeout query, so the logged count did not fall. Recovery work tolerates a
 * two-minute pause; retrying a slow database every half minute does not help it.
 */
export const DB_TIMEOUT_STANDDOWN_MS = 120_000;

export interface RecurringSweepContext {
  deadlineAt: number;
  signal?: AbortSignal;
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
): Promise<{ registered: number; failed: string[]; skipped?: string }> {
  const snapshot = [...handlers.entries()];
  // A database that just refused a connect is in cooldown; running every handler
  // against it only multiplies the refusal (11/5: 582 "Too many connections" in
  // eight minutes, much of it sweeps). The next tick picks the work up.
  const gateMs = dbConnectGateRemainingMs();
  // A query that just timed out is the same signal as a refused connect: the database
  // is not keeping up, and every handler started now only adds to that.
  if (snapshot.length && dbRecentTimeoutMs() < DB_TIMEOUT_STANDDOWN_MS) {
    console.warn(
      `[recurring-sweep] standing down ${snapshot.length} handler(s): the database timed out a query ${Math.round(dbRecentTimeoutMs())}ms ago`,
    );
    return { registered: snapshot.length, failed: [], skipped: "db-timeout" };
  }
  if (gateMs > 0 && snapshot.length) {
    console.warn(
      `[recurring-sweep] standing down ${snapshot.length} handler(s) for ${gateMs}ms: the database is in connect cooldown`,
    );
    return {
      registered: snapshot.length,
      failed: [],
      skipped: "db-connect-cooldown",
    };
  }
  const controller = new AbortController();
  const sweepContext = { ...context, signal: controller.signal };
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<false>((resolve) => {
    timeoutId = setTimeout(
      () => {
        controller.abort();
        resolve(false);
      },
      Math.max(0, context.deadlineAt - Date.now()),
    );
  });
  const outcomes = await Promise.allSettled(
    snapshot.map(async ([id, handler]) => {
      if (Date.now() >= context.deadlineAt) {
        throw new Error(
          "Recurring sweep deadline elapsed before handler start.",
        );
      }
      const completed = await Promise.race([
        Promise.resolve()
          .then(() => handler(sweepContext))
          .then(() => true),
        deadline,
      ]);
      if (!completed || Date.now() >= context.deadlineAt) {
        throw new Error("Recurring sweep handler exceeded its deadline.");
      }
      return id;
    }),
  );
  if (timeoutId) clearTimeout(timeoutId);
  const failed = outcomes.flatMap((outcome, index) => {
    if (outcome.status === "fulfilled") return [];
    const id = snapshot[index]![0];
    console.error(`[recurring-sweep] handler ${id} failed:`, outcome.reason);
    return [id];
  });
  return { registered: snapshot.length, failed };
}
