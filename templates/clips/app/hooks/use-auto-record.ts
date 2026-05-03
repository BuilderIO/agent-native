/**
 * Granola-style auto-start/auto-stop heuristics for the meeting detail page.
 *
 * Auto-start: when the user is sitting on `/meetings/<id>` and the meeting's
 * `scheduledStart` is within ±2 minutes of `Date.now()` AND the meeting hasn't
 * yet started (`!actualStart`), the UI should prompt the user to start the
 * recording. After 30s of no input, it auto-fires `start-meeting-recording`.
 *
 * The hook does NOT call any actions itself — it's a state machine. The
 * consumer (the auto-record banner component) renders the prompt and runs the
 * action.
 *
 * Auto-stop: a separate concern handled by `silence-events.ts` in the Tauri
 * shell. We re-export a tiny convenience here so the meeting page can wire
 * everything from a single import.
 */

import { useEffect, useMemo, useRef, useState } from "react";

const TWO_MIN_MS = 2 * 60 * 1000;
const POLL_MS = 10_000;

export interface AutoRecordState {
  /** True when we're inside the ±2-min window AND not yet recording. */
  inWindow: boolean;
  /** Wall-clock ms remaining until scheduledStart (negative when past). */
  msToScheduled: number;
  /** Human-readable reason, useful for tracing. */
  reason: "before" | "in-window" | "after-grace" | "already-started" | "no-time";
}

interface AutoRecordInput {
  scheduledStart?: string | null;
  actualStart?: string | null;
  /** When false, the hook short-circuits — used for paused / offline states. */
  enabled?: boolean;
}

/**
 * Polls every 10s. Returns derived state describing the auto-start window.
 *
 * The window opens 2 minutes BEFORE scheduledStart and closes 2 minutes AFTER
 * — this matches Granola's "starts at calendar time if you're viewing the
 * event" behaviour while leaving slack for the user who joined slightly late.
 */
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

/**
 * 30-second auto-fire countdown with last-5s cancel grace.
 *
 * The banner mounts this. When `armed` flips true the countdown begins; on
 * elapsed it calls `onFire`. Calling `cancel()` aborts. A `setManualHold`
 * callback lets the host pause the countdown while the user is interacting
 * (e.g. typing into the title field) — Granola never auto-fires while the
 * note is being edited.
 */
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
  const cancelledRef = useRef(false);
  const onFireRef = useRef(onFire);
  onFireRef.current = onFire;

  useEffect(() => {
    if (!armed) {
      cancelledRef.current = false;
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

  const cancel = () => {
    cancelledRef.current = true;
    setRemaining(durationMs);
  };

  return {
    remaining,
    secondsRemaining: Math.ceil(remaining / 1000),
    cancel,
    cancelled: cancelledRef.current,
  };
}
