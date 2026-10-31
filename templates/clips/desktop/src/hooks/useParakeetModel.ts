import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";

export type ParakeetModelState =
  | "missing"
  | "downloading"
  | "downloaded"
  | "loading"
  | "ready"
  | "unsupported";

export interface ParakeetModelStatus {
  state: ParakeetModelState;
  downloadedMb: number;
  totalMb: number;
  error?: string;
}

const PARAKEET_STATUS_EVENTS = [
  "parakeet:model-progress",
  "parakeet:model-ready",
  "parakeet:model-error",
  "parakeet:model-cancelled",
] as const;

export function prepareParakeetModel(): void {
  invoke("parakeet_model_prepare").catch((err) => {
    console.error("[parakeet] prepare failed to start:", err);
  });
}

/**
 * Downloads, loads and warms Parakeet while it is the chosen engine, and
 * unloads it when another engine is chosen. A prepare that a release cancelled
 * mid-download is restarted if Parakeet was chosen again meanwhile.
 */
export function useParakeetPreparation(active: boolean): void {
  useEffect(() => {
    if (!active) {
      invoke("parakeet_model_release").catch((err) => {
        console.error("[parakeet] release failed:", err);
      });
      return;
    }
    prepareParakeetModel();
    const unlisten = listen("parakeet:model-cancelled", () =>
      prepareParakeetModel(),
    );
    return () => {
      void unlisten.then((fn) => fn()).catch(() => {});
    };
  }, [active]);
}

/** Parakeet's download and load state, for Settings. */
export function useParakeetModel(): {
  status: ParakeetModelStatus | null;
  statusError: string | null;
} {
  const [status, setStatus] = useState<ParakeetModelStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    invoke<ParakeetModelStatus>("parakeet_model_status")
      .then((next) => {
        setStatus(next);
        setStatusError(null);
      })
      .catch((err) => {
        console.error("[parakeet] status check failed:", err);
        setStatusError(String(err));
      });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const unlistens: Array<() => void> = [];
    refresh();
    for (const event of PARAKEET_STATUS_EVENTS) {
      listen(event, () => refresh())
        .then((unlisten) => {
          if (cancelled) unlisten();
          else unlistens.push(unlisten);
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
      unlistens.forEach((unlisten) => unlisten());
    };
  }, [refresh]);

  return { status, statusError };
}
