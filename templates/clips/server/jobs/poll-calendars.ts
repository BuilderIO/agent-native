
import { startIntervalJob } from "@agent-native/core/server/interval-job";
import { runWithRequestContext } from "@agent-native/core/server/request-context";

import syncCalendars from "../../actions/sync-calendars.js";

const POLL_INTERVAL_MS = 5 * 60 * 1000;
let skippingLogged = false;

export async function runPollCalendarsOnce(): Promise<void> {
  await runWithRequestContext({}, async () => {
    const result = await syncCalendars.run(
      { allAccounts: true } as any,
      {} as any,
    );
    if (result?.synced) {
      console.log(
        `[poll-calendars] synced ${result.synced} accounts, ${result.events ?? 0} events, ${result.meetings ?? 0} meetings`,
      );
    }
  });
}

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
  startIntervalJob(() => runPollCalendarsOnce(), {
    intervalMs: POLL_INTERVAL_MS,
    leading: false,
    onError: (err: any) =>
      console.error("[poll-calendars] sync failed:", err?.message ?? err),
  });
  console.log(
    `[poll-calendars] Recurring calendar sync every ${POLL_INTERVAL_MS / 1000}s.`,
  );
}
