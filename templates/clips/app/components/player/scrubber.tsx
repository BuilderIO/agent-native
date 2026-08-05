import { useT } from "@agent-native/core/client/i18n";
import { IconMessage2Filled } from "@tabler/icons-react";
import { useMemo, useRef, useState } from "react";

import { CoordinateMenu } from "@/components/editor/coordinate-menu";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ANNOTATION_KIND_ORDER,
  annotationColorClass,
  annotationKindLabel,
} from "@/lib/annotation-kinds";
import { cn } from "@/lib/utils";

import {
  scrubberFillPercent,
  scrubberPositionFromClientX,
} from "./scrubber-position";

/** Annotation shown on the timeline; `mayEdit` is resolved by the caller. */
export interface ScrubberAnnotation {
  id: string;
  startMs: number;
  endMs: number | null;
  kind: string;
  label: string | null;
  body: string | null;
  resolved: boolean;
  mayEdit: boolean;
}

type ScrubberMenuTarget =
  | { type: "bar"; ms: number }
  | { type: "annotation"; annotation: ScrubberAnnotation };

export interface ScrubberProps {
  currentMs: number;
  durationMs: number;
  onSeek: (ms: number) => void;
  comments?: { id: string; videoTimestampMs: number; content: string }[];
  chapters?: { startMs: number; title: string }[];
  reactions?: { id: string; emoji: string; videoTimestampMs: number }[];
  excludedRanges?: { startMs: number; endMs: number }[];
  annotations?: ScrubberAnnotation[];
  onAddAnnotationAt?: (ms: number, kind: string) => void;
  onToggleAnnotationResolved?: (annotation: ScrubberAnnotation) => void;
  onChangeAnnotationKind?: (
    annotation: ScrubberAnnotation,
    kind: string,
  ) => void;
  onDeleteAnnotation?: (annotation: ScrubberAnnotation) => void;
}

export function Scrubber(props: ScrubberProps) {
  const {
    currentMs,
    durationMs,
    onSeek,
    comments,
    chapters,
    reactions,
    excludedRanges,
    annotations,
    onAddAnnotationAt,
    onToggleAnnotationResolved,
    onChangeAnnotationKind,
    onDeleteAnnotation,
  } = props;
  const t = useT();
  const barRef = useRef<HTMLDivElement | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const [hoverMs, setHoverMs] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState<number>(0);
  const [dragging, setDragging] = useState(false);
  const [tooltip, setTooltip] = useState<
    | { kind: "comment"; content: string; ms: number }
    | { kind: "chapter"; title: string; ms: number }
    | { kind: "annotation"; content: string; ms: number }
    | null
  >(null);
  // What the last right-click landed on. Set in onContextMenu (fires before
  // Radix opens the menu) so one ContextMenu serves the bar and every marker.
  const [menuTarget, setMenuTarget] = useState<ScrubberMenuTarget | null>(null);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });

  const pct = scrubberFillPercent(currentMs, durationMs);

  const recentReactions = useMemo(
    () => (reactions ? reactions.slice(-50) : []),
    [reactions],
  );

  function positionFromClientX(clientX: number): { ms: number; x: number } {
    const el = barRef.current;
    if (!el) return { ms: 0, x: 0 };
    return scrubberPositionFromClientX(
      clientX,
      el.getBoundingClientRect(),
      durationMs,
    );
  }

  function seekFromClientX(clientX: number): void {
    const next = positionFromClientX(clientX);
    setHoverX(next.x);
    setHoverMs(next.ms);
    onSeek(next.ms);
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    activePointerIdRef.current = e.pointerId;
    setDragging(true);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Older test/browser environments may not implement pointer capture.
    }
    seekFromClientX(e.clientX);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (activePointerIdRef.current === e.pointerId) {
      e.preventDefault();
      seekFromClientX(e.clientX);
      return;
    }

    if (e.pointerType === "mouse") {
      const next = positionFromClientX(e.clientX);
      setHoverX(next.x);
      setHoverMs(next.ms);
    }
  }

  function endPointerDrag(e: React.PointerEvent<HTMLDivElement>) {
    if (activePointerIdRef.current !== e.pointerId) return;
    activePointerIdRef.current = null;
    setDragging(false);
    if (e.pointerType !== "mouse") setHoverMs(null);
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Older test/browser environments may not implement pointer capture.
    }
  }

  const commentsByMs = useMemo(() => {
    const map = new Map<number, { id: string; content: string }[]>();
    (comments ?? []).forEach((c) => {
      // Bucket by 500ms so overlapping comments cluster.
      const key = Math.round(c.videoTimestampMs / 500) * 500;
      const list = map.get(key) ?? [];
      list.push({ id: c.id, content: c.content });
      map.set(key, list);
    });
    return map;
  }, [comments]);

  const menuEnabled = Boolean(
    onAddAnnotationAt ||
    onToggleAnnotationResolved ||
    onChangeAnnotationKind ||
    onDeleteAnnotation,
  );

  const annotationTooltip = (a: ScrubberAnnotation) => {
    const text = a.label ?? a.body ?? "";
    const kindLabel = annotationKindLabel(a.kind, t);
    return text ? `${kindLabel}: ${text.slice(0, 100)}` : kindLabel;
  };

  const body = (
    <div
      className="relative h-10 flex items-center touch-none cursor-pointer"
      data-player-ui
      data-player-scrubber
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointerDrag}
      onPointerCancel={endPointerDrag}
      onLostPointerCapture={() => {
        activePointerIdRef.current = null;
        setDragging(false);
      }}
      onPointerLeave={() => {
        if (activePointerIdRef.current === null) setHoverMs(null);
      }}
      onContextMenu={(e) => {
        if (!menuEnabled) return;
        e.preventDefault();
        // Markers set their own target (and stop propagation); the bar is
        // the fallback. The controlled CoordinateMenu re-anchors on every
        // right-click, so an open menu moves instead of only dismissing.
        setMenuPos({ x: e.clientX, y: e.clientY });
        setMenuTarget({ type: "bar", ms: positionFromClientX(e.clientX).ms });
      }}
    >
      {/* Hover bubble */}
      {hoverMs !== null && !tooltip ? (
        <div
          className="absolute -top-8 -translate-x-1/2 rounded bg-black/90 px-2 py-1 text-[11px] text-white pointer-events-none"
          style={{ left: hoverX }}
        >
          {msToClock(hoverMs)}
        </div>
      ) : null}

      {/* Tooltip (comment / chapter) */}
      {tooltip ? (
        <div
          className="absolute -top-10 -translate-x-1/2 max-w-[240px] rounded bg-primary px-2 py-1 text-[11px] text-primary-foreground"
          style={{ left: (tooltip.ms / Math.max(1, durationMs)) * 100 + "%" }}
        >
          {tooltip.kind === "chapter" ? tooltip.title : tooltip.content}
        </div>
      ) : null}

      <div
        ref={barRef}
        data-player-scrubber-bar
        className="relative w-full h-1.5 bg-white/35 rounded-full cursor-pointer group/bar shadow-[0_0_0_1px_rgba(0,0,0,0.16)]"
      >
        {/* Filled portion */}
        <div
          className="absolute inset-y-0 left-0 bg-white rounded-full shadow-[0_0_10px_rgba(255,255,255,0.45)]"
          style={{ width: pct + "%" }}
        />

        {/* Cut ranges */}
        {excludedRanges?.map((range, i) => {
          const startPct =
            (Math.max(0, range.startMs) / Math.max(1, durationMs)) * 100;
          const endPct =
            (Math.min(durationMs, range.endMs) / Math.max(1, durationMs)) * 100;
          return (
            <div
              key={`${range.startMs}-${range.endMs}-${i}`}
              className="absolute inset-y-0 rounded-sm bg-black/70"
              style={{
                left: `${startPct}%`,
                width: `${Math.max(0.5, endPct - startPct)}%`,
                backgroundImage:
                  "repeating-linear-gradient(45deg, rgba(255,255,255,0.2) 0 3px, transparent 3px 7px)",
              }}
              title={`Cut: ${msToClock(range.startMs)}-${msToClock(
                range.endMs,
              )}`}
            />
          );
        })}

        {/* Chapter notches */}
        {chapters?.map((ch, i) => (
          <button
            key={i}
            type="button"
            onMouseEnter={() =>
              setTooltip({ kind: "chapter", title: ch.title, ms: ch.startMs })
            }
            onMouseLeave={() => setTooltip(null)}
            onClick={(e) => {
              e.stopPropagation();
              onSeek(ch.startMs);
            }}
            className="absolute top-1/2 h-3 w-0.5 -translate-x-1/2 -translate-y-1/2 bg-white/80 transition-[transform,opacity] duration-150 ease-out hover:scale-x-[2] hover:scale-y-125 motion-reduce:transition-none motion-reduce:hover:scale-100"
            style={{
              left: (ch.startMs / Math.max(1, durationMs)) * 100 + "%",
            }}
            aria-label={`Chapter: ${ch.title}`}
          />
        ))}

        {/* Annotation sections (range bands on the bar) */}
        {annotations
          ?.filter((a) => a.endMs !== null)
          .map((a) => {
            const startPct = (a.startMs / Math.max(1, durationMs)) * 100;
            const endPct =
              (Math.min(durationMs, a.endMs ?? 0) / Math.max(1, durationMs)) *
              100;
            return (
              <div
                key={`section-${a.id}`}
                data-annotation-marker
                className={cn(
                  "absolute inset-y-0 rounded-sm opacity-40",
                  annotationColorClass(a.kind),
                  a.resolved && "opacity-15",
                )}
                style={{
                  left: `${startPct}%`,
                  width: `${Math.max(0.5, endPct - startPct)}%`,
                }}
                onContextMenu={(e) => {
                  if (!menuEnabled) return;
                  e.preventDefault();
                  e.stopPropagation();
                  setMenuPos({ x: e.clientX, y: e.clientY });
                  setMenuTarget({ type: "annotation", annotation: a });
                }}
              />
            );
          })}

        {/* Annotation needles — playhead-like: a stem with a selectable head */}
        {annotations?.map((a) => (
          <button
            key={`needle-${a.id}`}
            type="button"
            data-annotation-marker
            onMouseEnter={() =>
              setTooltip({
                kind: "annotation",
                content: annotationTooltip(a),
                ms: a.startMs,
              })
            }
            onMouseLeave={() => setTooltip(null)}
            onClick={(e) => {
              e.stopPropagation();
              onSeek(a.startMs);
            }}
            onContextMenu={(e) => {
              if (!menuEnabled) return;
              e.preventDefault();
              e.stopPropagation();
              setMenuPos({ x: e.clientX, y: e.clientY });
              setMenuTarget({ type: "annotation", annotation: a });
            }}
            className={cn(
              "absolute -top-2.5 -translate-x-1/2 flex flex-col items-center",
              a.resolved && "opacity-40",
            )}
            style={{ left: (a.startMs / Math.max(1, durationMs)) * 100 + "%" }}
            aria-label={annotationTooltip(a)}
          >
            <span
              className={cn(
                "h-2 w-2 rounded-full border border-black/40 transition-transform hover:scale-125",
                annotationColorClass(a.kind),
              )}
            />
            <span className={cn("h-2.5 w-0.5", annotationColorClass(a.kind))} />
          </button>
        ))}

        {/* Comment dots */}
        {Array.from(commentsByMs.entries()).map(([ms, list]) => (
          <button
            key={ms}
            type="button"
            onMouseEnter={() =>
              setTooltip({
                kind: "comment",
                content: list[0].content.slice(0, 100),
                ms,
              })
            }
            onMouseLeave={() => setTooltip(null)}
            onClick={(e) => {
              e.stopPropagation();
              onSeek(ms);
            }}
            className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md ring-2 ring-background transition-transform hover:scale-125"
            style={{ left: (ms / Math.max(1, durationMs)) * 100 + "%" }}
            aria-label={`${list.length} comment${list.length > 1 ? "s" : ""}`}
          >
            <IconMessage2Filled className="h-2.5 w-2.5" />
            {list.length > 1 && (
              <span className="absolute -top-1.5 -right-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-[8px] font-bold leading-none text-primary-foreground ring-2 ring-background">
                {list.length}
              </span>
            )}
          </button>
        ))}

        {/* Reaction dots */}
        {recentReactions.map((r) => (
          <div
            key={r.id}
            className="absolute -bottom-4 -translate-x-1/2 text-[11px] pointer-events-none"
            style={{
              left: (r.videoTimestampMs / Math.max(1, durationMs)) * 100 + "%",
            }}
          >
            {r.emoji}
          </div>
        ))}

        {/* Thumb */}
        <div
          className={cn(
            "absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white opacity-0 shadow transition-[transform,opacity] duration-150 ease-out motion-reduce:scale-100 motion-reduce:transition-none",
            dragging
              ? "scale-125 opacity-100"
              : "scale-95 group-hover/bar:scale-100 group-hover/bar:opacity-100",
          )}
          style={{ left: pct + "%" }}
        />
      </div>
    </div>
  );

  if (!menuEnabled) return body;

  return (
    <>
      {body}
      <CoordinateMenu
        open={menuTarget !== null}
        x={menuPos.x}
        y={menuPos.y}
        onOpenChange={(open) => {
          if (!open) setMenuTarget(null);
        }}
      >
        {menuTarget?.type === "bar" && onAddAnnotationAt
          ? ANNOTATION_KIND_ORDER.map((kind) => (
              <DropdownMenuItem
                key={kind}
                onSelect={() =>
                  onAddAnnotationAt(Math.round(menuTarget.ms), kind)
                }
              >
                <span
                  className={cn(
                    "me-2 inline-block h-2 w-2 rounded-full",
                    annotationColorClass(kind),
                  )}
                />
                {t("annotationsStrip.addKindAt", {
                  kind: annotationKindLabel(kind, t),
                  time: msToClock(menuTarget.ms),
                })}
              </DropdownMenuItem>
            ))
          : null}
        {menuTarget?.type === "annotation" ? (
          <>
            <DropdownMenuItem
              onSelect={() => onSeek(menuTarget.annotation.startMs)}
            >
              {t("annotationsStrip.jumpTo", {
                time: msToClock(menuTarget.annotation.startMs),
              })}
            </DropdownMenuItem>
            {menuTarget.annotation.mayEdit && onChangeAnnotationKind ? (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  {t("annotationsStrip.changeType")}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {ANNOTATION_KIND_ORDER.map((kind) => (
                    <DropdownMenuItem
                      key={kind}
                      disabled={kind === menuTarget.annotation.kind}
                      onSelect={() =>
                        onChangeAnnotationKind(menuTarget.annotation, kind)
                      }
                    >
                      <span
                        className={cn(
                          "me-2 inline-block h-2 w-2 rounded-full",
                          annotationColorClass(kind),
                        )}
                      />
                      {annotationKindLabel(kind, t)}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ) : null}
            {menuTarget.annotation.mayEdit &&
            (onToggleAnnotationResolved || onDeleteAnnotation) ? (
              <DropdownMenuSeparator />
            ) : null}
            {menuTarget.annotation.mayEdit && onToggleAnnotationResolved ? (
              <DropdownMenuItem
                onSelect={() =>
                  onToggleAnnotationResolved(menuTarget.annotation)
                }
              >
                {menuTarget.annotation.resolved
                  ? t("annotationsStrip.reopen")
                  : t("annotationsStrip.resolve")}
              </DropdownMenuItem>
            ) : null}
            {menuTarget.annotation.mayEdit && onDeleteAnnotation ? (
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onSelect={() => onDeleteAnnotation(menuTarget.annotation)}
              >
                {t("annotationsStrip.delete")}
              </DropdownMenuItem>
            ) : null}
          </>
        ) : null}
      </CoordinateMenu>
    </>
  );
}

export function msToClock(ms: number): string {
  if (!isFinite(ms) || ms < 0) return "0:00";
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}
