import { IconInfoCircle } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

import { useRunStuckDetection } from "./use-run-stuck-detection.js";
import { cn } from "./utils.js";

export const DEFAULT_KEEP_TAB_OPEN_AFTER_MS = 30_000;

export interface KeepTabOpenNoticeProps {
  threadId: string | null | undefined;
  enabled?: boolean;
  apiUrl?: string;
  showAfterMs?: number;
  hosted?: boolean;
  className?: string;
}

const IDLE_LINGER_MS = 12_000;

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

function isServerContinuedDispatch(dispatchMode: string | null): boolean {
  return (
    dispatchMode === "foreground-self-chain" ||
    dispatchMode?.startsWith("background") === true
  );
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
  const isServerContinued = isServerContinuedDispatch(state.dispatchMode);
  const foregroundRunning =
    state.status === "running" && Boolean(state.runId) && !isServerContinued;

  const [visible, setVisible] = useState(false);
  const runningSinceRef = useRef<number | null>(null);

  useEffect(() => {
    runningSinceRef.current = null;
    setVisible(false);
  }, [threadId]);

  useEffect(() => {
    if (!effectiveHosted || isServerContinued) {
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
    const timer = setTimeout(() => {
      runningSinceRef.current = null;
      setVisible(false);
    }, IDLE_LINGER_MS);
    return () => clearTimeout(timer);
  }, [
    effectiveHosted,
    foregroundRunning,
    isServerContinued,
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
