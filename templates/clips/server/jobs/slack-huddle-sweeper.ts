/**
 * slack-huddle-sweeper — recurring job (every 5 min).
 *
 * The Slack events webhook stores a huddle and answers Slack right away; the
 * participant fill (Slack profile lookups) runs after the response. This
 * sweep is its durable retry: it fills again from every huddle stored or
 * updated in the last two hours, which catches a fill that failed or was cut
 * off after the response, people Slack could not describe at the time (rate
 * limits, outages), a stop-time fill that left people pending, and shares
 * that did not go through. Every step is idempotent, and Slack profiles are
 * cached, so a sweep with nothing left to do makes no Slack calls.
 */

import { claimLease } from "../lib/recording-leases.js";
import { slackHuddleDeps } from "../lib/slack-huddle-oauth.js";
import { sweepRecentSlackHuddles } from "../lib/slack-huddles-store.js";

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
// One instance per interval sweeps, like the thumbnail sweeper.
const SWEEP_LEASE_KEY = "slack-huddle-sweeper";
const SWEEP_LEASE_MS = SWEEP_INTERVAL_MS - 30_000;
let skippingLogged = false;
let running = false;

export async function runSlackHuddleSweepOnce(): Promise<void> {
  const result = await sweepRecentSlackHuddles(slackHuddleDeps());
  if (result.filled || result.pending || result.failed) {
    console.log(
      `[slack-huddle-sweeper] ${result.huddles} huddles: ${result.filled} participants added, ${result.pending} lookups pending, ${result.failed} failed.`,
    );
  }
}

export default function registerSlackHuddleSweeperJob(): void {
  const isProd = process.env.NODE_ENV === "production";
  const flag = process.env.RUN_BACKGROUND_JOBS;
  const enabled = flag === "1" || (isProd && flag !== "0");
  if (!enabled) {
    if (process.env.DEBUG && !skippingLogged) {
      console.log(
        "[slack-huddle-sweeper] Skipping background sweep (set RUN_BACKGROUND_JOBS=1 to enable in dev).",
      );
      skippingLogged = true;
    }
    return;
  }
  setInterval(() => {
    if (running) return;
    running = true;
    claimLease(SWEEP_LEASE_KEY, SWEEP_LEASE_MS)
      .then((lease) => (lease ? runSlackHuddleSweepOnce() : undefined))
      .catch((err) =>
        console.error("[slack-huddle-sweeper] interval failed:", err),
      )
      .finally(() => {
        running = false;
      });
  }, SWEEP_INTERVAL_MS);
  console.log(
    `[slack-huddle-sweeper] Recurring huddle participant sweep every ${SWEEP_INTERVAL_MS / 1000}s.`,
  );
}
