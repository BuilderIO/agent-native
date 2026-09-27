import { emit, listen } from "@tauri-apps/api/event";

const STOP_FALLBACK_TIMEOUT_MS = 250;

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

export async function requestRecordingShortcutStop(): Promise<StopOutcome> {
  const requestId = crypto.randomUUID();
  const pillHandledRequest = new Promise<boolean>((resolve) => {
    let settled = false;
    let unlisten: (() => void) | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const finish = (handled: boolean) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      unlisten?.();
      resolve(handled);
    };

    timeout = setTimeout(() => finish(false), STOP_FALLBACK_TIMEOUT_MS);
    void listen<string>("clips:tray-stop-ack", (event) => {
      if (event.payload === requestId) finish(true);
    })
      .then((stopListening) => {
        unlisten = stopListening;
        if (settled) {
          stopListening();
        }
      })
      .catch((error) => {
        console.error(
          "[clips-tray] stop acknowledgement listener failed:",
          error,
        );
        finish(false);
      });
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
