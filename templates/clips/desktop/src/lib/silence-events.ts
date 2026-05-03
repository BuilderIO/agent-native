/**
 * Renderer-side bridge for the Granola-style auto-stop heuristics.
 *
 * The Tauri backend (`silence_detector.rs`) emits three events:
 *
 *  - `meetings:silence-stop` — both mic + system audio have been silent for N
 *    minutes (default 15).
 *  - `meetings:sleep-stop`   — the machine slept (clock-jump heuristic).
 *  - `meetings:call-ended`   — the foreground video-conferencing app
 *    backgrounded for >2 minutes.
 *
 * Renderer wires `startSilenceDetector` when a meeting becomes live and
 * `stopSilenceDetector` when it ends. `subscribeAutoStop` returns an
 * unsubscribe function that the React hook can call from a useEffect cleanup.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type AutoStopReason = "silence" | "sleep" | "call-ended";

export interface SilenceConfig {
  silenceThreshold?: number;
  silenceMs?: number;
  callEndedMs?: number;
  watchSleep?: boolean;
  watchCallEnded?: boolean;
}

export async function startSilenceDetector(
  config?: SilenceConfig,
): Promise<void> {
  await invoke("silence_detector_start", { config: config ?? null });
}

export async function stopSilenceDetector(): Promise<void> {
  await invoke("silence_detector_stop");
}

/**
 * Subscribe to all three auto-stop events. The returned function unlistens
 * every channel — call it from a useEffect cleanup.
 */
export async function subscribeAutoStop(
  onStop: (reason: AutoStopReason) => void,
): Promise<UnlistenFn> {
  const unlisteners: UnlistenFn[] = [];
  unlisteners.push(
    await listen("meetings:silence-stop", () => onStop("silence")),
  );
  unlisteners.push(await listen("meetings:sleep-stop", () => onStop("sleep")));
  unlisteners.push(
    await listen("meetings:call-ended", () => onStop("call-ended")),
  );
  return () => {
    for (const u of unlisteners) {
      try {
        u();
      } catch {
        // best-effort
      }
    }
  };
}

/**
 * Convenience: returns true when the renderer is running inside the Tauri
 * desktop shell (so the silence-detector bridge is available). The web build
 * has no Tauri runtime — we no-op gracefully there.
 */
export function isDesktop(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(
    (window as unknown as { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__,
  );
}
