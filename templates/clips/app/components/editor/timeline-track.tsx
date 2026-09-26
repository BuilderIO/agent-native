import { useT } from "@agent-native/core/client/i18n";
import { IconArrowBackUp } from "@tabler/icons-react";
import { useCallback, useMemo, useRef, useState } from "react";

import {
  addCut,
  buildTimelinePieces,
  formatMs,
  getCuts,
  getSplits,
  removeCut,
  updateCut,
  type EditsJson,
  type TimelinePiece,
} from "@/lib/timestamp-mapping";
import { cn } from "@/lib/utils";


export type TrackSelection =
  | { kind: "clip"; anchorMs: number }
  | { kind: "gap"; cutId: string }
  /** A red line with no gap behind it yet — selected so it can be deleted. */
  | { kind: "split"; splitId: string };

export interface TimelineTrackProps {
  width: number;
  height: number;
  durationMs: number;
  edits: EditsJson;
  selection: TrackSelection | null;
  onSelectionChange: (selection: TrackSelection | null) => void;
  onPreview: (edits: EditsJson | null) => void;
  onCommit: (edits: EditsJson) => void;
  onSeek?: (originalMs: number) => void;
  disabled?: boolean;
  className?: string;
}

export const MIN_PIECE_MS = 80;
const DRAG_THRESHOLD_PX = 3;
const EDGE_HANDLE_PX = 13;
const RESTORE_BUTTON_MIN_PX = 26;

export type EdgeSide = "clip-start" | "clip-end";

export interface TrackBoundary {
  atMs: number;
  left: { startMs: number; endMs: number } | null;
  right: { startMs: number; endMs: number } | null;
  cutId: string | null;
}

export interface DragTarget {
  kind: "edge";
  side: EdgeSide;
  boundaryMs: number;
  cutId: string | null;
  minMs: number;
  maxMs: number;
  newCutId: string;
}

interface DragState {
  pointerId: number;
  startClientX: number;
  base: EditsJson;
  target: DragTarget;
  splitId: string | null;
  moved: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function trackBoundaries(pieces: TimelinePiece[]): TrackBoundary[] {
  const out: TrackBoundary[] = [];
  for (let i = 0; i < pieces.length - 1; i++) {
    const before = pieces[i];
    const after = pieces[i + 1];
    out.push({
      atMs: before.endMs,
      left:
        before.kind === "clip"
          ? { startMs: before.startMs, endMs: before.endMs }
          : null,
      right:
        after.kind === "clip"
          ? { startMs: after.startMs, endMs: after.endMs }
          : null,
      cutId:
        before.kind === "gap"
          ? before.cutId
          : after.kind === "gap"
            ? after.cutId
            : null,
    });
  }
  return out;
}

export function edgeDragTarget(
  edits: EditsJson,
  boundary: TrackBoundary,
  side: EdgeSide,
  newCutId: string,
): DragTarget | null {
  const cut = boundary.cutId
    ? (getCuts(edits).find((c) => c.id === boundary.cutId) ?? null)
    : null;

  if (side === "clip-end") {
    if (!boundary.left) return null;
    return {
      kind: "edge",
      side,
      boundaryMs: boundary.atMs,
      cutId: cut?.id ?? null,
      minMs: boundary.left.startMs,
      maxMs: cut ? cut.endMs : boundary.atMs,
      newCutId,
    };
  }

  if (!boundary.right) return null;
  return {
    kind: "edge",
    side,
    boundaryMs: boundary.atMs,
    cutId: cut?.id ?? null,
    minMs: cut ? cut.startMs : boundary.atMs,
    maxMs: boundary.right.endMs,
    newCutId,
  };
}

export function applyDrag(
  base: EditsJson,
  durationMs: number,
  target: DragTarget,
  toMs: number,
): EditsJson {
  const at = clamp(Math.round(toMs), target.minMs, target.maxMs);

  if (target.cutId) {
    const cut = getCuts(base).find((c) => c.id === target.cutId);
    if (!cut) return base;
    return target.side === "clip-end"
      ? cut.endMs - at < MIN_PIECE_MS
        ? removeCut(base, cut.id)
        : updateCut(base, cut.id, at, cut.endMs)
      : at - cut.startMs < MIN_PIECE_MS
        ? removeCut(base, cut.id)
        : updateCut(base, cut.id, cut.startMs, at);
  }

  const lo = Math.min(at, target.boundaryMs);
  const hi = Math.max(at, target.boundaryMs);
  if (hi - lo < MIN_PIECE_MS) return base;
  return addCut(base, lo, hi, target.newCutId);
}

export function boundarySide(
  boundary: TrackBoundary,
  selection: TrackSelection | null,
): EdgeSide | null {
  if (!boundary.left) return boundary.right ? "clip-start" : null;
  if (!boundary.right) return "clip-end";
  const rightSelected =
    selection?.kind === "clip" &&
    selection.anchorMs >= boundary.right.startMs &&
    selection.anchorMs < boundary.right.endMs;
  return rightSelected ? "clip-start" : "clip-end";
}

function anchorFor(
  clip: { startMs: number; endMs: number },
  side: EdgeSide,
): number {
  return side === "clip-end"
    ? clip.startMs
    : Math.max(clip.startMs, clip.endMs - 1);
}

export function TimelineTrack({
  width,
  height,
  durationMs,
  edits,
  selection,
  onSelectionChange,
  onPreview,
  onCommit,
  onSeek,
  disabled,
  className,
}: TimelineTrackProps) {
  const t = useT();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [dragging, setDragging] = useState(false);

  const pieces = useMemo(
    () => buildTimelinePieces(durationMs, edits),
    [durationMs, edits],
  );
  const boundaries = useMemo(() => trackBoundaries(pieces), [pieces]);
  const splits = useMemo(() => getSplits(edits), [edits]);

  const toX = useCallback(
    (ms: number) => (ms / Math.max(durationMs, 1)) * width,
    [durationMs, width],
  );

  const toMs = useCallback(
    (clientX: number) => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return 0;
      return clamp(
        Math.round(((clientX - rect.left) / Math.max(width, 1)) * durationMs),
        0,
        durationMs,
      );
    },
    [durationMs, width],
  );

  const isSelected = useCallback(
    (piece: TimelinePiece) => {
      if (!selection) return false;
      if (selection.kind === "gap") {
        return piece.kind === "gap" && piece.cutId === selection.cutId;
      }
      if (selection.kind === "split") return false;
      return (
        piece.kind === "clip" &&
        selection.anchorMs >= piece.startMs &&
        selection.anchorMs < piece.endMs
      );
    },
    [selection],
  );

  const handleMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      if (!drag.moved) {
        if (Math.abs(e.clientX - drag.startClientX) < DRAG_THRESHOLD_PX) return;
        drag.moved = true;
        setDragging(true);
      }
      onPreview(applyDrag(drag.base, durationMs, drag.target, toMs(e.clientX)));
    },
    [durationMs, onPreview, toMs],
  );

  const endDrag = useCallback(
    (e: React.PointerEvent, commit: boolean) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      dragRef.current = null;
      setDragging(false);
      onPreview(null);
      if (!commit) return;
      if (!drag.moved) {
        if (drag.splitId) {
          onSelectionChange({ kind: "split", splitId: drag.splitId });
        }
        return;
      }
      onCommit(applyDrag(drag.base, durationMs, drag.target, toMs(e.clientX)));
    },
    [durationMs, onCommit, onPreview, onSelectionChange, toMs],
  );

  const beginDrag = (
    e: React.PointerEvent,
    target: DragTarget,
    splitId: string | null,
  ) => {
    rootRef.current?.setPointerCapture?.(e.pointerId);
    dragRef.current = {
      pointerId: e.pointerId,
      startClientX: e.clientX,
      base: edits,
      target,
      splitId,
      moved: false,
    };
  };

  return (
    <div
      ref={rootRef}
      className={cn("relative select-none", className)}
      style={{ width, height }}
      onPointerMove={handleMove}
      onPointerUp={(e) => endDrag(e, true)}
      onPointerCancel={(e) => endDrag(e, false)}
    >
      {pieces.map((piece, index) => {
        const left = Math.max(0, Math.min(width, toX(piece.startMs)));
        const pieceWidth = Math.max(
          1,
          Math.min(width - left, toX(piece.endMs) - left),
        );
        const selected = isSelected(piece);
        const capLeft = index === 0;
        const capRight = index === pieces.length - 1;

        if (piece.kind === "gap") {
          return (
            <div
              key={piece.id}
              role="button"
              tabIndex={-1}
              aria-pressed={selected}
              aria-label={t("timelineTrack.removedSection", {
                duration: formatMs(piece.endMs - piece.startMs),
              })}
              className={cn(
                "absolute top-0 flex h-full items-center justify-center",
                capLeft && "rounded-l-[10px]",
                capRight && "rounded-r-[10px]",
                disabled
                  ? "cursor-default"
                  : "cursor-pointer hover:bg-rose-500/15",
                selected && "bg-rose-500/20 ring-2 ring-inset ring-rose-400",
              )}
              style={{ left, width: pieceWidth }}
              onPointerDown={(e) => {
                if (disabled || e.button !== 0) return;
                e.preventDefault();
                onSelectionChange({ kind: "gap", cutId: piece.cutId });
              }}
            >
              {pieceWidth >= RESTORE_BUTTON_MIN_PX ? (
                <button
                  type="button"
                  className="rounded-full bg-background/85 p-1 text-foreground/80 shadow-sm hover:text-foreground"
                  title={t("timelineTrack.putBack")}
                  aria-label={t("timelineTrack.putBack")}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectionChange(null);
                    onCommit(removeCut(edits, piece.cutId));
                  }}
                >
                  <IconArrowBackUp className="h-3 w-3" />
                </button>
              ) : null}
            </div>
          );
        }

        return (
          <div
            key={piece.id}
            role="button"
            tabIndex={-1}
            aria-pressed={selected}
            aria-label={t("timelineTrack.section", {
              start: formatMs(piece.startMs),
              end: formatMs(piece.endMs),
            })}
            className={cn(
              "absolute top-0 h-full rounded-[3px] border transition-colors",
              capLeft && "rounded-l-[10px]",
              capRight && "rounded-r-[10px]",
              disabled ? "cursor-default" : "cursor-pointer",
              selected
                ? "border-primary bg-primary/15 ring-2 ring-inset ring-primary"
                : "border-transparent hover:border-primary/50 hover:bg-primary/5",
            )}
            style={{ left, width: pieceWidth }}
            onPointerDown={(e) => {
              if (disabled || e.button !== 0) return;
              e.preventDefault();
              const at = toMs(e.clientX);
              onSelectionChange({ kind: "clip", anchorMs: at });
              onSeek?.(at);
            }}
          />
        );
      })}

      {/*
        Where the clip starts and where it stops: the same marker at both ends,
        thicker than a boundary line and rounded, so the track reads as
        something with two ends rather than something running off the panel.
      */}
      <div
        className="pointer-events-none absolute top-0 left-0 h-full w-[5px] rounded-full bg-foreground/45"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute top-0 h-full w-[5px] rounded-full bg-foreground/45"
        style={{ left: Math.max(0, width - 5) }}
        aria-hidden
      />

      {/* Boundaries, drawn over the pieces so they stay grabbable. */}
      {boundaries.map((boundary) => {
        const side = boundarySide(boundary, selection);
        if (!side) return null;
        const clip = side === "clip-end" ? boundary.left : boundary.right;
        if (!clip) return null;
        const active =
          selection?.kind === "clip" &&
          selection.anchorMs >= clip.startMs &&
          selection.anchorMs < clip.endMs;
        const splitId = boundary.cutId
          ? null
          : (splits.find((s) => s.startMs === boundary.atMs)?.id ?? null);
        const lineSelected =
          selection?.kind === "split" && selection.splitId === splitId;
        return (
          <EdgeHandle
            key={`edge-${Math.round(boundary.atMs)}-${side}`}
            x={toX(boundary.atMs)}
            side={side}
            active={active || lineSelected}
            selected={lineSelected}
            dragging={dragging}
            disabled={disabled}
            label={
              side === "clip-end"
                ? t("timelineTrack.sectionEndsAt", {
                    at: formatMs(boundary.atMs),
                  })
                : t("timelineTrack.sectionStartsAt", {
                    at: formatMs(boundary.atMs),
                  })
            }
            onPointerDown={(e) => {
              if (disabled || e.button !== 0) return;
              const target = edgeDragTarget(
                edits,
                boundary,
                side,
                `cut-${Date.now().toString(36)}-${Math.round(boundary.atMs)}`,
              );
              if (!target) return;
              e.preventDefault();
              e.stopPropagation();
              onSelectionChange({
                kind: "clip",
                anchorMs: anchorFor(clip, side),
              });
              beginDrag(e, target, splitId);
            }}
          />
        );
      })}
    </div>
  );
}

function EdgeHandle({
  x,
  side,
  label,
  active,
  selected,
  dragging,
  disabled,
  onPointerDown,
}: {
  x: number;
  side: EdgeSide;
  label: string;
  active?: boolean;
  selected?: boolean;
  dragging?: boolean;
  disabled?: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  const inward = side === "clip-end" ? "left" : "right";
  return (
    <div
      className={cn(
        "group absolute top-0 h-full",
        disabled
          ? "cursor-default"
          : dragging
            ? "cursor-grabbing"
            : "cursor-ew-resize",
      )}
      style={{ left: x - EDGE_HANDLE_PX / 2, width: EDGE_HANDLE_PX }}
      data-side={side}
      title={label}
      aria-label={label}
      onPointerDown={onPointerDown}
    >
      <div
        className={cn(
          "mx-auto h-full",
          selected ? "bg-amber-400 ring-1 ring-amber-300" : "bg-rose-500",
          active ? "w-[3px]" : "w-[2px] group-hover:w-[3px]",
        )}
      />
      {/* Which way this edge eats into its own section. */}
      <div
        className={cn(
          "absolute top-1/2 h-0 w-0 -translate-y-1/2 border-y-[4px] border-y-transparent",
          active || !disabled ? "opacity-90" : "opacity-40",
          inward === "left"
            ? "right-1/2 mr-[2px] border-r-[5px] border-r-rose-500"
            : "left-1/2 ml-[2px] border-l-[5px] border-l-rose-500",
        )}
      />
    </div>
  );
}
