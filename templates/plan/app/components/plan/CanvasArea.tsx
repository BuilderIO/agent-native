import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { IconMinus, IconPlus } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import type {
  PlanAnnotation,
  PlanAnnotationPlacement,
  PlanArtboard,
  PlanBlock,
  PlanBoardSection,
  PlanCanvasNote,
  PlanConnector,
  PlanContent,
  PlanWireframeSurface,
} from "@shared/plan-content";
import { Wireframe } from "./wireframe/Wireframe";

/* -------------------------------------------------------------------------- */
/* Pan / zoom feel — recovered from the on-main hardcoded renderer            */
/* (server/ui-plan-html.ts UI_PLAN_JS) + claude.ai/designs design-canvas.jsx. */
/* -------------------------------------------------------------------------- */

const DEFAULT_VIEW = { zoom: 0.72, pan: { x: 96, y: 64 } };
const MIN_ZOOM = 0.18;
const MAX_ZOOM = 2.4;
/** Notched mouse-wheel fixed-ratio step (design-canvas.jsx feel). */
const WHEEL_ZOOM_STEP = 0.16;
/** Trackpad pinch sensitivity. */
const PINCH_ZOOM_SENSITIVITY = 0.01;
/** Base CSS grid cell, scaled by zoom. */
const GRID_CELL = 28;

type CanvasView = typeof DEFAULT_VIEW;

/**
 * Spatial board. Geometry lives at THIS level on purpose — artboard placement,
 * annotation placement, and connector routing legitimately need positions. The
 * wireframe INTERNALS rendered inside each artboard are geometry-free (the
 * renderer lays them out with flex).
 *
 * Visual quality is owned entirely here: an infinite low-contrast grid that
 * moves on pan, cursor-anchored zoom at the right speed, wheel-pan, fixed 70vh,
 * artboard labels above each frame (zoom-invariant), designer annotations
 * spaced off the frames (no bordered/shadowed cards), routed connectors, and
 * small zoom controls bottom-left.
 */
export function CanvasArea({
  canvas,
  blockLookup,
}: {
  canvas: NonNullable<PlanContent["canvas"]>;
  blockLookup: Map<string, PlanBlock>;
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const initialView = useMemo<CanvasView>(
    () => ({
      zoom: clamp(
        canvas.viewport?.zoom ?? DEFAULT_VIEW.zoom,
        MIN_ZOOM,
        MAX_ZOOM,
      ),
      pan: {
        x: canvas.viewport?.pan?.x ?? DEFAULT_VIEW.pan.x,
        y: canvas.viewport?.pan?.y ?? DEFAULT_VIEW.pan.y,
      },
    }),
    [canvas.viewport?.pan?.x, canvas.viewport?.pan?.y, canvas.viewport?.zoom],
  );
  const [view, setView] = useState<CanvasView>(initialView);
  const [drag, setDrag] = useState<{
    pointerId: number;
    startX: number;
    startY: number;
    panX: number;
    panY: number;
  } | null>(null);

  const frames = useMemo(() => layoutArtboards(canvas.frames), [canvas.frames]);
  const frameById = useMemo(
    () => new Map(frames.map((frame) => [frame.id, frame])),
    [frames],
  );
  const sections = canvas.sections ?? [];
  const annotations = canvas.annotations ?? [];
  const legacyNotes = canvas.notes ?? [];
  const connectors = canvas.flow ?? [];

  useEffect(() => {
    setView(initialView);
  }, [initialView]);

  const board = useMemo(() => {
    const maxX = Math.max(
      1600,
      ...frames.map((frame) => (frame.x ?? 0) + (frame.width ?? DESK_W)),
      ...annotations.map((note) => (note.x ?? 0) + ANNOTATION_W),
      ...legacyNotes.map((note) => (note.x ?? 0) + ANNOTATION_W),
    );
    const maxY = Math.max(
      900,
      ...frames.map((frame) => (frame.y ?? 0) + (frame.height ?? DESK_H)),
      ...annotations.map((note) => (note.y ?? 0) + 160),
      ...legacyNotes.map((note) => (note.y ?? 0) + 160),
    );
    return { width: maxX + 360, height: maxY + 280 };
  }, [frames, annotations, legacyNotes]);

  const { zoom, pan } = view;
  const invZoom = 1 / zoom;

  const zoomAtAnchor = useCallback(
    (
      nextZoomFor: (currentZoom: number) => number,
      anchor?: { x: number; y: number },
    ) => {
      setView((current) => {
        const nextZoom = clamp(nextZoomFor(current.zoom), MIN_ZOOM, MAX_ZOOM);
        if (Math.abs(nextZoom - current.zoom) < 0.0001) return current;
        const rect = viewportRef.current?.getBoundingClientRect();
        const point =
          anchor ??
          (rect ? { x: rect.width / 2, y: rect.height / 2 } : { x: 0, y: 0 });
        // Keep the world point under the anchor fixed (cursor-anchored zoom).
        const worldX = (point.x - current.pan.x) / current.zoom;
        const worldY = (point.y - current.pan.y) / current.zoom;
        return {
          zoom: nextZoom,
          pan: {
            x: point.x - worldX * nextZoom,
            y: point.y - worldY * nextZoom,
          },
        };
      });
    },
    [],
  );
  const zoomByFactor = useCallback(
    (factor: number, anchor?: { x: number; y: number }) => {
      zoomAtAnchor((z) => z * factor, anchor);
    },
    [zoomAtAnchor],
  );

  // Wheel: cursor-over-canvas never scrolls the page. Notched wheel zooms with
  // a fixed ratio per click; ctrl/cmd/alt (or trackpad pinch) zoom at the
  // cursor; everything else pans.
  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const rect = element.getBoundingClientRect();
      const anchor = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };

      const lineScale =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? element.clientHeight
            : 1;
      const deltaX = event.deltaX * lineScale;
      const deltaY = event.deltaY * lineScale;

      // Notched mouse wheel: line-mode, or large integer pixel deltas with no
      // horizontal component (Chrome/Safari). Fixed-ratio step per click.
      const isNotchedWheel =
        event.deltaMode !== 0 ||
        (event.deltaX === 0 &&
          Number.isInteger(event.deltaY) &&
          Math.abs(event.deltaY) >= 40);

      if (event.ctrlKey || event.metaKey || event.altKey) {
        // Trackpad pinch / explicit zoom modifier — smooth exponential.
        zoomByFactor(Math.exp(-deltaY * PINCH_ZOOM_SENSITIVITY), anchor);
        return;
      }
      if (isNotchedWheel) {
        zoomByFactor(Math.exp(-Math.sign(deltaY) * WHEEL_ZOOM_STEP), anchor);
        return;
      }
      // Trackpad two-finger scroll → pan.
      setView((current) => ({
        ...current,
        pan: {
          x: current.pan.x - (deltaX || (event.shiftKey ? deltaY : 0)),
          y: current.pan.y - (event.shiftKey ? 0 : deltaY),
        },
      }));
    };

    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [zoomByFactor]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.button !== 1) return;
    const target = event.target as HTMLElement;
    // Don't start a pan when grabbing interactive chrome (zoom controls etc.).
    if (event.button === 0 && target.closest("[data-plan-interactive]")) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      panX: pan.x,
      panY: pan.y,
    });
  };

  return (
    <section
      className="plan-canvas relative h-[70vh] min-h-[520px] overflow-hidden border-b border-plan-line"
      aria-label="Plan artboard canvas"
    >
      <div
        ref={viewportRef}
        className="plan-canvas-viewport absolute inset-0 cursor-grab overflow-hidden active:cursor-grabbing"
        style={
          {
            backgroundPosition: `${pan.x}px ${pan.y}px`,
            backgroundSize: `${GRID_CELL * zoom}px ${GRID_CELL * zoom}px`,
            overscrollBehavior: "contain",
            touchAction: "none",
            "--dc-inv-zoom": invZoom,
          } as CSSProperties
        }
        onPointerDown={onPointerDown}
        onPointerMove={(event) => {
          if (!drag || drag.pointerId !== event.pointerId) return;
          event.preventDefault();
          setView((current) => ({
            ...current,
            pan: {
              x: drag.panX + event.clientX - drag.startX,
              y: drag.panY + event.clientY - drag.startY,
            },
          }));
        }}
        onPointerUp={(event) => {
          if (drag?.pointerId === event.pointerId) {
            event.currentTarget.releasePointerCapture(event.pointerId);
            setDrag(null);
          }
        }}
        onPointerCancel={() => setDrag(null)}
      >
        <div
          className="plan-canvas-world relative origin-top-left"
          style={{
            width: board.width,
            height: board.height,
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "0 0",
            willChange: "transform",
          }}
        >
          {sections.map((section) => (
            <CanvasSectionLabel
              key={section.id}
              section={section}
              frameById={frameById}
            />
          ))}

          {connectors.map((edge, index) => (
            <CanvasConnector
              key={`${edge.from}-${edge.to}-${index}`}
              edge={edge}
              frameById={frameById}
            />
          ))}

          {annotations.map((note) => (
            <CanvasAnnotationArrow
              key={`${note.id}-arrow`}
              note={note}
              frameById={frameById}
            />
          ))}
          {legacyNotes.map((note) => (
            <CanvasLegacyNoteArrow
              key={`${note.id}-arrow`}
              note={note}
              frameById={frameById}
            />
          ))}

          {frames.map((frame) => (
            <CanvasArtboard
              key={frame.id}
              frame={frame}
              block={frame.blockId ? blockLookup.get(frame.blockId) : undefined}
            />
          ))}

          {annotations.map((note) => (
            <CanvasAnnotation key={note.id} note={note} />
          ))}
          {legacyNotes.map((note) => (
            <CanvasAnnotation
              key={note.id}
              note={{
                id: note.id,
                title: note.title,
                text: note.body,
                targetId: note.arrowToFrameId,
                x: note.x,
                y: note.y,
              }}
            />
          ))}
        </div>
      </div>

      <div
        className="plan-canvas-zoom absolute bottom-4 left-4 z-10 flex origin-bottom-left items-center gap-1 rounded-lg border border-plan-line bg-plan-chrome p-1 shadow-lg backdrop-blur"
        style={{ transform: `scale(${invZoom})` }}
        data-plan-interactive
      >
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={() => zoomByFactor(1 / 1.2)}
          aria-label="Zoom out"
        >
          <IconMinus className="size-3.5" />
        </Button>
        <span className="min-w-12 text-center text-sm font-semibold tabular-nums">
          {Math.round(zoom * 100)}%
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={() => zoomByFactor(1.2)}
          aria-label="Zoom in"
        >
          <IconPlus className="size-3.5" />
        </Button>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Artboards                                                                  */
/* -------------------------------------------------------------------------- */

// Fixed-size static frames (never scroll regions) so wireframe compositions
// stay complete and dense. Surface presets mirror claude.ai/designs.
const DESK_W = 840;
const DESK_H = 520;
const PHONE_W = 300;
const PHONE_H = 624;
const POPOVER_W = 360;
const POPOVER_H = 360;
const PANEL_W = 420;
const PANEL_H = 560;
const BROWSER_W = 900;
const BROWSER_H = 560;
const ANNOTATION_W = 300;

const SURFACE_SIZE: Record<
  PlanWireframeSurface,
  { width: number; height: number }
> = {
  desktop: { width: DESK_W, height: DESK_H },
  browser: { width: BROWSER_W, height: BROWSER_H },
  mobile: { width: PHONE_W, height: PHONE_H },
  popover: { width: POPOVER_W, height: POPOVER_H },
  panel: { width: PANEL_W, height: PANEL_H },
};

function surfaceOf(frame: PlanArtboard): PlanWireframeSurface {
  return frame.surface ?? frame.wireframe?.surface ?? "desktop";
}

/**
 * Resolve placement for artboards. Geometry kept here on purpose. Frames with
 * explicit x/y are honored; the rest flow left→right by surface, wrapping wide
 * surfaces onto a second row and lining narrow surfaces up in a side column.
 */
function layoutArtboards(frames: PlanArtboard[]): PlanArtboard[] {
  let wideX = 96;
  let wideY = 96;
  let wideRowMaxH = 0;
  let narrowX = 0;
  const wideRowLimit = 2;
  let wideInRow = 0;

  return frames.map((frame) => {
    const surface = surfaceOf(frame);
    const preset = SURFACE_SIZE[surface];
    const width = frame.width ?? preset.width;
    const height = frame.height ?? preset.height;

    if (frame.x !== undefined || frame.y !== undefined) {
      return {
        ...frame,
        width,
        height,
        x: frame.x ?? 96,
        y: frame.y ?? 96,
      };
    }

    const isNarrow =
      surface === "mobile" || surface === "popover" || surface === "panel";
    if (isNarrow) {
      // Narrow surfaces stack in a column to the right of the wide flow.
      if (narrowX === 0) narrowX = 96;
      const x = narrowX;
      const y = 96;
      narrowX += width + 48;
      return { ...frame, width, height, x, y };
    }

    if (wideInRow >= wideRowLimit) {
      wideInRow = 0;
      wideX = 96;
      wideY += wideRowMaxH + 120;
      wideRowMaxH = 0;
    }
    const x = wideX;
    const y = wideY;
    wideX += width + 96;
    wideInRow += 1;
    wideRowMaxH = Math.max(wideRowMaxH, height);
    // Push the narrow column past the widest wide row.
    narrowX = Math.max(narrowX, x + width + 96);
    return { ...frame, width, height, x, y };
  });
}

function CanvasArtboard({
  frame,
  block,
}: {
  frame: PlanArtboard;
  block?: PlanBlock;
}) {
  const surface = surfaceOf(frame);
  const preset = SURFACE_SIZE[surface];
  const width = frame.width ?? preset.width;
  const height = frame.height ?? preset.height;
  const label = frame.label ?? block?.title;

  // Prefer the inline kit-tree wireframe; fall back to the legacy region shape
  // (kept for old / imported plans). Pull from the referenced block if the
  // frame itself doesn't carry inline data.
  const kitData =
    frame.wireframe ?? (block?.type === "wireframe" ? block.data : undefined);
  const legacyData =
    frame.legacyWireframe ??
    (block?.type === "legacy-wireframe" ? block.data : undefined);

  return (
    <div
      className="absolute"
      data-canvas-frame={frame.id}
      style={{ left: frame.x ?? 96, top: frame.y ?? 96, width }}
    >
      {label && (
        <div
          className="plan-artboard-label pointer-events-none absolute bottom-full left-0 origin-bottom-left pb-2 text-sm font-semibold text-plan-text"
          style={{
            transform: "scale(var(--dc-inv-zoom, 1))",
            transformOrigin: "bottom left",
          }}
        >
          {label}
        </div>
      )}
      <div className="plan-artboard-frame" style={{ height }}>
        {kitData ? (
          // The kit-tree wireframe renderer ({ surface, screen }) is owned by
          // the wireframe module; CanvasArea only supplies fixed-size framing.
          // The surface preset lives inside the kit-tree data so the renderer
          // reads it from `data.surface`.
          <Wireframe
            data={kitData as unknown as Parameters<typeof Wireframe>[0]["data"]}
            canvasSize={height}
          />
        ) : legacyData ? (
          <Wireframe data={legacyData} canvasSize={height} />
        ) : (
          <div className="plan-artboard-empty" style={{ height }} />
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Sections                                                                   */
/* -------------------------------------------------------------------------- */

function CanvasSectionLabel({
  section,
  frameById,
}: {
  section: PlanBoardSection;
  frameById: Map<string, PlanArtboard>;
}) {
  const ids = section.artboardIds ?? [];
  const members = ids
    .map((id) => frameById.get(id))
    .filter((frame): frame is PlanArtboard => Boolean(frame));
  if (members.length === 0) return null;
  const left = Math.min(...members.map((frame) => frame.x ?? 96));
  const top = Math.min(...members.map((frame) => frame.y ?? 96));

  return (
    <div
      className="plan-canvas-section pointer-events-none absolute origin-bottom-left"
      style={{
        left,
        top: top - 78,
        transform: "scale(var(--dc-inv-zoom, 1))",
        transformOrigin: "bottom left",
      }}
    >
      {section.title && (
        <p className="text-2xl font-semibold tracking-[-0.01em] text-plan-text">
          {section.title}
        </p>
      )}
      {section.subtitle && (
        <p className="mt-1 text-base text-plan-muted">{section.subtitle}</p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Annotations — plain text layers on the board; NO bordered/shadowed cards   */
/* -------------------------------------------------------------------------- */

function CanvasAnnotation({ note }: { note: PlanAnnotation }) {
  const bullets = parseBullets(note.text);
  return (
    <div
      className="plan-canvas-annotation absolute max-w-[300px] text-sm leading-6 text-plan-muted"
      style={{ left: note.x ?? 80, top: note.y ?? 80 }}
    >
      {note.title && (
        <p className="mb-1.5 text-[0.95rem] font-semibold text-plan-text">
          {note.title}
        </p>
      )}
      {bullets ? (
        <ul className="ml-4 list-disc space-y-1">
          {bullets.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      ) : (
        <p>{note.text}</p>
      )}
    </div>
  );
}

/** Split a leading prose line + "- " bulleted lines into title text + list. */
function parseBullets(text: string): string[] | null {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const bulletLines = lines.filter((line) => /^[-*•]\s+/.test(line));
  if (bulletLines.length < 2 || bulletLines.length !== lines.length) {
    return null;
  }
  return bulletLines.map((line) => line.replace(/^[-*•]\s+/, ""));
}

/* -------------------------------------------------------------------------- */
/* Arrows + connectors — routed at the BOARD level (geometry kept on purpose) */
/* -------------------------------------------------------------------------- */

function anchorPoint(
  frame: PlanArtboard,
  placement: PlanAnnotationPlacement | undefined,
) {
  const x = frame.x ?? 96;
  const y = frame.y ?? 96;
  const w = frame.width ?? DESK_W;
  const h = frame.height ?? DESK_H;
  const cx = x + w / 2;
  const cy = y + h / 2;
  switch (placement) {
    case "top":
      return { x: cx, y };
    case "bottom":
      return { x: cx, y: y + h };
    case "left":
      return { x, y: cy };
    case "right":
      return { x: x + w, y: cy };
    case "top-left":
      return { x, y };
    case "top-right":
      return { x: x + w, y };
    case "bottom-left":
      return { x, y: y + h };
    case "bottom-right":
      return { x: x + w, y: y + h };
    default:
      return { x: cx, y: cy };
  }
}

function ArrowSvg({
  fromX,
  fromY,
  toX,
  toY,
  id,
}: {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  id: string;
}) {
  const left = Math.min(fromX, toX) - 16;
  const top = Math.min(fromY, toY) - 16;
  const width = Math.abs(toX - fromX) + 32;
  const height = Math.abs(toY - fromY) + 32;
  const sx = fromX - left;
  const sy = fromY - top;
  const ex = toX - left;
  const ey = toY - top;
  const horizontal = Math.abs(toX - fromX) >= Math.abs(toY - fromY);
  const c1x = horizontal ? sx + (ex - sx) / 2 : sx;
  const c1y = horizontal ? sy : sy + (ey - sy) / 2;
  const c2x = horizontal ? ex - (ex - sx) / 2 : ex;
  const c2y = horizontal ? ey : ey - (ey - sy) / 2;
  return (
    <svg
      className="pointer-events-none absolute overflow-visible"
      style={{ left, top, width, height }}
      viewBox={`0 0 ${width} ${height}`}
    >
      <defs>
        <marker
          id={id}
          markerHeight="8"
          markerWidth="8"
          orient="auto"
          refX="6"
          refY="4"
          viewBox="0 0 8 8"
        >
          <path d="M 0 0 L 8 4 L 0 8 z" fill="hsl(var(--ring))" />
        </marker>
      </defs>
      <path
        d={`M ${sx} ${sy} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${ex} ${ey}`}
        fill="none"
        markerEnd={`url(#${id})`}
        stroke="hsl(var(--ring))"
        strokeDasharray="7 6"
        strokeLinecap="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function CanvasAnnotationArrow({
  note,
  frameById,
}: {
  note: PlanAnnotation;
  frameById: Map<string, PlanArtboard>;
}) {
  if (!note.targetId) return null;
  const frame = frameById.get(note.targetId);
  if (!frame) return null;
  // Arrow only when an annotation points at a specific spot. Start from the
  // note's anchor box edge nearest the target.
  const target = anchorPoint(frame, note.placement);
  const noteX = note.x ?? 80;
  const noteY = note.y ?? 80;
  const start = {
    x: noteX + ANNOTATION_W / 2,
    y: noteY + 18,
  };
  return (
    <ArrowSvg
      fromX={start.x}
      fromY={start.y}
      toX={target.x}
      toY={target.y}
      id={`annotation-arrow-${note.id}`}
    />
  );
}

function CanvasLegacyNoteArrow({
  note,
  frameById,
}: {
  note: PlanCanvasNote;
  frameById: Map<string, PlanArtboard>;
}) {
  if (!note.arrowToFrameId) return null;
  const frame = frameById.get(note.arrowToFrameId);
  if (!frame) return null;
  const target = anchorPoint(frame, undefined);
  const noteX = note.x ?? 80;
  const noteY = note.y ?? 80;
  return (
    <ArrowSvg
      fromX={noteX + ANNOTATION_W / 2}
      fromY={noteY + 18}
      toX={target.x}
      toY={target.y}
      id={`legacy-note-arrow-${note.id}`}
    />
  );
}

function CanvasConnector({
  edge,
  frameById,
}: {
  edge: PlanConnector;
  frameById: Map<string, PlanArtboard>;
}) {
  const from = frameById.get(edge.from);
  const to = frameById.get(edge.to);
  if (!from || !to) return null;

  const fromX = (from.x ?? 0) + (from.width ?? DESK_W) + 24;
  const fromY = (from.y ?? 0) + (from.height ?? DESK_H) / 2;
  const toX = (to.x ?? 0) - 24;
  const toY = (to.y ?? 0) + (to.height ?? DESK_H) / 2;
  const left = Math.min(fromX, toX);
  const top = Math.min(fromY, toY);
  const width = Math.abs(toX - fromX) || 1;
  const height = Math.abs(toY - fromY) || 1;

  return (
    <svg
      className="pointer-events-none absolute overflow-visible"
      style={{ left, top, width, height }}
      viewBox={`0 0 ${width} ${height}`}
    >
      <path
        d={`M ${fromX - left} ${fromY - top} C ${width / 2} ${fromY - top}, ${width / 2} ${toY - top}, ${toX - left} ${toY - top}`}
        fill="none"
        stroke="hsl(var(--ring))"
        strokeDasharray="9 7"
        strokeLinecap="round"
        strokeWidth="2.6"
      />
      {edge.label && (
        <text
          x={width / 2}
          y={height / 2 - 8}
          textAnchor="middle"
          className="fill-[hsl(var(--ring))] text-[15px] font-semibold"
        >
          {edge.label}
        </text>
      )}
    </svg>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
