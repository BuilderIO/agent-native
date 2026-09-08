/**
 * Renderer-side bridge for the Granola-style auto-stop heuristics.
 *
 * The Tauri backend (`silence_detector.rs`) emits three events:
 *
 *  - `meetings:silence-stop` — both mic + system audio have been silent for N
 *    minutes (default 15).
 *  - `meetings:sleep-stop`   — the machine slept (clock-jump heuristic).
 *  - `meetings:call-ended`   — every watched conferencing app released the
 *    microphone (CoreAudio per-process input, or macOS Control Center mic
 *    attribution) and stayed released for 15s, or the scheduled meeting end
 *    was reached with quiet audio.
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
  callAppBundleIds?: string[];
  scheduledEndMs?: number | null;
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
  const unlistenAll = () => {
    for (const u of unlisteners) {
      try {
        u();
      } catch {
        // best-effort
      }
    }
  };
  try {
    unlisteners.push(
      await listen("meetings:silence-stop", () => onStop("silence")),
    );
    unlisteners.push(
      await listen("meetings:sleep-stop", () => onStop("sleep")),
    );
    unlisteners.push(
      await listen("meetings:call-ended", () => onStop("call-ended")),
    );
    return unlistenAll;
  } catch (error) {
    unlistenAll();
    throw error;
  }
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
