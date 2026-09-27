import { emit, listen } from "@tauri-apps/api/event";

const STOP_FALLBACK_TIMEOUT_MS = 250;
const pendingStops = new Map<string, (handled: boolean) => void>();
let acknowledgementListenerCount = 0;
let acknowledgementListenerReady = false;

type StopOutcome =
  | { type: "pill" }
  | {
      type: "direct";
      reason: "pill-did-not-acknowledge";
    };

async function stopDirectly(): Promise<StopOutcome> {
  await emit("clips:recorder-stop");
  return { type: "direct", reason: "pill-did-not-acknowledge" };
}

export async function listenForRecordingShortcutStopAcks() {
  const unlisten = await listen<string>("clips:tray-stop-ack", (event) => {
    pendingStops.get(event.payload)?.(true);
  });
  acknowledgementListenerCount += 1;
  acknowledgementListenerReady = acknowledgementListenerCount > 0;
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    acknowledgementListenerCount -= 1;
    acknowledgementListenerReady = acknowledgementListenerCount > 0;
    unlisten();
    if (!acknowledgementListenerReady) {
      for (const finish of pendingStops.values()) finish(false);
    }
  };
}

export async function requestRecordingShortcutStop(): Promise<StopOutcome> {
  if (!acknowledgementListenerReady) return stopDirectly();

  const requestId = crypto.randomUUID();
  const pillHandledRequest = new Promise<boolean>((resolve) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const finish = (handled: boolean) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      pendingStops.delete(requestId);
      resolve(handled);
    };

    timeout = setTimeout(() => finish(false), STOP_FALLBACK_TIMEOUT_MS);
    pendingStops.set(requestId, finish);
    void emit("clips:tray-stop-request", { requestId }).catch((error) => {
      console.error("[clips-tray] stop request event failed:", error);
      finish(false);
    });
  });

  if (!(await pillHandledRequest)) {
    return stopDirectly();
  }
  return { type: "pill" };
}
