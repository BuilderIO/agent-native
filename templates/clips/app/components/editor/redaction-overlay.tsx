import { useT } from "@agent-native/core/client/i18n";
import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import {
  MOSAIC_PALETTE,
  streakUnitPx,
  MIN_REDACTION_SIZE,
  normalizeRect,
  redactionRectAt,
  isRedactionActiveAt,
  type RedactionRect,
  type RedactionStyle,
  type VideoRedaction,
} from "@/lib/video-redactions";

export interface RedactionOverlayProps {
  redactions: VideoRedaction[];
  playheadMs: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onDraw: (rect: RedactionRect) => void;
  onReshape: (id: string, rect: RedactionRect) => void;
  drawing: boolean;
  newStyle: RedactionStyle;
  videoWidth: number;
  videoHeight: number;
  className?: string;
}

type Gesture =
  | { kind: "draw"; fromX: number; fromY: number }
  | {
      kind: "move";
      id: string;
      grabX: number;
      grabY: number;
      rect: RedactionRect;
    }
  | { kind: "resize"; id: string; anchorX: number; anchorY: number };

export function pictureRect(
  box: { width: number; height: number },
  videoWidth: number,
  videoHeight: number,
): { left: number; top: number; width: number; height: number } {
  if (!(videoWidth > 0 && videoHeight > 0 && box.width > 0 && box.height > 0)) {
    return { left: 0, top: 0, width: box.width, height: box.height };
  }
  const scale = Math.min(box.width / videoWidth, box.height / videoHeight);
  const width = videoWidth * scale;
  const height = videoHeight * scale;
  return {
    left: (box.width - width) / 2,
    top: (box.height - height) / 2,
    width,
    height,
  };
}

const STREAK_TILE_COLS = 12;
const STREAK_TILE_ROWS = 12;
const streakTileUrl = (() => {
  let state = 0x2f6f6b;
  const next = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const rects: string[] = [];
  for (let y = 0; y < STREAK_TILE_ROWS; y += 1) {
    for (let x = 0; x < STREAK_TILE_COLS; x += 1) {
      const hex =
        MOSAIC_PALETTE[Math.floor(next() * MOSAIC_PALETTE.length)].slice(1);
      rects.push(
        `<rect x='${x * 3}' y='${y}' width='3' height='1' fill='%23${hex}'/>`,
      );
    }
  }
  return `url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='${STREAK_TILE_COLS * 3}' height='${STREAK_TILE_ROWS}' viewBox='0 0 ${STREAK_TILE_COLS * 3} ${STREAK_TILE_ROWS}' shape-rendering='crispEdges'>${rects.join("")}</svg>")`;
})();

export function RedactionOverlay({
  redactions,
  playheadMs,
  selectedId,
  onSelect,
  onDraw,
  onReshape,
  drawing,
  newStyle,
  videoWidth,
  videoHeight,
  className,
}: RedactionOverlayProps) {
  const t = useT();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const [preview, setPreview] = useState<{
    id: string | null;
    rect: RedactionRect;
  } | null>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const rect = entry.contentRect;
      setBox({ width: rect.width, height: rect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const frame = pictureRect(box, videoWidth, videoHeight);

  const toPicture = useCallback(
    (clientX: number, clientY: number) => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      const picture = pictureRect(rect, videoWidth, videoHeight);
      return {
        x: clamp01(
          (clientX - rect.left - picture.left) / Math.max(picture.width, 1),
        ),
        y: clamp01(
          (clientY - rect.top - picture.top) / Math.max(picture.height, 1),
        ),
      };
    },
    [videoHeight, videoWidth],
  );

  const handleMove = (e: React.PointerEvent) => {
    const gesture = gestureRef.current;
    if (!gesture) return;
    const at = toPicture(e.clientX, e.clientY);

    if (gesture.kind === "draw") {
      setPreview({
        id: null,
        rect: rectBetween(gesture.fromX, gesture.fromY, at.x, at.y),
      });
      return;
    }
    if (gesture.kind === "resize") {
      setPreview({
        id: gesture.id,
        rect: rectBetween(gesture.anchorX, gesture.anchorY, at.x, at.y),
      });
      return;
    }
    setPreview({
      id: gesture.id,
      rect: normalizeRect({
        ...gesture.rect,
        x: at.x - gesture.grabX,
        y: at.y - gesture.grabY,
      }),
    });
  };

  const endGesture = (commit: boolean) => {
    const gesture = gestureRef.current;
    const shape = preview;
    gestureRef.current = null;
    setPreview(null);
    if (!commit) return;
    if (!gesture || !shape) return;
    if (
      shape.rect.w < MIN_REDACTION_SIZE ||
      shape.rect.h < MIN_REDACTION_SIZE
    ) {
      return;
    }
    if (gesture.kind === "draw") onDraw(shape.rect);
    else onReshape(gesture.id, shape.rect);
  };

  const begin = (e: React.PointerEvent, gesture: Gesture) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    rootRef.current?.setPointerCapture?.(e.pointerId);
    gestureRef.current = gesture;
  };

  const showing = redactions.filter((r) => isRedactionActiveAt(r, playheadMs));
  const previewBlockPx = Math.max(
    3,
    Math.round(
      (streakUnitPx(videoWidth) * frame.width) / Math.max(videoWidth, 1),
    ),
  );
  const streakFill = (
    <span
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: `-${Math.round(previewBlockPx * 1.5)}px`,
        backgroundColor: MOSAIC_PALETTE[3],
        backgroundImage: streakTileUrl,
        backgroundSize: `${previewBlockPx * 3 * STREAK_TILE_COLS}px ${previewBlockPx * STREAK_TILE_ROWS}px`,
        filter: `blur(${previewBlockPx}px)`,
      }}
    />
  );
  return (
    <div
      ref={rootRef}
      className={cn(
        "absolute inset-0",
        drawing ? "cursor-crosshair" : "pointer-events-none",
        className,
      )}
      onPointerDown={(e) => {
        if (!drawing) return;
        const at = toPicture(e.clientX, e.clientY);
        onSelect(null);
        begin(e, { kind: "draw", fromX: at.x, fromY: at.y });
      }}
      onPointerMove={handleMove}
      onPointerUp={() => endGesture(true)}
      onPointerCancel={() => endGesture(false)}
    >
      <div
        className="absolute"
        style={{
          left: frame.left,
          top: frame.top,
          width: frame.width,
          height: frame.height,
        }}
      >
        {showing.map((redaction) => {
          const live =
            preview && preview.id === redaction.id
              ? preview.rect
              : redactionRectAt(redaction, playheadMs);
          const selected = redaction.id === selectedId;
          return (
            <div
              key={redaction.id}
              role="button"
              tabIndex={-1}
              aria-pressed={selected}
              aria-label={t("redaction.box")}
              className={cn(
                "absolute",
                redaction.style === "solid"
                  ? // guard:allow-raw-color — the preview shows what the burn writes into the file, not themed UI.
                    "bg-[#0b0f19]"
                  : undefined,
                "pointer-events-auto",
                "cursor-move",
                selected
                  ? "outline outline-2 outline-amber-400"
                  : "outline outline-1 outline-white/40",
              )}
              style={{
                ...framePercent(live),
                overflow: "hidden",
                // guard:allow-raw-color — the border the burn draws, shown as it will be.
                border: "2px solid #8a9099",
              }}
              onPointerDown={(e) => {
                const at = toPicture(e.clientX, e.clientY);
                onSelect(redaction.id);
                begin(e, {
                  kind: "move",
                  id: redaction.id,
                  grabX: at.x - live.x,
                  grabY: at.y - live.y,
                  rect: live,
                });
              }}
            >
              {redaction.style === "solid" ? null : streakFill}
              {selected ? (
                <>
                  {/*
                  A corner at each end, because a box that can only grow from
                  its bottom-right cannot be extended upwards without being
                  dragged and redrawn. Each corner resizes against the opposite
                  one, which stays put.
                */}
                  <div
                    role="button"
                    tabIndex={-1}
                    aria-label={t("redaction.resizeTopLeft")}
                    className="absolute -left-1 -top-1 h-3 w-3 cursor-nwse-resize rounded-sm bg-amber-400"
                    onPointerDown={(e) =>
                      begin(e, {
                        kind: "resize",
                        id: redaction.id,
                        anchorX: live.x + live.w,
                        anchorY: live.y + live.h,
                      })
                    }
                  />
                  <div
                    role="button"
                    tabIndex={-1}
                    aria-label={t("redaction.resize")}
                    className="absolute -bottom-1 -right-1 h-3 w-3 cursor-nwse-resize rounded-sm bg-amber-400"
                    onPointerDown={(e) =>
                      begin(e, {
                        kind: "resize",
                        id: redaction.id,
                        anchorX: live.x,
                        anchorY: live.y,
                      })
                    }
                  />
                </>
              ) : null}
            </div>
          );
        })}

        {preview && preview.id === null ? (
          <div
            className={cn(
              "absolute outline outline-2 outline-amber-400",
              // guard:allow-raw-color — as above: the burn's own colour.
              newStyle === "solid" ? "bg-[#0b0f19]" : undefined,
            )}
            style={{
              ...framePercent(preview.rect),
              overflow: "hidden",
              // guard:allow-raw-color — the border the burn draws, shown as it will be.
              border: "2px solid #8a9099",
            }}
          >
            {newStyle === "solid" ? null : streakFill}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function rectBetween(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): RedactionRect {
  return normalizeRect({
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    w: Math.abs(x2 - x1),
    h: Math.abs(y2 - y1),
  });
}

function framePercent(rect: RedactionRect): React.CSSProperties {
  return {
    left: `${rect.x * 100}%`,
    top: `${rect.y * 100}%`,
    width: `${rect.w * 100}%`,
    height: `${rect.h * 100}%`,
  };
}
