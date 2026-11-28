import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";

type PauseRequest = "pause" | "resume" | "toggle";

const PAUSE_EVENTS: Record<PauseRequest, string> = {
  pause: "clips:recorder-pause",
  resume: "clips:recorder-resume",
  toggle: "clips:recorder-toggle-pause",
};

/**
 * Takes a waiting `clips://pause` for the running recording from native,
 * once, and delivers it to the recorder's pause listeners.
 */
async function deliverPendingPauseLink(): Promise<void> {
  const request = await invoke<PauseRequest | null>("take_pending_pause_link");
  if (!request) return;
  await emit(PAUSE_EVENTS[request]);
}

function deliverLogged() {
  void deliverPendingPauseLink().catch((error: unknown) => {
    console.error("[clips-recorder] pause link failed:", error);
  });
}

/**
 * `clips://pause` waits natively until a recorder takes it. Put this next
 * to a recorder's pause listeners, and call `takePauseLinkOnInstall` once
 * they are installed, so a link sent while they were being set up still
 * applies.
 */
export function listenForPauseLinks() {
  return listen("clips:pause-link", deliverLogged);
}

export function takePauseLinkOnInstall() {
  deliverLogged();
}
