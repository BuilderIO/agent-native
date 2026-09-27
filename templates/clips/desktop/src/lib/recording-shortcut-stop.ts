import { emit, listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

const STOP_ACK_TIMEOUT_MS = 250;

export async function requestRecordingShortcutStop() {
  const toolbar = await WebviewWindow.getByLabel("toolbar");
  if (!toolbar) return emit("clips:recorder-stop");

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

  if (!(await pillHandledRequest)) return emit("clips:recorder-stop");
}
