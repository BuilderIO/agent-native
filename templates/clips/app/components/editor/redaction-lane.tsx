import { useT } from "@agent-native/core/client/i18n";
import { useCallback, useMemo, useRef, useState } from "react";

import { formatMs } from "@/lib/timestamp-mapping";
import { cn } from "@/lib/utils";
import {
  clampRedactionToDuration,
  KEY_MERGE_TOLERANCE_MS,
  moveRedactionKey,
  redactionRectAt,
  removeRedactionKey,
  setRedactionKey,
  setRedactionRange,
  type VideoRedaction,
} from "@/lib/video-redactions";

/**
 * A lane under the clip track: one bar per redaction, showing when it is on
 * screen and where its waypoints are.
 *
 * It shares the clip lane's time axis and its gesture vocabulary — drag an
 * edge to move it, click to select — so the timeline reads as one thing. What
 * it deliberately does not share is the clip lane's rule about sections owning
 * boundaries: a redaction bar is a free-floating range, and both of its edges
 * belong to it.
 */

const ROW_HEIGHT = 16;
const ROW_GAP = 2;
/** Beyond this the lane would crowd out the timeline; later ones share a row. */
const MAX_ROWS = 4;

export function redactionLaneHeight(rowCount: number): number {
  return Math.max(1, rowCount) * (ROW_HEIGHT + ROW_GAP) + ROW_GAP;
}

/**
 * Put overlapping redactions on their own rows.
 *
 * Two boxes covering the same stretch is the normal case — a name and an email
 * address on the same screen — and stacked on one row the second is drawn
 * exactly on top of the first, where it cannot be clicked at all.
 */
export function packRedactionRows(redactions: VideoRedaction[]): {
  rows: number;
  rowOf: Map<string, number>;
} {
  const ends: number[] = [];
  const rowOf = new Map<string, number>();
  for (const redaction of [...redactions].sort(
    (a, b) => a.startMs - b.startMs,
  )) {
    let row = ends.findIndex((end) => end <= redaction.startMs);
    if (row === -1) {
      row = ends.length < MAX_ROWS ? ends.length : MAX_ROWS - 1;
    }
    ends[row] = Math.max(ends[row] ?? 0, redaction.endMs);
    rowOf.set(redaction.id, row);
  }
  return { rows: Math.max(1, ends.length), rowOf };
}
/** Below this a bar is too small to grab, so it is drawn but not resizable. */
const EDGE_PX = 8;
const DRAG_THRESHOLD_PX = 3;
/** Two presses this close together on one waypoint means "remove it". */
const DOUBLE_PRESS_MS = 400;

export interface RedactionLaneProps {
  width: number;
  durationMs: number;
  redactions: VideoRedaction[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Continuous feedback while an edge is moving. */
  onPreview: (redactions: VideoRedaction[] | null) => void;
  onCommit: (redactions: VideoRedaction[]) => void;
  onSeek?: (originalMs: number) => void;
  disabled?: boolean;
  className?: string;
}

type Edge = "start" | "end";

/** An edge of the bar, or one of the waypoints along it. */
type LaneTarget = { kind: "edge"; edge: Edge } | { kind: "key"; atMs: number };

interface DragState {
  pointerId: number;
  startClientX: number;
  id: string;
  target: LaneTarget;
  base: VideoRedaction;
  moved: boolean;
}

export function RedactionLane({
  width,
  durationMs,
  redactions,
  selectedId,
  onSelect,
  onPreview,
  onCommit,
  onSeek,
  disabled,
  className,
}: RedactionLaneProps) {
  const t = useT();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [dragging, setDragging] = useState(false);
  /** The last press on a waypoint, for spotting a second one. */
  const keyPressRef = useRef<{ id: string; atMs: number; at: number } | null>(
    null,
  );
  /** The last press on a bar, for telling a click from a drag. */
  const barPressRef = useRef<{ id: string; clientX: number } | null>(null);

  /**
   * Nothing is drawn outside the track, whatever the document says.
   *
   * A bar that runs past the end of the recording puts its end grip somewhere
   * there is no timeline, and a redaction whose end cannot be grabbed cannot be
   * brought back — the editor clamps ranges too, but this lane is the thing
   * with the geometry, so it does not take that on trust.
   */
  const shown = useMemo(
    () => redactions.map((r) => clampRedactionToDuration(r, durationMs)),
    [durationMs, redactions],
  );
  const { rows, rowOf } = packRedactionRows(shown);

  const toX = useCallback(
    (ms: number) => (ms / Math.max(durationMs, 1)) * width,
    [durationMs, width],
  );

  const toMs = useCallback(
    (clientX: number) => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return 0;
      const ms = ((clientX - rect.left) / Math.max(width, 1)) * durationMs;
      return Math.max(0, Math.min(durationMs, Math.round(ms)));
    },
    [durationMs, width],
  );

  const applied = useCallback(
    (drag: DragState, atMs: number): VideoRedaction[] => {
      let next: VideoRedaction;
      if (drag.target.kind === "key") {
        // A waypoint stays on its own bar: dragged outside the range it would
        // still steer the box, from somewhere the user cannot see it.
        const within = Math.min(
          Math.max(atMs, drag.base.startMs),
          drag.base.endMs,
        );
        next = moveRedactionKey(drag.base, drag.target.atMs, within);
      } else if (drag.target.edge === "start") {
        next = setRedactionRange(
          drag.base,
          Math.min(atMs, drag.base.endMs),
          drag.base.endMs,
        );
      } else {
        next = setRedactionRange(
          drag.base,
          drag.base.startMs,
          Math.max(atMs, drag.base.startMs),
        );
      }
      return shown.map((r) => (r.id === drag.id ? next : r));
    },
    [shown],
  );

  const handleMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    if (!drag.moved) {
      if (Math.abs(e.clientX - drag.startClientX) < DRAG_THRESHOLD_PX) return;
      drag.moved = true;
      setDragging(true);
    }
    const at = toMs(e.clientX);
    // Dragging a waypoint takes the playhead with it: the whole point of
    // moving one is to line the box up with what is on screen at that moment,
    // which means being able to see that moment.
    if (drag.target.kind === "key") {
      onSeek?.(Math.min(Math.max(at, drag.base.startMs), drag.base.endMs));
    }
    onPreview(applied(drag, at));
  };

  /**
   * `commit` is false for a cancelled pointer. A cancel is the browser taking
   * the gesture away rather than the user letting go, so the timing goes back
   * to what it was instead of being saved half-dragged.
   */
  const endDrag = (e: React.PointerEvent, commit: boolean) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    onPreview(null);
    if (commit && drag.moved) onCommit(applied(drag, toMs(e.clientX)));
  };

  const beginDrag = (e: React.PointerEvent, id: string, target: LaneTarget) => {
    if (disabled || e.button !== 0) return;
    const base = shown.find((r) => r.id === id);
    if (!base) return;
    e.preventDefault();
    e.stopPropagation();
    rootRef.current?.setPointerCapture?.(e.pointerId);
    onSelect(id);
    dragRef.current = {
      pointerId: e.pointerId,
      startClientX: e.clientX,
      id,
      target,
      base,
      moved: false,
    };
  };

  return (
    <div
      ref={rootRef}
      className={cn("relative", className)}
      style={{ width, height: redactionLaneHeight(rows) }}
      onPointerMove={handleMove}
      onPointerUp={(e) => endDrag(e, true)}
      onPointerCancel={(e) => endDrag(e, false)}
    >
      {/* The same two markers the track has, so the lanes line up. */}
      <div
        className="pointer-events-none absolute top-0 left-0 h-full w-[5px] rounded-full bg-foreground/25"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute top-0 h-full w-[5px] rounded-full bg-foreground/25"
        style={{ left: Math.max(0, width - 5) }}
        aria-hidden
      />

      {shown.map((redaction) => {
        // Pixels, clamped to the track as well as the range: a track whose
        // duration is unknown maps every millisecond somewhere off the right
        // of the screen, and a bar out there cannot be grabbed or deleted.
        const left = Math.max(0, Math.min(width, toX(redaction.startMs)));
        const barWidth = Math.max(
          2,
          Math.min(width - left, toX(redaction.endMs) - left),
        );
        const selected = redaction.id === selectedId;
        return (
          <div
            key={redaction.id}
            role="button"
            tabIndex={-1}
            aria-pressed={selected}
            aria-label={t("redaction.range", {
              start: formatMs(redaction.startMs),
              end: formatMs(redaction.endMs),
            })}
            className={cn(
              "absolute flex items-center rounded-sm",
              // guard:allow-raw-color — the swatch shows the colour the burn writes into the file, so it must not follow the theme.
              "bg-[#0b0f19] text-white/70",
              disabled ? "cursor-default" : "cursor-pointer",
              selected
                ? "outline outline-2 outline-amber-400"
                : "outline outline-1 outline-white/25 hover:outline-white/60",
            )}
            style={{
              left,
              width: barWidth,
              height: ROW_HEIGHT,
              top:
                ROW_GAP +
                (rowOf.get(redaction.id) ?? 0) * (ROW_HEIGHT + ROW_GAP),
            }}
            onPointerDown={(e) => {
              if (disabled || e.button !== 0) return;
              e.preventDefault();
              barPressRef.current = { id: redaction.id, clientX: e.clientX };
              onSelect(redaction.id);
              onSeek?.(toMs(e.clientX));
            }}
            onPointerUp={(e) => {
              const press = barPressRef.current;
              barPressRef.current = null;
              // A click on the bar pins the box where it already is at that
              // moment. It changes nothing on screen until the box is moved
              // or the diamond is dragged, and a point landing on one that is
              // already there is left alone — so clicking to select costs
              // nothing, and there is no tool to arm first.
              if (
                disabled ||
                !press ||
                press.id !== redaction.id ||
                Math.abs(e.clientX - press.clientX) >= DRAG_THRESHOLD_PX
              ) {
                return;
              }
              const at = toMs(e.clientX);
              if (
                redaction.keys.some(
                  (k) => Math.abs(k.atMs - at) <= KEY_MERGE_TOLERANCE_MS,
                )
              ) {
                return;
              }
              onCommit(
                shown.map((r) =>
                  r.id === redaction.id
                    ? setRedactionKey(r, at, redactionRectAt(r, at))
                    : r,
                ),
              );
            }}
          >
            {/* Waypoints: where the box was put by hand. */}
            {redaction.keys.map((key) => (
              // Draggable, so *when* the box arrives somewhere is adjustable
              // without re-placing it. The hit area is wider than the diamond,
              // which is too small to catch with a pointer.
              <div
                key={key.atMs}
                role="button"
                tabIndex={-1}
                aria-label={t("redaction.waypoint", { at: formatMs(key.atMs) })}
                className={cn(
                  "absolute top-0 flex h-full w-3 -translate-x-1/2 items-center justify-center",
                  disabled ? "cursor-default" : "cursor-ew-resize",
                )}
                style={{ left: toX(key.atMs) - left }}
                title={t("redaction.waypoint", { at: formatMs(key.atMs) })}
                // Two presses in quick succession removes it. Counted here
                // rather than left to `dblclick`, which never arrives: a
                // pointerdown whose default is prevented — as a drag's must
                // be, or the picture gets selected instead — takes the
                // browser's click and double-click events with it.
                onPointerDown={(e) => {
                  if (disabled || e.button !== 0) return;
                  const now = Date.now();
                  const previous = keyPressRef.current;
                  const again =
                    previous &&
                    previous.id === redaction.id &&
                    previous.atMs === key.atMs &&
                    now - previous.at < DOUBLE_PRESS_MS;
                  if (again) {
                    keyPressRef.current = null;
                    e.preventDefault();
                    e.stopPropagation();
                    if (redaction.keys.length <= 1) return;
                    onCommit(
                      shown.map((r) =>
                        r.id === redaction.id
                          ? removeRedactionKey(r, key.atMs)
                          : r,
                      ),
                    );
                    return;
                  }
                  keyPressRef.current = {
                    id: redaction.id,
                    atMs: key.atMs,
                    at: now,
                  };
                  beginDrag(e, redaction.id, { kind: "key", atMs: key.atMs });
                }}
              >
                <span className="h-1.5 w-1.5 rotate-45 bg-amber-400" />
              </div>
            ))}

            <EdgeGrip
              side="start"
              barWidth={barWidth}
              dragging={dragging}
              disabled={disabled}
              label={t("redaction.startsAt", {
                at: formatMs(redaction.startMs),
              })}
              onPointerDown={(e) =>
                beginDrag(e, redaction.id, { kind: "edge", edge: "start" })
              }
            />
            <EdgeGrip
              side="end"
              barWidth={barWidth}
              dragging={dragging}
              disabled={disabled}
              label={t("redaction.endsAt", { at: formatMs(redaction.endMs) })}
              onPointerDown={(e) =>
                beginDrag(e, redaction.id, { kind: "edge", edge: "end" })
              }
            />
          </div>
        );
      })}
    </div>
  );
}

function EdgeGrip({
  side,
  barWidth,
  label,
  dragging,
  disabled,
  onPointerDown,
}: {
  side: Edge;
  barWidth: number;
  label: string;
  dragging?: boolean;
  disabled?: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  // Grips stay inside the bar — one hanging off the end of a redaction that
  // runs to the end of the recording would be clipped, and unreachable. On a
  // short bar they take half each rather than overlapping, which otherwise
  // hands the whole bar to whichever one is drawn last.
  const grip = Math.max(3, Math.min(EDGE_PX, barWidth / 2));
  return (
    <div
      className={cn(
        "absolute top-0 h-full",
        side === "start" ? "left-0" : "right-0",
        disabled
          ? "cursor-default"
          : dragging
            ? "cursor-grabbing"
            : "cursor-ew-resize",
      )}
      style={{ width: grip }}
      title={label}
      aria-label={label}
      onPointerDown={onPointerDown}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className={cn(
          "h-full w-[2px] bg-amber-400/80",
          side === "start" ? "mr-auto" : "ml-auto",
        )}
      />
    </div>
  );
}
