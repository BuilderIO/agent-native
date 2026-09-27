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

const ROW_HEIGHT = 16;
const ROW_GAP = 2;
const MAX_ROWS = 4;

export function redactionLaneHeight(rowCount: number): number {
  return Math.max(1, rowCount) * (ROW_HEIGHT + ROW_GAP) + ROW_GAP;
}

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
const EDGE_PX = 8;
const DRAG_THRESHOLD_PX = 3;
const DOUBLE_PRESS_MS = 400;

export interface RedactionLaneProps {
  width: number;
  durationMs: number;
  redactions: VideoRedaction[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onPreview: (redactions: VideoRedaction[] | null) => void;
  onCommit: (redactions: VideoRedaction[]) => void;
  onSeek?: (originalMs: number) => void;
  disabled?: boolean;
  className?: string;
}

type Edge = "start" | "end";

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
  const keyPressRef = useRef<{ id: string; atMs: number; at: number } | null>(
    null,
  );
  const barPressRef = useRef<{ id: string; clientX: number } | null>(null);

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
    if (drag.target.kind === "key") {
      onSeek?.(Math.min(Math.max(at, drag.base.startMs), drag.base.endMs));
    }
    onPreview(applied(drag, at));
  };

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
