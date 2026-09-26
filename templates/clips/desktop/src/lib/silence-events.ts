
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

export function isDesktop(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(
    (window as unknown as { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__,
  );
}
