import {
  collectContentForAllTenants,
  type ContentStepRunSummary,
} from "../lib/content-metrics/collect";

let running = false;

export type ContentCollectionPassResult =
  | { ran: true; steps: ContentStepRunSummary[] }
  | { ran: false; reason: "already_running" };

export async function runContentMetricsCollectionOnce(): Promise<ContentCollectionPassResult> {
  if (running) return { ran: false, reason: "already_running" };
  running = true;
  try {
    return { ran: true, steps: await collectContentForAllTenants() };
  } finally {
    running = false;
  }
}
