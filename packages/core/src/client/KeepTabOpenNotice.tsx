import { IconInfoCircle } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

import { useRunStuckDetection } from "./use-run-stuck-detection.js";
import { cn } from "./utils.js";

/** Continuous foreground running time before the notice appears — just
 *  before the hosted ~40s soft-timeout chunk boundary. */
export const DEFAULT_KEEP_TAB_OPEN_AFTER_MS = 30_000;

/**
 * Subtle, non-blocking notice that a long-running FOREGROUND agent turn
 * depends on this tab staying open.
 *
 * On hosted deployments a foreground turn runs in ~40s chunks and the CLIENT
 * re-POSTs `auto_continue` to start each next chunk — close the tab
 * mid-turn and the work silently stops at the next chunk boundary. Only
 * server-driven runs (`dispatchMode` starting with "background": the durable
 * background worker, or a server self-chained continuation) survive a closed
 * tab, and for those this notice never shows.
 *
 * Visibility rules (show only while the condition is true — no new
 * always-visible chrome):
 *   - a foreground-dispatched run for this thread has been continuously
 *     running for `showAfterMs` (default 30s — approaching the hosted ~40s
 *     chunk boundary where the client-driven continuation starts), and
 *   - the run is NOT background-dispatched (hidden immediately when the
 *     server owns recovery), and
 *   - this is a production client bundle (`hosted` auto-detect): local dev
 *     runs a turn unbounded in a single chunk that survives a closed tab,
 *     so the notice would be wrong there.
 * Brief non-running blips (the sub-second gap between continuation chunks)
 * are debounced so the notice does not flicker across chunk boundaries.
 */
export interface KeepTabOpenNoticeProps {
  /** The thread to monitor. Pass null/undefined to disable. */
  threadId: string | null | undefined;
  /**
   * Set false to skip polling entirely — used when this notice is mounted
   * for a background tab kept alive via display:none. Only the active tab
   * should poll `/runs/active`. Defaults to true.
   */
  enabled?: boolean;
  /** API base path. Default `/_agent-native/agent-chat`. */
  apiUrl?: string;
  /**
   * How long a foreground run must have been continuously running before
   * the notice appears. Default 30s — just before the hosted ~40s
   * soft-timeout chunk boundary, so short turns never see it.
   */
  showAfterMs?: number;
  /**
   * Whether this client is talking to a hosted (serverless) deployment
   * whose foreground turns run in client-driven chunks. Defaults to
   * auto-detection from the bundle mode (a dev bundle → not hosted).
   */
  hosted?: boolean;
  /** Extra class on the outer container. */
  className?: string;
}

/** How long the notice lingers through a non-running poll result before
 *  hiding — covers the brief idle gap between continuation chunks. */
const IDLE_LINGER_MS = 12_000;

/** Poll interval for the notice's `/runs/active` loop. Deliberately slower
 *  than the stuck-detector's default — the notice is passive, so freshness
 *  matters less than keeping the extra polling cheap. */
const NOTICE_POLL_INTERVAL_MS = 8_000;

function isDevClientBundle(): boolean {
  try {
    return (
      (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV === true
    );
  } catch {
    return false;
  }
}

export function KeepTabOpenNotice({
  threadId,
  enabled = true,
  apiUrl,
  showAfterMs = DEFAULT_KEEP_TAB_OPEN_AFTER_MS,
  hosted,
  className,
}: KeepTabOpenNoticeProps) {
  const effectiveHosted = hosted ?? !isDevClientBundle();
  const state = useRunStuckDetection({
    threadId,
    enabled: enabled && effectiveHosted,
    apiUrl,
    pollIntervalMs: NOTICE_POLL_INTERVAL_MS,
  });
  const isBackgroundDispatch =
    state.dispatchMode?.startsWith("background") === true;
  const foregroundRunning =
    state.status === "running" && Boolean(state.runId) && !isBackgroundDispatch;

  const [visible, setVisible] = useState(false);
  const runningSinceRef = useRef<number | null>(null);

  // Reset tracking whenever the monitored thread changes so a long run on
  // the previous thread cannot leak the notice onto the new one.
  useEffect(() => {
    runningSinceRef.current = null;
    setVisible(false);
  }, [threadId]);

  useEffect(() => {
    if (!effectiveHosted || isBackgroundDispatch) {
      // Server-owned turn (or non-hosted client): the tab is not load-bearing.
      // Hide immediately and reset — no linger.
      runningSinceRef.current = null;
      setVisible(false);
      return;
    }
    if (foregroundRunning) {
      if (runningSinceRef.current == null) {
        runningSinceRef.current = Date.now();
      }
      const elapsed = Date.now() - runningSinceRef.current;
      if (elapsed >= showAfterMs) {
        setVisible(true);
        return;
      }
      const timer = setTimeout(() => setVisible(true), showAfterMs - elapsed);
      return () => clearTimeout(timer);
    }
    if (!visible) {
      runningSinceRef.current = null;
      return;
    }
    // The run left "running" while the notice is up. Linger briefly — the
    // gap between continuation chunks is sub-second, and hiding/re-showing
    // across every boundary would flicker — then reset.
    const timer = setTimeout(() => {
      runningSinceRef.current = null;
      setVisible(false);
    }, IDLE_LINGER_MS);
    return () => clearTimeout(timer);
  }, [
    effectiveHosted,
    foregroundRunning,
    isBackgroundDispatch,
    showAfterMs,
    visible,
  ]);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "mx-3 mt-2 flex items-start gap-2 rounded-md border border-border/70 bg-muted/40 px-3 py-2 text-xs text-muted-foreground",
        className,
      )}
    >
      <IconInfoCircle
        size={14}
        className="mt-0.5 shrink-0 opacity-70"
        aria-hidden="true"
      />
      <span className="min-w-0 leading-snug">
        <span className="font-medium text-foreground/80">
          Keep this tab open.
        </span>{" "}
        This task continues from your browser — closing or leaving this tab will
        pause it until you come back.
      </span>
    </div>
  );
}
