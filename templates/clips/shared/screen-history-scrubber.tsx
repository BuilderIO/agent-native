import { useRef, type KeyboardEvent, type PointerEvent } from "react";

import {
  isWindowWithin,
  lookbackLabel,
  SCREEN_HISTORY_MIN_SECONDS,
  type ScreenHistoryWindow,
} from "./screen-history-context";

// Plain React and Tailwind only, so the desktop app can import this by path.
// The words default to English; pass `labels` to localize them. The length
// unit ("5 min") still comes from lookbackLabel.

export interface ScreenHistoryScrubberLabels {
  start: string;
  end: string;
  length: string;
  startHandle: string;
  endHandle: string;
}

export interface ScreenHistoryScrubberProps {
  original: ScreenHistoryWindow; // widest allowed
  value: ScreenHistoryWindow; // current selection
  onChange: (next: ScreenHistoryWindow) => void;
  disabled?: boolean;
  labels?: Partial<ScreenHistoryScrubberLabels>;
  // An instant inside `original`, drawn as a line. Clamped to the track.
  playhead?: string | null;
}

type Edge = "start" | "end";

const DEFAULT_LABELS: ScreenHistoryScrubberLabels = {
  start: "Starts",
  end: "Ends",
  length: "Length",
  startHandle: "Window start",
  endHandle: "Window end",
};

const SECOND_MS = 1000;
const STEP_MS = SECOND_MS;
const SHIFT_STEP_MS = 5 * SECOND_MS;
const MIN_WINDOW_MS = SCREEN_HISTORY_MIN_SECONDS * SECOND_MS;

const KEY_DIRECTION: Record<string, number> = {
  ArrowLeft: -1,
  ArrowDown: -1,
  ArrowRight: 1,
  ArrowUp: 1,
};

// The widest window ends when the recording started, so offsets count back from its end.
export function screenHistoryOffsetSeconds(
  original: ScreenHistoryWindow,
  iso: string,
): number {
  return Math.round(
    (Date.parse(original.endedAt) - Date.parse(iso)) / SECOND_MS,
  );
}

export function formatScreenHistoryOffset(seconds: number): string {
  if (seconds <= 0) return "0:00";
  const minutes = Math.floor(seconds / 60);
  const rest = String(seconds % 60).padStart(2, "0");
  return `−${minutes}:${rest}`;
}

export function screenHistoryPercent(
  original: ScreenHistoryWindow,
  iso: string,
): number {
  const startMs = Date.parse(original.startedAt);
  const totalMs = Date.parse(original.endedAt) - startMs;
  return ((Date.parse(iso) - startMs) / totalMs) * 100;
}

// A playhead can run past either end while a preview is still settling, so it stops at the track edges.
export function screenHistoryPlayheadPercent(
  original: ScreenHistoryWindow,
  iso: string,
): number {
  return clamp(screenHistoryPercent(original, iso), 0, 100);
}

// Pointer targets snap to whole seconds before the recording start so offset labels stay exact.
export function screenHistoryMsAtFraction(
  original: ScreenHistoryWindow,
  fraction: number,
): number {
  const startMs = Date.parse(original.startedAt);
  const endMs = Date.parse(original.endedAt);
  const clamped = Math.min(1, Math.max(0, fraction));
  const rawMs = startMs + clamped * (endMs - startMs);
  return endMs - Math.round((endMs - rawMs) / SECOND_MS) * SECOND_MS;
}

// Moves one edge to `targetMs`, clamped so the window stays inside `original`
// and keeps at least one second. Throws when `value` is already outside `original`.
export function moveScreenHistoryEdge(
  original: ScreenHistoryWindow,
  value: ScreenHistoryWindow,
  edge: Edge,
  targetMs: number,
): ScreenHistoryWindow {
  if (!isWindowWithin(original, value)) {
    throw new Error("Screen history selection must sit inside its window.");
  }
  const originalStartMs = Date.parse(original.startedAt);
  const originalEndMs = Date.parse(original.endedAt);
  const valueStartMs = Date.parse(value.startedAt);
  const valueEndMs = Date.parse(value.endedAt);
  const next: ScreenHistoryWindow =
    edge === "start"
      ? {
          startedAt: new Date(
            clamp(targetMs, originalStartMs, valueEndMs - MIN_WINDOW_MS),
          ).toISOString(),
          endedAt: value.endedAt,
        }
      : {
          startedAt: value.startedAt,
          endedAt: new Date(
            clamp(targetMs, valueStartMs + MIN_WINDOW_MS, originalEndMs),
          ).toISOString(),
        };
  if (!isWindowWithin(original, next)) {
    throw new Error("Screen history selection could not be clamped.");
  }
  return next;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function ScreenHistoryScrubber(props: ScreenHistoryScrubberProps) {
  const { original, value, onChange, disabled = false, playhead } = props;
  const labels = { ...DEFAULT_LABELS, ...props.labels };
  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ edge: Edge; pointerId: number } | null>(null);

  if (!isWindowWithin(original, value)) {
    throw new Error("ScreenHistoryScrubber: value must sit inside original.");
  }

  const originalStartMs = Date.parse(original.startedAt);
  const totalSeconds = Math.round(
    (Date.parse(original.endedAt) - originalStartMs) / SECOND_MS,
  );
  const lengthSeconds = Math.max(
    SCREEN_HISTORY_MIN_SECONDS,
    Math.round(
      (Date.parse(value.endedAt) - Date.parse(value.startedAt)) / SECOND_MS,
    ),
  );
  const startPercent = screenHistoryPercent(original, value.startedAt);
  const endPercent = screenHistoryPercent(original, value.endedAt);
  const playheadPercent = playhead
    ? screenHistoryPlayheadPercent(original, playhead)
    : null;
  const startOffset = formatScreenHistoryOffset(
    screenHistoryOffsetSeconds(original, value.startedAt),
  );
  const endOffset = formatScreenHistoryOffset(
    screenHistoryOffsetSeconds(original, value.endedAt),
  );

  function commit(edge: Edge, targetMs: number) {
    const next = moveScreenHistoryEdge(original, value, edge, targetMs);
    if (next.startedAt !== value.startedAt || next.endedAt !== value.endedAt) {
      onChange(next);
    }
  }

  function onKeyDown(edge: Edge, event: KeyboardEvent<HTMLDivElement>) {
    const direction = KEY_DIRECTION[event.key];
    if (disabled || direction === undefined) return;
    event.preventDefault();
    const step = event.shiftKey ? SHIFT_STEP_MS : STEP_MS;
    const currentIso = edge === "start" ? value.startedAt : value.endedAt;
    commit(edge, Date.parse(currentIso) + direction * step);
  }

  function onPointerDown(edge: Edge, event: PointerEvent<HTMLDivElement>) {
    if (disabled) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus();
    dragRef.current = { edge, pointerId: event.pointerId };
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    const track = trackRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !track) return;
    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) return;
    const fraction = (event.clientX - rect.left) / rect.width;
    commit(drag.edge, screenHistoryMsAtFraction(original, fraction));
  }

  function onPointerEnd(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function renderHandle(edge: Edge) {
    const iso = edge === "start" ? value.startedAt : value.endedAt;
    const offset = edge === "start" ? startOffset : endOffset;
    return (
      <div
        role="slider"
        data-edge={edge}
        tabIndex={disabled ? -1 : 0}
        aria-label={edge === "start" ? labels.startHandle : labels.endHandle}
        aria-valuemin={0}
        aria-valuemax={totalSeconds}
        aria-valuenow={Math.round(
          (Date.parse(iso) - originalStartMs) / SECOND_MS,
        )}
        aria-valuetext={offset}
        aria-disabled={disabled || undefined}
        className={
          "absolute inset-y-0 w-2.5 -translate-x-1/2 touch-none rounded-sm border border-foreground/40 bg-background shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
          (disabled ? "cursor-not-allowed opacity-50" : "cursor-ew-resize")
        }
        style={{
          left: `${edge === "start" ? startPercent : endPercent}%`,
        }}
        onKeyDown={(event) => onKeyDown(edge, event)}
        onPointerDown={(event) => onPointerDown(edge, event)}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div ref={trackRef} className="relative h-8 rounded-md bg-muted">
        <div
          aria-hidden="true"
          data-selection
          className="absolute inset-y-0 rounded-md bg-primary/60"
          style={{
            left: `${startPercent}%`,
            width: `${endPercent - startPercent}%`,
          }}
        />
        {renderHandle("start")}
        {renderHandle("end")}
        {playheadPercent === null ? null : (
          <div
            aria-hidden="true"
            data-playhead
            className="pointer-events-none absolute -inset-y-0.5 w-0.5 -translate-x-1/2 rounded-full bg-foreground"
            style={{ left: `${playheadPercent}%` }}
          />
        )}
      </div>
      <div className="flex items-center justify-between gap-2 text-xs tabular-nums text-muted-foreground">
        <span>
          {labels.start} {startOffset}
        </span>
        <span>
          {labels.length} {lookbackLabel(lengthSeconds)}
        </span>
        <span>
          {labels.end} {endOffset}
        </span>
      </div>
    </div>
  );
}
