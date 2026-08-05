/**
 * poll-calendars — recurring job (every 5 min).
 *
 * Sweeps every connected calendar_accounts row and refreshes its events.
 * Runs as a Nitro plugin via `setInterval` (matches the mail-jobs pattern
 * — works on every host that keeps a long-lived process; on serverless
 * the deployment plugin should call `runPollCalendarsOnce` from a
 * scheduled function instead).
 *
 * Token refresh + per-account error capture happens inside the
 * `sync-calendars` action; this job is just a thin scheduler.
 */

import { runWithRequestContext } from "@agent-native/core/server/request-context";

import syncCalendars from "../../actions/sync-calendars.js";

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 min
// sync-calendars calls Google's Calendar API with no fetch-level timeout of
// its own; race it so a hung request can't wedge the `running` guard below
// forever instead of just occasionally overlapping.
const SYNC_ABORT_MS = Math.max(10_000, POLL_INTERVAL_MS * 4);
let skippingLogged = false;
let running = false;

/**
 * Run a single poll pass. Exported so deployment-specific schedulers
 * (e.g. Netlify Scheduled Functions) can invoke it directly without
 * relying on a long-lived process.
 */
export async function runPollCalendarsOnce(): Promise<void> {
  // No request context — this job runs as the system. The sync-calendars
  // action accepts `allAccounts: true` to skip the per-user accessFilter.
  await runWithRequestContext({}, async () => {
    let timedOut = false;
    const syncPromise = Promise.resolve(
      syncCalendars.run({ allAccounts: true } as any, {} as any),
    );
    try {
      const result = await Promise.race([
        syncPromise,
        new Promise<never>((_, reject) => {
          setTimeout(() => {
            timedOut = true;
            reject(
              new Error(`sync-calendars timed out after ${SYNC_ABORT_MS}ms`),
            );
          }, SYNC_ABORT_MS);
        }),
      ]);
      if (result?.synced) {
        console.log(
          `[poll-calendars] synced ${result.synced} accounts, ${result.events ?? 0} events, ${result.meetings ?? 0} meetings`,
        );
      }
    } catch (err: any) {
      console.error(`[poll-calendars] sync failed:`, err?.message ?? err);
      // The abandoned call may still resolve/reject later against a request
      // context this closure already exited — swallow it instead of letting
      // it surface as an unhandled rejection or bleed into the next cycle.
      if (timedOut) syncPromise.catch(() => {});
    }
  });
}

/**
 * Nitro plugin entry — register the recurring poll. Mirrors the dev/prod
 * gating used by `templates/mail/server/plugins/mail-jobs.ts`: opt-out in
 * dev (every connected dev server would otherwise duplicate calls and
 * burn refresh tokens), opt-in via `RUN_BACKGROUND_JOBS=1`.
 */
export default function registerPollCalendarsJob(): void {
  const isProd = process.env.NODE_ENV === "production";
  const flag = process.env.RUN_BACKGROUND_JOBS;
  const enabled = flag === "1" || (isProd && flag !== "0");
  if (!enabled) {
    if (process.env.DEBUG && !skippingLogged) {
      console.log(
        "[poll-calendars] Skipping background poll (set RUN_BACKGROUND_JOBS=1 to enable in dev).",
      );
      skippingLogged = true;
    }
    return;
  }
  setInterval(() => {
    if (running) return;
    running = true;
    runPollCalendarsOnce()
      .catch((err) => console.error("[poll-calendars] interval failed:", err))
      .finally(() => {
        running = false;
      });
  }, POLL_INTERVAL_MS);
  console.log(
    `[poll-calendars] Recurring calendar sync every ${POLL_INTERVAL_MS / 1000}s.`,
  );
}
