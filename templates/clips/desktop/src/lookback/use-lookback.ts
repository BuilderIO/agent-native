import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";

import { isLabEnabled, CLIPS_LOOKBACK_CONTEXT } from "../../../shared/labs";
import {
  callClipsActionFor,
  type ClipsActionTarget,
} from "../lib/clips-action";
import { loadDesktopAuthToken } from "../lib/desktop-auth-token";
import { loadStoredServerUrl } from "../lib/url";
import { listRecordingContext, type RecordingContextItem } from "./context-api";
import { isLookbackSaving } from "./lookback-card";

const POLL_INTERVAL_MS = 2_000;

export function currentLookbackTarget(): ClipsActionTarget {
  const serverUrl = loadStoredServerUrl();
  return { serverUrl, authToken: loadDesktopAuthToken(serverUrl) };
}

// The popover publishes lab state with "clips:labs-updated"; this window reads
// it once on mount and then follows the broadcast, as the meeting overlay does.
export function useLookbackLabEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    const apply = (values: unknown) => {
      if (cancelled || !values || typeof values !== "object") return;
      if (Array.isArray(values)) return;
      setEnabled(
        isLabEnabled(values as Record<string, unknown>, CLIPS_LOOKBACK_CONTEXT),
      );
    };

    listen<{ values?: Record<string, unknown> }>(
      "clips:labs-updated",
      (event) => apply(event.payload?.values),
    )
      .then((cleanup) => {
        if (cancelled) cleanup();
        else unlisten = cleanup;
      })
      .catch((error) => {
        console.warn("[record-pill] labs listener failed:", error);
      });

    callClipsActionFor<Record<string, unknown>>(
      currentLookbackTarget(),
      "get-lab-states",
      {},
      { method: "GET" },
    )
      .then(apply)
      .catch((error) => {
        console.warn("[record-pill] lab read failed:", error);
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return enabled;
}

export interface RecordingContextView {
  status: "idle" | "loading" | "loaded" | "error";
  item: RecordingContextItem | null;
}

// Reads the recording's earlier-screen-time item and keeps polling while it is
// saving. A failed read is reported as status "error" and retried, never as
// "no item".
export function useRecordingContext(
  recordingId: string | null,
  enabled: boolean,
): {
  view: RecordingContextView;
  setItem: (item: RecordingContextItem) => void;
} {
  const [view, setView] = useState<RecordingContextView>({
    status: "idle",
    item: null,
  });
  const saving = isLookbackSaving(view.item);

  useEffect(() => {
    if (!recordingId || !enabled) {
      setView({ status: "idle", item: null });
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Keep the previous item only for the same recording, so a new card never
    // flashes the last clip's line.
    setView((previous) =>
      previous.item?.recordingId === recordingId
        ? previous
        : { status: "loading", item: null },
    );

    const read = async () => {
      try {
        const items = await listRecordingContext(
          currentLookbackTarget(),
          recordingId,
        );
        if (cancelled) return;
        const item = items[0] ?? null;
        setView({ status: "loaded", item });
        if (isLookbackSaving(item)) {
          timer = setTimeout(() => void read(), POLL_INTERVAL_MS);
        }
      } catch (error) {
        if (cancelled) return;
        console.warn("[record-pill] earlier screen time read failed:", error);
        setView({ status: "error", item: null });
        timer = setTimeout(() => void read(), POLL_INTERVAL_MS);
      }
    };
    void read();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [recordingId, enabled, saving]);

  return {
    view,
    setItem: (item) => setView({ status: "loaded", item }),
  };
}
