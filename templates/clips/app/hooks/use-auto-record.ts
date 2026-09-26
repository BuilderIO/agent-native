import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const TWO_MIN_MS = 2 * 60 * 1000;
const POLL_MS = 10_000;

export interface AutoRecordState {
  inWindow: boolean;
  msToScheduled: number;
  reason:
    | "before"
    | "in-window"
    | "after-grace"
    | "already-started"
    | "no-time";
}

interface AutoRecordInput {
  scheduledStart?: string | null;
  actualStart?: string | null;
  enabled?: boolean;
}

export function useAutoRecord({
  scheduledStart,
  actualStart,
  enabled = true,
}: AutoRecordInput): AutoRecordState {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setNow(Date.now()), POLL_MS);
    return () => clearInterval(id);
  }, [enabled]);

  return useMemo<AutoRecordState>(() => {
    if (!scheduledStart) {
      return { inWindow: false, msToScheduled: 0, reason: "no-time" };
    }
    if (actualStart) {
      return {
        inWindow: false,
        msToScheduled: 0,
        reason: "already-started",
      };
    }
    const scheduledMs = Date.parse(scheduledStart);
    if (Number.isNaN(scheduledMs)) {
      return { inWindow: false, msToScheduled: 0, reason: "no-time" };
    }
    const diff = scheduledMs - now;
    if (diff > TWO_MIN_MS) {
      return { inWindow: false, msToScheduled: diff, reason: "before" };
    }
    if (diff < -TWO_MIN_MS) {
      return { inWindow: false, msToScheduled: diff, reason: "after-grace" };
    }
    return { inWindow: true, msToScheduled: diff, reason: "in-window" };
  }, [scheduledStart, actualStart, now, enabled]);
}

export function useAutoFireCountdown({
  armed,
  durationMs = 30_000,
  onFire,
}: {
  armed: boolean;
  durationMs?: number;
  onFire: () => void;
}) {
  const [remaining, setRemaining] = useState(durationMs);
  const [cancelled, setCancelled] = useState(false);
  const cancelledRef = useRef(false);
  const onFireRef = useRef(onFire);
  onFireRef.current = onFire;

  useEffect(() => {
    if (!armed) {
      cancelledRef.current = false;
      setCancelled(false);
      setRemaining(durationMs);
      return;
    }
    const start = Date.now();
    const id = setInterval(() => {
      if (cancelledRef.current) return;
      const elapsed = Date.now() - start;
      const next = Math.max(0, durationMs - elapsed);
      setRemaining(next);
      if (next === 0) {
        clearInterval(id);
        if (!cancelledRef.current) onFireRef.current();
      }
    }, 250);
    return () => clearInterval(id);
  }, [armed, durationMs]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    setCancelled(true);
    setRemaining(durationMs);
  }, [durationMs]);

  return {
    remaining,
    secondsRemaining: Math.ceil(remaining / 1000),
    cancel,
    cancelled,
  };
}
