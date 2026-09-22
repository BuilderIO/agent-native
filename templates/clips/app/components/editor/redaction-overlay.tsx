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

/**
 * The redaction boxes, drawn over the video preview.
 *
 * This is a preview and nothing more — the file underneath still has every
 * pixel until the burn runs, which is why the editor says so out loud rather
 * than letting a black box imply the job is done.
 *
 * Boxes are positioned against the *picture*, not the player: a video is
 * letterboxed inside its box by `object-contain`, so the overlay measures
 * where the frame actually lands and lays itself over that. Get this wrong and
 * every redaction is burned in a slightly different place than it was drawn.
 */

export interface RedactionOverlayProps {
  redactions: VideoRedaction[];
  /** Original-time playhead: which boxes are showing, and where they sit. */
  playheadMs: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** A box was drawn from scratch. */
  onDraw: (rect: RedactionRect) => void;
  /** A box was moved or resized — becomes a waypoint at the playhead. */
  onReshape: (id: string, rect: RedactionRect) => void;
  /** True while the Redact tool is armed, which is when a drag draws a box. */
  drawing: boolean;
  /** What a box drawn now will be: a mosaic, or a solid fill. */
  newStyle: RedactionStyle;
  /** The video's own aspect ratio, for laying the overlay over the picture. */
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

/** Where the picture actually sits inside a letterboxed player. */
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

/**
 * A tile of random blocks, used to preview a mosaic before it is burned.
 *
 * The burn lays down wide random blocks and smears them sideways, so the
 * preview does the same: a tile of 3:1 blocks from the same palette, blurred by
 * about a block's height. Built once at module load — it only has to read like
 * the burn, not to match the blocks the burn will generate, which come from a
 * seed it picks at the time.
 */
const STREAK_TILE_COLS = 12;
const STREAK_TILE_ROWS = 12;
const streakTileUrl = (() => {
  // Deterministic rather than `Math.random()`: this module is evaluated on the
  // server too, and a tile that differs between the server's render and the
  // browser's is a hydration mismatch. The burn picks its own seed at the time;
  // the preview only has to look like one.
  let state = 0x2f6f6b;
  const next = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const rects: string[] = [];
  for (let y = 0; y < STREAK_TILE_ROWS; y += 1) {
    for (let x = 0; x < STREAK_TILE_COLS; x += 1) {
      // The same palette the burn draws from, so the preview is the real thing
      // in miniature rather than an impression of it.
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
  // The player's own size, watched rather than read once: the preview pane
  // resizes with the window, the sidebar and the chapters panel.
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

  /** Pointer position as a fraction of the picture, not of the player. */
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

  /**
   * `commit` is false for a cancelled pointer. A cancel is the browser taking
   * the gesture away, not a release, so the half-drawn box is thrown away
   * rather than saved as a redaction nobody finished placing.
   */
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
  // The burn's block size, scaled from the picture down to the preview, so a
  // block looks here the size it will be in the file.
  // A streak's height on screen: what it will be in the file, scaled down to
  // the preview.
  const previewBlockPx = Math.max(
    3,
    Math.round(
      (streakUnitPx(videoWidth) * frame.width) / Math.max(videoWidth, 1),
    ),
  );
  // The blur goes on a child, not on the box: a CSS filter applies to the
  // border too, and the border is the one part that has to stay sharp.
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
                // Always grabbable, even with the draw tool off — moving a box
                // you can see is the obvious gesture.
                "pointer-events-auto",
                "cursor-move",
                selected
                  ? "outline outline-2 outline-amber-400"
                  : "outline outline-1 outline-white/40",
              )}
              // The preview draws the redaction itself rather than blurring what
              // is underneath. The burn does not build it out of the picture, so
              // a blurred preview would be showing the editor something the
              // stored file will not contain — and where the blur did not apply,
              // the wash behind it read as a black box.
              style={{
                ...framePercent(live),
                overflow: "hidden",
                // guard:allow-raw-color — the border the burn draws, shown as it will be.
                border: "2px solid #8a9099",
              }}
              // A drag that starts on a box moves that box, tool armed or not:
              // the cursor says move, so it has to move. A new box is drawn by
              // starting somewhere the picture is not already covered.
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

/**
 * Percentages of the picture element, which is laid over the frame itself and
 * not over the letterbox bars. That is what keeps a box drawn on a small
 * preview landing in the same place when it is burned at full resolution.
 */
function framePercent(rect: RedactionRect): React.CSSProperties {
  return {
    left: `${rect.x * 100}%`,
    top: `${rect.y * 100}%`,
    width: `${rect.w * 100}%`,
    height: `${rect.h * 100}%`,
  };
}
