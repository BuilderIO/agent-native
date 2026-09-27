import { emit, listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

const STOP_ACK_TIMEOUT_MS = 250;

type StopOutcome =
  | { type: "pill" }
  | {
      type: "direct";
      reason:
        | "toolbar-absent"
        | "toolbar-lookup-failed"
        | "pill-did-not-acknowledge";
      error?: unknown;
    };

async function stopDirectly(
  reason: Extract<StopOutcome, { type: "direct" }>["reason"],
  error?: unknown,
): Promise<StopOutcome> {
  await emit("clips:recorder-stop");
  return error === undefined
    ? { type: "direct", reason }
    : { type: "direct", reason, error };
}

export async function requestRecordingShortcutStop(): Promise<StopOutcome> {
  let toolbar;
  try {
    toolbar = await WebviewWindow.getByLabel("toolbar");
  } catch (error) {
    return stopDirectly("toolbar-lookup-failed", error);
  }
  if (!toolbar) return stopDirectly("toolbar-absent");

  const requestId = crypto.randomUUID();
  const pillHandledRequest = new Promise<boolean>((resolve) => {
    let settled = false;
    let unlisten: (() => void) | undefined;
    const timeout = setTimeout(() => finish(false), STOP_ACK_TIMEOUT_MS);
    const finish = (handled: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      unlisten?.();
      resolve(handled);
    };

    void listen<string>("clips:tray-stop-ack", (event) => {
      if (event.payload === requestId) finish(true);
    })
      .then((stopListening) => {
        unlisten = stopListening;
        if (settled) {
          stopListening();
          return;
        }
        void emit("clips:tray-stop-request", { requestId }).catch(() =>
          finish(false),
        );
      })
      .catch(() => finish(false));
  });

  if (!(await pillHandledRequest)) {
    return stopDirectly("pill-did-not-acknowledge");
  }
  return { type: "pill" };
}
