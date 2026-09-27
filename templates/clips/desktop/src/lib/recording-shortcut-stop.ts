import { emit, listen } from "@tauri-apps/api/event";

const STOP_FALLBACK_TIMEOUT_MS = 250;
const ACK_LISTENER_READY_TIMEOUT_MS = 150;
const pendingStops = new Map<string, (handled: boolean) => void>();
let acknowledgementListenerCount = 0;
let acknowledgementListenerReady = false;
let acknowledgementListenerSetup: Promise<boolean> | undefined;

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
  const listener = listen<string>("clips:tray-stop-ack", (event) => {
    pendingStops.get(event.payload)?.(true);
  });
  const setup = listener.then(
    () => true,
    () => false,
  );
  acknowledgementListenerSetup = setup;
  let unlisten: () => void;
  try {
    unlisten = await listener;
  } catch (error) {
    if (acknowledgementListenerSetup === setup) {
      acknowledgementListenerSetup = undefined;
    }
    throw error;
  }
  acknowledgementListenerCount += 1;
  acknowledgementListenerReady = acknowledgementListenerCount > 0;
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    acknowledgementListenerCount -= 1;
    acknowledgementListenerReady = acknowledgementListenerCount > 0;
    if (
      !acknowledgementListenerReady &&
      acknowledgementListenerSetup === setup
    ) {
      acknowledgementListenerSetup = undefined;
    }
    unlisten();
    if (!acknowledgementListenerReady) {
      for (const finish of pendingStops.values()) finish(false);
    }
  };
}

export async function requestRecordingShortcutStop(): Promise<StopOutcome> {
  if (!acknowledgementListenerReady) {
    if (!acknowledgementListenerSetup) return stopDirectly();
    let readinessTimeout: ReturnType<typeof setTimeout> | undefined;
    const listenerReady = await Promise.race([
      acknowledgementListenerSetup,
      new Promise<boolean>(
        (resolve) =>
          (readinessTimeout = setTimeout(
            () => resolve(false),
            ACK_LISTENER_READY_TIMEOUT_MS,
          )),
      ),
    ]);
    if (readinessTimeout) clearTimeout(readinessTimeout);
    if (!listenerReady || !acknowledgementListenerReady) return stopDirectly();
  }

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
