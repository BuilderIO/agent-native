import { deliverPendingRemotePushNotifications } from "./remote-push-delivery.js";

const DELIVERY_INTERVAL_MS = 60_000;

let retryInterval: ReturnType<typeof setInterval> | null = null;
let initialTimer: ReturnType<typeof setTimeout> | null = null;
let running = false;

export async function runRemotePushDelivery(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await deliverPendingRemotePushNotifications();
  } catch (error) {
    console.error("[integrations] Remote push delivery failed", {
      error: error instanceof Error ? error.name : "UnknownError",
    });
  } finally {
    running = false;
  }
}

export function startRemotePushDeliveryJob(): void {
  if (retryInterval) return;
  initialTimer = setTimeout(() => void runRemotePushDelivery(), 10_000);
  unrefTimer(initialTimer);
  retryInterval = setInterval(
    () => void runRemotePushDelivery(),
    DELIVERY_INTERVAL_MS,
  );
  unrefTimer(retryInterval);
}

export function stopRemotePushDeliveryJob(): void {
  if (initialTimer) {
    clearTimeout(initialTimer);
    initialTimer = null;
  }
  if (retryInterval) {
    clearInterval(retryInterval);
    retryInterval = null;
  }
  running = false;
}

function unrefTimer(timer: ReturnType<typeof setInterval>): void {
  (timer as unknown as { unref?: () => void }).unref?.();
}
