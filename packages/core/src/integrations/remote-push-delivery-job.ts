import {
  startIntervalJob,
  type IntervalJobHandle,
} from "../server/interval-job.js";
import { deliverPendingRemotePushNotifications } from "./remote-push-delivery.js";

const DELIVERY_INTERVAL_MS = 60_000;

let job: IntervalJobHandle | null = null;
let startupTimer: ReturnType<typeof setTimeout> | null = null;

export async function runRemotePushDelivery(): Promise<void> {
  try {
    await deliverPendingRemotePushNotifications();
  } catch (error) {
    console.error("[integrations] Remote push delivery failed", {
      error: error instanceof Error ? error.name : "UnknownError",
    });
  }
}

export function startRemotePushDeliveryJob(): void {
  if (job || startupTimer) return;
  startupTimer = setTimeout(() => {
    startupTimer = null;
    job = startIntervalJob(runRemotePushDelivery, {
      intervalMs: DELIVERY_INTERVAL_MS,
    });
  }, 10_000);
  startupTimer.unref?.();
}

export function stopRemotePushDeliveryJob(): void {
  if (startupTimer) {
    clearTimeout(startupTimer);
    startupTimer = null;
  }
  job?.stop();
  job = null;
}
