import { useT } from "@agent-native/core/client";
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
import { IconMinus, IconPlus } from "@tabler/icons-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

import { Wireframe, type DesignElementSelection } from "./wireframe/Wireframe";

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
/** Extra world-space grid on each side so the grid still fills overscrolled pans. */
const GRID_PADDING = 5000;

type CanvasView = typeof DEFAULT_VIEW;
export type CanvasViewport = CanvasView;
export type CanvasMarkupMode = "none" | "comment" | "text" | "callout";

type CanvasMarkupAnnotationInput = Omit<PlanAnnotation, "id">;

export type CanvasMarkupCreateContext = {
  anchor: {
    x: number;
    y: number;
    anchorKind: "visual";
    visualLabel?: string;
    visualX: number;
    visualY: number;
    canvasX: number;
    canvasY: number;
    canvasWidth?: number;
    canvasHeight?: number;
    markupType: "text" | "callout";
  };
};

export type { DesignElementSelection };

type WorldPoint = {
  x: number;
  y: number;
};

type PendingMarkup = {
  mode: "text" | "callout";
  origin: WorldPoint;
  points?: [WorldPoint, WorldPoint];
};

type DraftCallout = {
  pointerId: number;
  start: WorldPoint;
  current: WorldPoint;
};

/**
 * Spatial board. Geometry lives at THIS level on purpose — artboard placement,
 * annotation placement, and connector routing legitimately need positions. The
 * wireframe INTERNALS rendered inside each artboard are geometry-free (the
 * renderer lays them out with flex).
 *
 * Visual quality is owned entirely here: an infinite low-contrast grid that
 * moves on pan, cursor-anchored zoom at the right speed, wheel-pan, fixed 65vh,
 * artboard labels above each frame (zoom-invariant), designer annotations
 * spaced off the frames (no bordered/shadowed cards), routed connectors, and
 * small zoom controls bottom-left.
 */
export function CanvasArea({
  canvas,
  blockLookup,
  markupMode = "none",
  onCanvasMarkupCreate,
  onViewportChange,
  onCommentShortcut,
  selectedDesignElementKey,
  onDesignElementSelect,
}: {
  canvas: NonNullable<PlanContent["canvas"]>;
  blockLookup: Map<string, PlanBlock>;
  markupMode?: CanvasMarkupMode;
  onCanvasMarkupCreate?: (
    annotation: CanvasMarkupAnnotationInput,
    context: CanvasMarkupCreateContext,
  ) => Promise<void> | void;
  onViewportChange?: (view: CanvasViewport) => void;
  onCommentShortcut?: () => void;
  selectedDesignElementKey?: string | null;
  onDesignElementSelect?: (selection: DesignElementSelection) => void;
}) {
  const t = useT();
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
  const [draftCallout, setDraftCallout] = useState<DraftCallout | null>(null);
  const [pendingMarkup, setPendingMarkup] = useState<PendingMarkup | null>(
    null,
  );
  const [savingMarkup, setSavingMarkup] = useState(false);
  // Real rendered heights, reported by each artboard. Frames are content-sized
  // (maxHeight + auto height), so the declared preset height usually overshoots;
  // connectors must route off the measured box or arrows float below the frame.
  const [frameHeights, setFrameHeights] = useState<Map<string, number>>(
    () => new Map(),
  );
  const latestViewportChangeRef = useRef<CanvasViewport>(initialView);
  const viewportChangeFrameRef = useRef<number | null>(null);
  // Kept current each render so the central pan clamp (in updateView) can read
  // the live board size without widening updateView's dependencies.
  const boardRef = useRef({ width: 0, height: 0 });
  const queueViewportChange = useCallback(
    (nextView: CanvasViewport) => {
      latestViewportChangeRef.current = nextView;
      if (!onViewportChange || typeof window === "undefined") return;
      if (viewportChangeFrameRef.current !== null) return;
      viewportChangeFrameRef.current = window.requestAnimationFrame(() => {
        viewportChangeFrameRef.current = null;
        onViewportChange(latestViewportChangeRef.current);
      });
    },
    [onViewportChange],
  );
  const updateView = useCallback(
    (resolve: (current: CanvasView) => CanvasView) => {
      setView((current) => {
        const next = clampPanToGrid(
          resolve(current),
          boardRef.current,
          viewportRef.current?.getBoundingClientRect() ?? null,
        );
        if (sameCanvasView(current, next)) return current;
        queueViewportChange(next);
        return next;
      });
    },
    [queueViewportChange],
  );
  useEffect(
    () => () => {
      if (viewportChangeFrameRef.current !== null) {
        window.cancelAnimationFrame(viewportChangeFrameRef.current);
        viewportChangeFrameRef.current = null;
      }
    },
    [],
  );
  const reportFrameHeight = useCallback((id: string, height: number) => {
    setFrameHeights((prev) => {
      if (Math.abs((prev.get(id) ?? 0) - height) < 1) return prev;
      const next = new Map(prev);
      next.set(id, height);
      return next;
    });
  }, []);

  // Skip label-only artboards (no inline wireframe, no legacy region data, and
  // no blockId resolving to a wireframe block). They render as empty dashed
  // boxes and waste layout space, so they never reach the board at all.
  const frames = useMemo(
    () =>
      layoutArtboards(
        canvas.frames.filter((frame) => frameHasContent(frame, blockLookup)),
      ),
    [canvas.frames, blockLookup],
  );
  const frameById = useMemo(
    () => new Map(frames.map((frame) => [frame.id, frame])),
    [frames],
  );
  // frameById with each frame's declared height overridden by its measured
  // height, so connectors/anchors track the real (content) box.
  const measuredFrameById = useMemo(() => {
    const map = new Map<string, PlanArtboard>();
    for (const frame of frames) {
      const measured = frameHeights.get(frame.id);
      map.set(frame.id, measured ? { ...frame, height: measured } : frame);
    }
    return map;
  }, [frames, frameHeights]);
  const frameLayoutKey = useMemo(
    () => canvasFrameLayoutKey(canvas.mode, frames),
    [canvas.mode, frames],
  );
  const sections = canvas.sections ?? [];
  const annotations = canvas.annotations ?? [];
  const legacyNotes = canvas.notes ?? [];
  const connectors = canvas.flow ?? [];

  // Group annotations by the frame they target so they render attached to that
  // frame (tracking its real content height); the rest float by x/y.
  const annsByFrame = useMemo(() => {
    const byFrame = new Map<string, PlanAnnotation[]>();
    const loose: PlanAnnotation[] = [];
    for (const note of annotations) {
      if (
        note.targetId &&
        frameById.has(note.targetId) &&
        !isCanvasMarkupAnnotation(note)
      ) {
        const list = byFrame.get(note.targetId) ?? [];
        list.push(note);
        byFrame.set(note.targetId, list);
      } else {
        loose.push(note);
      }
    }
    return { byFrame, loose };
  }, [annotations, frameById]);

  // Resolve every annotation's board position once with flex auto-layout, so
  // anchored notes flow down a per-side gutter column beside the measured frame
  // and never overlap by construction. Both the text layer and its arrow read
  // from this map, so the arrow always connects the rendered box to the frame.
  const resolvedAnnotations = useMemo(
    () =>
      layoutAnnotations(
        annsByFrame.byFrame,
        annsByFrame.loose,
        measuredFrameById,
      ),
    [annsByFrame, measuredFrameById],
  );

  // Section container rects: union of each section's measured member frames,
  // padded, computed once so the container and any snap/clamp arrow share the
  // same box. Sections with no resolvable members are dropped.
  const sectionRects = useMemo(
    () =>
      sections
        .map((section) => ({
          section,
          rect: sectionRect(section, measuredFrameById),
        }))
        .filter(
          (
            entry,
          ): entry is { section: PlanBoardSection; rect: AnnotationRect } =>
            entry.rect !== null,
        ),
    [sections, measuredFrameById],
  );

  // Boxes a point-arrow / callout endpoint can snap-clamp to: every measured
  // artboard plus every section container. Ordered frames-first so a tip inside
  // a section still prefers the nearer artboard edge.
  const snapTargets = useMemo<AnnotationRect[]>(
    () => [
      ...Array.from(measuredFrameById.values()).map(frameRect),
      ...sectionRects.map((entry) => entry.rect),
    ],
    [measuredFrameById, sectionRects],
  );

  const hasSavedViewport = Boolean(
    canvas.viewport?.zoom !== undefined ||
    canvas.viewport?.pan?.x !== undefined ||
    canvas.viewport?.pan?.y !== undefined,
  );
  const savedViewportKey = `${canvas.viewport?.zoom ?? ""}:${
    canvas.viewport?.pan?.x ?? ""
  }:${canvas.viewport?.pan?.y ?? ""}`;
  const lastAppliedSavedViewportKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!hasSavedViewport) return;
    if (lastAppliedSavedViewportKeyRef.current === savedViewportKey) return;
    lastAppliedSavedViewportKeyRef.current = savedViewportKey;
    updateView(() => initialView);
  }, [hasSavedViewport, initialView, savedViewportKey, updateView]);

  const board = useMemo(() => {
    const maxX = Math.max(
      1600,
      ...frames.map((frame) => (frame.x ?? 0) + (frame.width ?? DESK_W)),
      ...annotations.map((note) => (note.x ?? 0) + ANNOTATION_W),
      ...annotations.flatMap((note) =>
        (note.points ?? []).map((point) => point.x + ANNOTATION_W),
      ),
      ...legacyNotes.map((note) => (note.x ?? 0) + ANNOTATION_W),
    );
    const maxY = Math.max(
      900,
      ...frames.map((frame) => (frame.y ?? 0) + (frame.height ?? DESK_H)),
      ...annotations.map((note) => (note.y ?? 0) + 160),
      ...annotations.flatMap((note) =>
        (note.points ?? []).map((point) => point.y + 160),
      ),
      ...legacyNotes.map((note) => (note.y ?? 0) + 160),
    );
    return { width: maxX + 360, height: maxY + 280 };
  }, [frames, annotations, legacyNotes]);
  boardRef.current = board;

  const lastAutoFitKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (hasSavedViewport) return;
    if (lastAutoFitKeyRef.current === frameLayoutKey) return;
    const element = viewportRef.current;
    if (!element || frames.length === 0) return;
    // Center the whole content on first view, regardless of canvas mode. The
    // bounding box of every frame is fit to the viewport (capped at the default
    // zoom) and centered horizontally, so plans open with their items centered
    // instead of pinned to the left by DEFAULT_VIEW.pan.x.
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const frame of frames) {
      const surface = surfaceOf(frame);
      const width = frame.width ?? SURFACE_SIZE[surface].width;
      const height = frame.height ?? SURFACE_SIZE[surface].height;
      const x = frame.x ?? 96;
      const y = frame.y ?? 96;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x + width > maxX) maxX = x + width;
      if (y + height > maxY) maxY = y + height;
    }
    const contentWidth = maxX - minX;
    const contentHeight = maxY - minY;
    const margin = 48;
    const zoom = clamp(
      Math.min(
        DEFAULT_VIEW.zoom,
        (element.clientWidth - margin * 2) / contentWidth,
        (element.clientHeight - margin * 2) / contentHeight,
      ),
      MIN_ZOOM,
      MAX_ZOOM,
    );
    const nextView = {
      zoom,
      pan: {
        x: (element.clientWidth - contentWidth * zoom) / 2 - minX * zoom,
        y: Math.max(
          24,
          (element.clientHeight - contentHeight * zoom) / 2 - minY * zoom,
        ),
      },
    };
    updateView(() => nextView);
    lastAutoFitKeyRef.current = frameLayoutKey;
  }, [frameLayoutKey, frames, hasSavedViewport, updateView]);

  const { zoom, pan } = view;
  const worldTransform = `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`;
  useEffect(() => {
    queueViewportChange(view);
  }, [queueViewportChange, view]);
  const isCanvasMarkupMode =
    (markupMode === "text" || markupMode === "callout") &&
    Boolean(onCanvasMarkupCreate);
  const reviewCursor = isCanvasMarkupMode || markupMode === "comment";

  const zoomAtAnchor = useCallback(
    (
      nextZoomFor: (currentZoom: number) => number,
      anchor?: { x: number; y: number },
    ) => {
      updateView((current) => {
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
    [updateView],
  );
  const zoomByFactor = useCallback(
    (factor: number, anchor?: { x: number; y: number }) => {
      zoomAtAnchor((z) => z * factor, anchor);
    },
    [zoomAtAnchor],
  );
  const resetZoom = useCallback(() => {
    zoomAtAnchor(() => 1);
  }, [zoomAtAnchor]);

  useEffect(() => {
    if (isCanvasMarkupMode) return;
    setDraftCallout(null);
    setPendingMarkup(null);
  }, [isCanvasMarkupMode]);

  const clientPointToWorld = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): WorldPoint | null => {
      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect) return null;
      return {
        x: (event.clientX - rect.left - view.pan.x) / view.zoom,
        y: (event.clientY - rect.top - view.pan.y) / view.zoom,
      };
    },
    [view.pan.x, view.pan.y, view.zoom],
  );

  const buildMarkupContext = useCallback(
    (
      mode: "text" | "callout",
      point: WorldPoint,
    ): CanvasMarkupCreateContext => {
      const x = clamp((point.x / Math.max(board.width, 1)) * 100, 0, 100);
      const y = clamp((point.y / Math.max(board.height, 1)) * 100, 0, 100);
      return {
        anchor: {
          x,
          y,
          anchorKind: "visual",
          visualLabel: canvas.title || "Canvas markup",
          visualX: x,
          visualY: y,
          canvasX: Math.round(point.x),
          canvasY: Math.round(point.y),
          canvasWidth: Math.round(board.width),
          canvasHeight: Math.round(board.height),
          markupType: mode,
        },
      };
    },
    [board.height, board.width, canvas.title],
  );

  const submitCanvasMarkup = useCallback(
    async (text: string) => {
      if (!pendingMarkup || !onCanvasMarkupCreate) return;
      const trimmed = text.trim();
      if (!trimmed) return;
      const origin = pendingMarkup.points?.[0] ?? pendingMarkup.origin;
      const target = pendingMarkup.points?.[1] ?? origin;
      setSavingMarkup(true);
      try {
        const annotation: CanvasMarkupAnnotationInput =
          pendingMarkup.mode === "callout"
            ? {
                type: "callout",
                text: trimmed,
                x: origin.x,
                y: origin.y,
                points: [origin, target],
                style: { tone: "accent", stroke: "dashed", width: 2 },
              }
            : {
                type: "text",
                text: trimmed,
                x: origin.x,
                y: origin.y,
                style: { tone: "accent" },
              };
        await onCanvasMarkupCreate(
          annotation,
          buildMarkupContext(pendingMarkup.mode, target),
        );
        setPendingMarkup(null);
      } finally {
        setSavingMarkup(false);
      }
    },
    [buildMarkupContext, onCanvasMarkupCreate, pendingMarkup],
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
      updateView((current) => ({
        ...current,
        pan: {
          x: current.pan.x - (deltaX || (event.shiftKey ? deltaY : 0)),
          y: current.pan.y - (event.shiftKey ? 0 : deltaY),
        },
      }));
    };

    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [updateView, zoomByFactor]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.button !== 1) return;
    const target = event.target as HTMLElement;
    // Don't start a pan when grabbing interactive chrome (zoom controls etc.).
    if (event.button === 0 && target.closest("[data-plan-interactive]")) return;
    if (!isEditableShortcutTarget(target)) {
      event.currentTarget.focus({ preventScroll: true });
    }
    if (
      event.button === 0 &&
      onDesignElementSelect &&
      target.closest("[data-design-id], [data-plan-design-id]")
    ) {
      return;
    }
    if (markupMode === "comment") return;
    if (isCanvasMarkupMode && event.button === 0) {
      const point = clientPointToWorld(event);
      if (!point || pendingMarkup) return;
      event.preventDefault();
      event.stopPropagation();
      if (markupMode === "text") {
        setPendingMarkup({ mode: "text", origin: point });
        return;
      }
      event.currentTarget.setPointerCapture(event.pointerId);
      setDraftCallout({
        pointerId: event.pointerId,
        start: point,
        current: point,
      });
      return;
    }
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
  const onViewportKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (
      event.target === event.currentTarget &&
      event.key.toLowerCase() === "c" &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey &&
      !event.defaultPrevented &&
      onCommentShortcut
    ) {
      event.preventDefault();
      event.stopPropagation();
      onCommentShortcut();
      return;
    }
    if (
      event.key !== "0" ||
      !(event.metaKey || event.ctrlKey) ||
      event.altKey ||
      event.shiftKey ||
      isEditableShortcutTarget(event.target)
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    resetZoom();
  };

  return (
    <section
      className="plan-canvas relative h-[65vh] overflow-hidden border-b border-plan-line"
      aria-label={t("raw.canvas.artboardCanvas")}
    >
      <div
        ref={viewportRef}
        data-plan-canvas-viewport
        className={`plan-canvas-viewport absolute inset-0 overflow-hidden ${
          reviewCursor
            ? "cursor-crosshair active:cursor-crosshair"
            : "cursor-grab active:cursor-grabbing"
        } focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[hsl(var(--ring)/0.45)]`}
        tabIndex={0}
        style={
          {
            overscrollBehavior: "contain",
            touchAction: "none",
          } as CSSProperties
        }
        onPointerDown={onPointerDown}
        onKeyDown={onViewportKeyDown}
        onPointerMove={(event) => {
          if (draftCallout?.pointerId === event.pointerId) {
            const point = clientPointToWorld(event);
            if (!point) return;
            event.preventDefault();
            event.stopPropagation();
            setDraftCallout((current) =>
              current && current.pointerId === event.pointerId
                ? { ...current, current: point }
                : current,
            );
            return;
          }
          if (!drag || drag.pointerId !== event.pointerId) return;
          event.preventDefault();
          updateView((current) => ({
            ...current,
            pan: {
              x: drag.panX + event.clientX - drag.startX,
              y: drag.panY + event.clientY - drag.startY,
            },
          }));
        }}
        onPointerUp={(event) => {
          if (draftCallout?.pointerId === event.pointerId) {
            const point = clientPointToWorld(event) ?? draftCallout.current;
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.releasePointerCapture(event.pointerId);
            const target =
              distance(draftCallout.start, point) < 18
                ? {
                    x: draftCallout.start.x + 168,
                    y: draftCallout.start.y + 64,
                  }
                : point;
            setPendingMarkup({
              mode: "callout",
              origin: draftCallout.start,
              points: [draftCallout.start, target],
            });
            setDraftCallout(null);
            return;
          }
          if (drag?.pointerId === event.pointerId) {
            event.currentTarget.releasePointerCapture(event.pointerId);
            setDrag(null);
          }
        }}
        onPointerCancel={() => {
          setDraftCallout(null);
          setDrag(null);
        }}
      >
        <div
          data-plan-canvas-world
          className="plan-canvas-world relative origin-top-left"
          style={{
            width: board.width,
            height: board.height,
            transform: worldTransform,
            transformOrigin: "0 0",
            willChange: "transform",
            backfaceVisibility: "hidden",
          }}
        >
          <div
            aria-hidden="true"
            className="plan-canvas-grid absolute"
            data-plan-canvas-grid
            style={{
              left: -GRID_PADDING,
              top: -GRID_PADDING,
              width: board.width + GRID_PADDING * 2,
              height: board.height + GRID_PADDING * 2,
              backgroundSize: `${GRID_CELL}px ${GRID_CELL}px`,
            }}
          />

          {/* Section containers sit BEHIND the frames (lowest layer) so each
              group reads as one bounded region the artboards rest inside. */}
          {sectionRects.map(({ section, rect }) => (
            <CanvasSection key={section.id} section={section} rect={rect} />
          ))}

          {connectors.map((edge, index) => (
            <CanvasConnector
              key={`${edge.from}-${edge.to}-${index}`}
              edge={edge}
              frameById={measuredFrameById}
              showLabel={false}
            />
          ))}

          {/* Arrows draw from each resolved note box to the measured frame edge. */}
          {Array.from(resolvedAnnotations.entries()).map(([id, resolved]) =>
            resolved.anchor ? (
              <CanvasAnnotationArrow
                key={`annotation-arrow-${id}`}
                resolved={resolved}
              />
            ) : null,
          )}
          {legacyNotes.map((note) => (
            <CanvasLegacyNoteArrow
              key={`legacy-note-arrow-${note.id}`}
              note={note}
              frameById={measuredFrameById}
            />
          ))}

          {frames.map((frame) => (
            <CanvasArtboard
              key={frame.id}
              frame={frame}
              block={frame.blockId ? blockLookup.get(frame.blockId) : undefined}
              onMeasure={reportFrameHeight}
              selectedDesignElementKey={selectedDesignElementKey}
              onDesignElementSelect={
                markupMode === "none" ? onDesignElementSelect : undefined
              }
            />
          ))}

          {connectors.map((edge, index) => (
            <CanvasConnectorLabel
              key={`connector-label-${edge.from}-${edge.to}-${index}`}
              edge={edge}
              frameById={measuredFrameById}
            />
          ))}

          {draftCallout && (
            <CanvasMarkupPreview
              start={draftCallout.start}
              end={draftCallout.current}
            />
          )}

          {pendingMarkup?.mode === "callout" && pendingMarkup.points && (
            <CanvasMarkupPreview
              start={pendingMarkup.points[0]}
              end={pendingMarkup.points[1]}
            />
          )}

          {/* All structured annotations render at their resolved (collision-free)
              board positions; markup notes (text/callout/arrow) keep their own
              point-based placement. */}
          {annotations.map((note) =>
            isCanvasMarkupAnnotation(note) ? (
              <CanvasMarkupAnnotation
                key={note.id}
                note={note}
                board={board}
                snapTargets={snapTargets}
              />
            ) : (
              <CanvasAnnotation
                key={note.id}
                note={note}
                resolved={resolvedAnnotations.get(note.id)}
              />
            ),
          )}
          {legacyNotes.map((note) => (
            <CanvasLegacyNote key={note.id} note={note} />
          ))}
        </div>
      </div>

      <div
        className="plan-canvas-zoom absolute bottom-3 left-3 z-10 flex items-center gap-0.5 rounded-lg border border-plan-line bg-plan-chrome p-0.5 shadow-md backdrop-blur"
        data-plan-interactive
      >
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-6"
          onClick={() => zoomByFactor(1 / 1.2)}
          aria-label={t("raw.canvas.zoomOut")}
        >
          <IconMinus className="size-3" />
        </Button>
        <span className="min-w-9 text-center text-xs font-semibold tabular-nums">
          {Math.round(zoom * 100)}%
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-6"
          onClick={() => zoomByFactor(1.2)}
          aria-label={t("raw.canvas.zoomIn")}
        >
          <IconPlus className="size-3" />
        </Button>
      </div>

      {pendingMarkup && (
        <CanvasMarkupComposer
          mode={pendingMarkup.mode}
          point={pendingMarkup.points?.[0] ?? pendingMarkup.origin}
          view={view}
          viewportRef={viewportRef}
          isSaving={savingMarkup}
          onCancel={() => setPendingMarkup(null)}
          onSubmit={submitCanvasMarkup}
        />
      )}
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

function sameCanvasView(a: CanvasView, b: CanvasView) {
  return (
    Math.abs(a.zoom - b.zoom) < 0.0001 &&
    Math.abs(a.pan.x - b.pan.x) < 0.0001 &&
    Math.abs(a.pan.y - b.pan.y) < 0.0001
  );
}

function isEditableShortcutTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    Boolean(
      target.closest(
        "input, textarea, select, [contenteditable='true'], [role='textbox']",
      ),
    )
  );
}

/**
 * True when a frame actually has wireframe content to render: inline kit-tree
 * data, inline legacy region data, or a `blockId` that resolves to a wireframe /
 * legacy-wireframe block. Label-only artboards (no interior content) are skipped
 * so the board never reserves space for an empty dashed box.
 */
function frameHasContent(
  frame: PlanArtboard,
  blockLookup: Map<string, PlanBlock>,
): boolean {
  if (frame.wireframe || frame.legacyWireframe) return true;
  if (!frame.blockId) return false;
  const block = blockLookup.get(frame.blockId);
  return block?.type === "wireframe" || block?.type === "legacy-wireframe";
}

function canvasFrameLayoutKey(
  mode: NonNullable<PlanContent["canvas"]>["mode"],
  frames: PlanArtboard[],
) {
  return `${mode ?? "canvas"}:${frames
    .map((frame) =>
      [
        frame.id,
        surfaceOf(frame),
        frame.x ?? "",
        frame.y ?? "",
        frame.width ?? "",
        frame.height ?? "",
      ].join(":"),
    )
    .join("|")}`;
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
    // SURFACE owns the footprint/aspect — ignore any model-supplied width/height
    // so a popover is always ~square and can never render "too wide".
    const width = preset.width;
    const height = preset.height;

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
  onMeasure,
  selectedDesignElementKey,
  onDesignElementSelect,
}: {
  frame: PlanArtboard;
  block?: PlanBlock;
  onMeasure?: (id: string, height: number) => void;
  selectedDesignElementKey?: string | null;
  onDesignElementSelect?: (selection: DesignElementSelection) => void;
}) {
  const surface = surfaceOf(frame);
  const preset = SURFACE_SIZE[surface];
  // SURFACE-locked footprint (see layoutArtboards) — model width/height ignored.
  const width = preset.width;
  const height = preset.height;
  const label = frame.label ?? block?.title;
  // Report the frame's real rendered height so board connectors can anchor to
  // the content box (frames are capped at `height` but usually shorter).
  const frameRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = frameRef.current;
    if (!el || !onMeasure) return;
    const report = () => onMeasure(frame.id, el.offsetHeight);
    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => observer.disconnect();
  }, [frame.id, onMeasure]);

  // Prefer the inline kit-tree wireframe; fall back to the legacy region shape
  // (kept for old / imported plans). Pull from the referenced block if the
  // frame itself doesn't carry inline data. Annotations are NOT rendered inside
  // the artboard — they live as board-level layers positioned by
  // layoutAnnotations() so each note's box and its arrow share one coordinate.
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
        // Canvas text scales WITH the board (no inverse-zoom counter-scale), so
        // a label's footprint always matches its frame at every zoom level.
        <div className="plan-artboard-label pointer-events-none absolute bottom-full left-0 pb-2 text-sm font-semibold text-plan-text">
          {label}
        </div>
      )}
      <div
        ref={frameRef}
        className="plan-artboard-frame"
        style={{ maxHeight: height, overflow: "hidden" }}
      >
        {kitData ? (
          // The kit-tree wireframe renderer ({ surface, screen }) is owned by
          // the wireframe module; CanvasArea only supplies fixed-size framing.
          // The surface preset lives inside the kit-tree data so the renderer
          // reads it from `data.surface`.
          <Wireframe
            data={kitData as unknown as Parameters<typeof Wireframe>[0]["data"]}
            canvasSize={height}
            canvasWidth={width}
            frameId={frame.id}
            blockId={frame.blockId}
            selectedDesignElementKey={selectedDesignElementKey}
            onDesignElementSelect={onDesignElementSelect}
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

/** Padding the section container holds around its member artboards. */
const SECTION_PAD_X = 56;
const SECTION_PAD_TOP = 128;
const SECTION_PAD_BOTTOM = 64;

/**
 * Bounding box of a section: the union of its member frames, expanded by padding
 * so the container reads as a real region wrapping the group (label row + the
 * frame labels that hang above each frame both fit inside the top padding).
 * Returns null when the section has no resolvable members.
 */
function sectionRect(
  section: PlanBoardSection,
  frameById: Map<string, PlanArtboard>,
): AnnotationRect | null {
  const members = (section.artboardIds ?? [])
    .map((id) => frameById.get(id))
    .filter((frame): frame is PlanArtboard => Boolean(frame));
  if (members.length === 0) return null;
  const left = Math.min(...members.map((f) => f.x ?? 96));
  const top = Math.min(...members.map((f) => f.y ?? 96));
  const right = Math.max(
    ...members.map((f) => (f.x ?? 96) + (f.width ?? DESK_W)),
  );
  const bottom = Math.max(
    ...members.map((f) => (f.y ?? 96) + (f.height ?? DESK_H)),
  );
  return {
    left: left - SECTION_PAD_X,
    top: top - SECTION_PAD_TOP,
    width: right - left + SECTION_PAD_X * 2,
    height: bottom - top + SECTION_PAD_TOP + SECTION_PAD_BOTTOM,
  };
}

/**
 * A section is now a real layout CONTAINER: a subtle rounded region that bounds
 * its member artboards (so a group reads as one unit), with the title/subtitle
 * sitting inside the top padding. It scales with the board and stays
 * non-interactive so panning still works through it.
 */
function CanvasSection({
  rect,
  section,
}: {
  rect: AnnotationRect;
  section: PlanBoardSection;
}) {
  return (
    <div
      className="plan-canvas-section pointer-events-none absolute rounded-[20px] border border-dashed border-plan-line/70 bg-plan-text/[0.015]"
      style={{
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      }}
    >
      <div className="absolute left-7 top-6">
        {section.title && (
          <p className="text-2xl font-semibold tracking-[-0.01em] text-plan-text">
            {section.title}
          </p>
        )}
        {section.subtitle && (
          <p className="mt-1 text-base text-plan-muted">{section.subtitle}</p>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Annotations — plain text layers on the board; NO bordered/shadowed cards   */
/* -------------------------------------------------------------------------- */

const ANNOTATION_GAP = 32;
/** Box width used for layout math; the body renders at 260 with breathing room. */
const ANNOTATION_BOX_W = 280;
/** Vertical gap between two notes stacked on the same side of a frame. */
const ANNOTATION_STACK_GAP = 20;
/** Min height assumed for a note (heading + one line). */
const ANNOTATION_MIN_H = 64;

type AnnotationRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/** Resolved board position for a single annotation, plus its arrow endpoint. */
export type ResolvedAnnotation = AnnotationRect & {
  /** Arrow endpoint on the target frame (measured), if this note has a target. */
  anchor?: { x: number; y: number };
};

/** Rough height estimate from the note's text so layout can stack/avoid notes. */
function estimateAnnotationHeight(note: PlanAnnotation): number {
  const bullets = parseBullets(note.text);
  const headingH = note.title ? 26 : 0;
  if (bullets) return headingH + bullets.length * 24 + 16;
  // ~38 chars per line at 260px; one prose paragraph.
  const lines = Math.max(1, Math.ceil(note.text.length / 38));
  return Math.max(ANNOTATION_MIN_H, headingH + lines * 24 + 16);
}

/** Measured bounds of a frame (declared x/y; measured height threaded in). */
function frameRect(frame: PlanArtboard): AnnotationRect {
  return {
    left: frame.x ?? 96,
    top: frame.y ?? 96,
    width: frame.width ?? DESK_W,
    height: frame.height ?? DESK_H,
  };
}

/**
 * Arrow endpoint on a MEASURED frame: the requested edge/corner, or the measured
 * center when placement is undefined. `frame` already carries the measured
 * height (threaded in via `measuredFrameById`), so the tip lands on the real
 * rendered box, never below it.
 */
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

/**
 * Unanchored starting box for a note on its requested side of the MEASURED
 * frame, before collision resolution. Side placements sit beside the frame; top/
 * bottom sit above/below it; the default parks to the right gutter.
 */
function preferredAnnotationRect(
  note: PlanAnnotation,
  frame: PlanArtboard,
  height: number,
): AnnotationRect {
  const r = frameRect(frame);
  const place = note.placement;
  const width = ANNOTATION_BOX_W;
  if (place === "left" || place === "top-left" || place === "bottom-left") {
    return {
      left: r.left - width - ANNOTATION_GAP,
      top: r.top,
      width,
      height,
    };
  }
  if (place === "top") {
    return {
      left: r.left,
      top: r.top - height - ANNOTATION_GAP,
      width,
      height,
    };
  }
  if (place === "bottom") {
    return {
      left: r.left,
      top: r.top + r.height + ANNOTATION_GAP,
      width,
      height,
    };
  }
  // right / top-right / bottom-right / undefined → right gutter.
  return { left: r.left + r.width + ANNOTATION_GAP, top: r.top, width, height };
}

/** Which gutter a placement flows into: left of the frame, or the right gutter. */
function sideOf(
  placement: PlanAnnotationPlacement | undefined,
): "left" | "right" {
  return placement === "left" ||
    placement === "top-left" ||
    placement === "bottom-left"
    ? "left"
    : "right";
}

/**
 * Resolve every annotation's board position with deterministic FLEX AUTO-LAYOUT
 * instead of an iterative collision solver. Each frame owns two vertical gutter
 * columns (one on its left edge, one on its right); same-side notes flow down
 * that column with a constant gap, exactly like a flex `column` with `gap`. The
 * column is the frame's own height-tracking flow, so notes never overlap their
 * frame or each other by construction — no nudge-until-clear search, no 60-step
 * fallback. Loose (untargeted) notes flow down a single shared right-hand gutter
 * past the widest frame. Every position is a pure function of the measured frame
 * boxes, so the arrow (derived from the resolved box edge → frame anchor) always
 * connects the rendered note to the rendered frame.
 */
function layoutAnnotations(
  byFrame: Map<string, PlanAnnotation[]>,
  loose: PlanAnnotation[],
  measuredFrameById: Map<string, PlanArtboard>,
): Map<string, ResolvedAnnotation> {
  const resolved = new Map<string, ResolvedAnnotation>();
  const frameRects = Array.from(measuredFrameById.values()).map(frameRect);

  // Flex-style flow: place each box at the running cursor for its column, then
  // advance the cursor by the box height + gap. Top/bottom placements seed the
  // column above/below the frame; side placements align to the frame top.
  const flowDown = (
    cursor: { top: number },
    rect: Omit<AnnotationRect, "top">,
  ): AnnotationRect => {
    const placed: AnnotationRect = { ...rect, top: cursor.top };
    cursor.top = placed.top + placed.height + ANNOTATION_STACK_GAP;
    return placed;
  };

  // Frame-anchored notes: one flex column per (frame, side). Each column starts
  // at the frame's preferred edge and flows down with a constant gap.
  for (const [frameId, notes] of byFrame) {
    const frame = measuredFrameById.get(frameId);
    if (!frame) continue;
    const columnTop = new Map<"left" | "right", number>();
    for (const note of notes) {
      const height = estimateAnnotationHeight(note);
      const base = preferredAnnotationRect(note, frame, height);
      const side = sideOf(note.placement);
      const cursor = { top: columnTop.get(side) ?? base.top };
      const slot = flowDown(cursor, {
        left: base.left,
        width: base.width,
        height,
      });
      columnTop.set(side, cursor.top);
      // Shift the note clear of any OTHER frame its gutter would land on (e.g. a
      // right note on a wide frame that has a popover frame to its right), then
      // anchor the arrow to the frame edge facing where the note actually landed.
      const placed = shiftSideClear(slot, side, frameRects, ANNOTATION_GAP);
      resolved.set(note.id, {
        ...placed,
        anchor: frameAnchorTowardNote(frameRect(frame), placed),
      });
    }
  }

  // Loose notes: a single shared right-hand gutter column, past the widest
  // frame, flowing straight down. Targeted-but-offscreen notes anchor to their
  // frame; the rest are pure free-canvas text.
  const gutterLeft =
    Math.max(96, ...frameRects.map((f) => f.left + f.width)) + ANNOTATION_GAP;
  const gutterCursor = { top: 96 };
  for (const note of loose) {
    if (isCanvasMarkupAnnotation(note)) continue;
    const frame = note.targetId
      ? measuredFrameById.get(note.targetId)
      : undefined;
    const height = estimateAnnotationHeight(note);
    if (frame) {
      const base = preferredAnnotationRect(note, frame, height);
      const placed = shiftSideClear(
        base,
        sideOf(note.placement),
        frameRects,
        ANNOTATION_GAP,
      );
      resolved.set(note.id, {
        ...placed,
        anchor: frameAnchorTowardNote(frameRect(frame), placed),
      });
      continue;
    }
    // Free note with explicit coordinates keeps them; otherwise flow the gutter.
    const slot =
      note.x !== undefined || note.y !== undefined
        ? {
            left: note.x ?? gutterLeft,
            top: note.y ?? gutterCursor.top,
            width: ANNOTATION_BOX_W,
            height,
          }
        : flowDown(gutterCursor, {
            left: gutterLeft,
            width: ANNOTATION_BOX_W,
            height,
          });
    resolved.set(note.id, { ...slot, anchor: undefined });
  }

  return resolved;
}

/** Presentational annotation text (title + bullets/prose). No positioning. */
function AnnotationBody({ note }: { note: PlanAnnotation }) {
  const bullets = parseBullets(note.text);
  return (
    <div className="w-[260px] text-sm leading-6 text-plan-muted">
      {note.title && (
        <p className="mb-1 text-[0.95rem] font-semibold text-plan-text">
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

/**
 * A structured annotation rendered at its resolved (collision-free) board
 * position. The position is computed once by layoutAnnotations() so the note's
 * box and its arrow share one coordinate; if (defensively) no resolved entry
 * exists, fall back to the note's own x/y.
 */
function CanvasAnnotation({
  note,
  resolved,
}: {
  note: PlanAnnotation;
  resolved?: ResolvedAnnotation;
}) {
  const left = resolved?.left ?? note.x ?? 80;
  const top = resolved?.top ?? note.y ?? 80;
  return (
    <div className="plan-canvas-annotation absolute" style={{ left, top }}>
      <AnnotationBody note={note} />
    </div>
  );
}

function isCanvasMarkupAnnotation(note: PlanAnnotation) {
  return (
    note.type === "text" ||
    note.type === "callout" ||
    note.type === "arrow" ||
    Boolean(note.points?.length)
  );
}

function estimateCanvasMarkupLabelHeight(note: PlanAnnotation) {
  const headingH = note.title ? 24 : 0;
  const lines = Math.max(
    1,
    note.text
      .split("\n")
      .reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / 34)), 0),
  );
  return Math.max(52, headingH + lines * 20 + 24);
}

type CanvasMarkupLabelCandidate = {
  side: "left" | "right" | "top" | "bottom";
  vector: { x: number; y: number };
  rect: AnnotationRect;
  raw: { left: number; top: number };
};

function resolveCanvasMarkupLabelRect({
  note,
  origin,
  target,
  board,
  avoid,
}: {
  note: PlanAnnotation;
  origin: WorldPoint;
  target?: WorldPoint;
  board: { width: number; height: number };
  avoid: AnnotationRect[];
}): AnnotationRect {
  const width = ANNOTATION_BOX_W;
  const height = estimateCanvasMarkupLabelHeight(note);
  const gap = 28;
  const margin = 18;
  const boardMaxLeft = Math.max(margin, board.width - width - margin);
  const boardMaxTop = Math.max(margin, board.height - height - margin);
  const targetVector = target
    ? { x: target.x - origin.x, y: target.y - origin.y }
    : { x: 1, y: 0 };
  const targetLen = Math.hypot(targetVector.x, targetVector.y) || 1;
  const targetUnit = {
    x: targetVector.x / targetLen,
    y: targetVector.y / targetLen,
  };
  const rawCandidates: CanvasMarkupLabelCandidate[] = [
    {
      side: "left",
      vector: { x: -1, y: 0 },
      raw: { left: origin.x - width - gap, top: origin.y - height / 2 },
      rect: { left: 0, top: 0, width, height },
    },
    {
      side: "right",
      vector: { x: 1, y: 0 },
      raw: { left: origin.x + gap, top: origin.y - height / 2 },
      rect: { left: 0, top: 0, width, height },
    },
    {
      side: "top",
      vector: { x: 0, y: -1 },
      raw: { left: origin.x - width / 2, top: origin.y - height - gap },
      rect: { left: 0, top: 0, width, height },
    },
    {
      side: "bottom",
      vector: { x: 0, y: 1 },
      raw: { left: origin.x - width / 2, top: origin.y + gap },
      rect: { left: 0, top: 0, width, height },
    },
  ];
  const candidates = rawCandidates.map((candidate) => ({
    ...candidate,
    rect: {
      left: clamp(candidate.raw.left, margin, boardMaxLeft),
      top: clamp(candidate.raw.top, margin, boardMaxTop),
      width,
      height,
    },
  }));

  let best = candidates[0];
  let bestScore = Infinity;
  for (const candidate of candidates) {
    const overlapPenalty = avoid.reduce(
      (sum, box) =>
        sum +
        (rectsOverlap(candidate.rect, box)
          ? rectOverlapArea(candidate.rect, box)
          : 0),
      0,
    );
    const clampPenalty =
      Math.abs(candidate.raw.left - candidate.rect.left) +
      Math.abs(candidate.raw.top - candidate.rect.top);
    // Prefer the label on the side opposite the arrow target so the arrow exits
    // the label edge instead of running back through the words.
    const directionPenalty =
      (candidate.vector.x * targetUnit.x +
        candidate.vector.y * targetUnit.y +
        1) *
      90;
    const score = overlapPenalty * 8 + clampPenalty * 2 + directionPenalty;
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best.rect;
}

function CanvasMarkupAnnotation({
  note,
  board,
  snapTargets = [],
}: {
  note: PlanAnnotation;
  board: { width: number; height: number };
  snapTargets?: AnnotationRect[];
}) {
  const origin = note.points?.[0] ?? { x: note.x ?? 80, y: note.y ?? 80 };
  const rawTarget = note.points?.[1];
  // Snap the arrow TIP onto the nearest box edge when it lands on/near a frame
  // or section, so a point-arrow visually grabs the thing it points at instead
  // of floating just inside or outside it. The origin keeps its hand-placed
  // spot (it's where the note text sits).
  const target = rawTarget
    ? snapPointToBoxes(rawTarget, snapTargets)
    : undefined;
  const labelRect =
    note.type !== "arrow"
      ? resolveCanvasMarkupLabelRect({
          note,
          origin,
          target,
          board,
          avoid: snapTargets,
        })
      : undefined;
  const arrowStart =
    target && labelRect
      ? boxEdgeToward(labelRect, target)
      : { x: origin.x + 16, y: origin.y + 18 };
  return (
    <>
      {target && (
        <ArrowSvg
          fromX={arrowStart.x}
          fromY={arrowStart.y}
          toX={target.x}
          toY={target.y}
          id={`canvas-markup-arrow-${note.id}`}
          strokeWidth={note.style?.width ?? 2.4}
          dashed={note.style?.stroke !== "solid"}
        />
      )}
      {note.type !== "arrow" && (
        <div
          className="plan-canvas-markup-note absolute max-w-[280px] rounded-md border border-[hsl(var(--ring)/0.35)] bg-plan-chrome px-3 py-2 text-sm leading-5 text-plan-text shadow-sm backdrop-blur"
          style={{
            left: labelRect?.left ?? origin.x,
            top: labelRect?.top ?? origin.y,
            width: labelRect?.width ?? ANNOTATION_BOX_W,
          }}
        >
          {note.title && (
            <p className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-plan-muted">
              {note.title}
            </p>
          )}
          <p className="whitespace-pre-wrap break-words">{note.text}</p>
        </div>
      )}
    </>
  );
}

function CanvasMarkupPreview({
  start,
  end,
}: {
  start: WorldPoint;
  end: WorldPoint;
}) {
  return (
    <ArrowSvg
      fromX={start.x + 16}
      fromY={start.y + 18}
      toX={end.x}
      toY={end.y}
      id="canvas-markup-draft-arrow"
      strokeWidth={2.2}
      dashed
    />
  );
}

function CanvasMarkupComposer({
  mode,
  point,
  view,
  viewportRef,
  isSaving,
  onCancel,
  onSubmit,
}: {
  mode: PendingMarkup["mode"];
  point: WorldPoint;
  view: CanvasView;
  viewportRef: RefObject<HTMLDivElement | null>;
  isSaving: boolean;
  onCancel: () => void;
  onSubmit: (text: string) => Promise<void>;
}) {
  const t = useT();
  const [text, setText] = useState("");
  const [error, setError] = useState(false);
  const screenPoint = {
    x: point.x * view.zoom + view.pan.x,
    y: point.y * view.zoom + view.pan.y,
  };
  const position = resolveMarkupComposerPosition({
    pointX: screenPoint.x,
    pointY: screenPoint.y,
    viewportWidth: viewportRef.current?.clientWidth ?? 720,
    viewportHeight: viewportRef.current?.clientHeight ?? 520,
  });
  const canSubmit = text.trim().length > 0 && !isSaving;
  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!canSubmit) return;
    setError(false);
    try {
      await onSubmit(text);
    } catch {
      setError(true);
    }
  };
  return (
    <form
      className="absolute z-20 rounded-xl border border-border/80 bg-background/96 p-2 shadow-2xl backdrop-blur-xl"
      data-plan-interactive
      style={{ left: position.left, top: position.top, width: position.width }}
      onSubmit={(event) => void submit(event)}
    >
      <Textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            void submit();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
        rows={2}
        autoFocus
        placeholder={
          mode === "callout" ? "Describe this callout..." : "Add a text note..."
        }
        className="min-h-20 resize-none border-border/80 bg-background text-sm shadow-none focus-visible:ring-1"
      />
      <div className="mt-2 flex items-center justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!canSubmit}>
          {isSaving ? "Saving" : "Save"}
        </Button>
      </div>
      {error && (
        <p className="mt-2 px-1 text-xs text-destructive">
          {t("raw.canvas.markupSaveFailed")}
        </p>
      )}
    </form>
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

/**
 * Shared hand-drawn wobble filter (Excalidraw / wireframe house style). A single
 * turbulence + displacement pass jitters the whole stroke so straight segments
 * read as hand-sketched. `userSpaceOnUse` keeps the region tied to the svg box so
 * thin near-flat lines don't clip their wobble.
 */
function SketchFilter({
  id,
  width,
  height,
  seed = 5,
}: {
  id: string;
  width: number;
  height: number;
  seed?: number;
}) {
  return (
    <filter
      id={id}
      x={0}
      y={0}
      width={width}
      height={height}
      filterUnits="userSpaceOnUse"
    >
      <feTurbulence
        type="fractalNoise"
        baseFrequency="0.014"
        numOctaves={2}
        seed={seed}
        result="noise"
      />
      <feDisplacementMap
        in="SourceGraphic"
        in2="noise"
        scale="0.9"
        xChannelSelector="R"
        yChannelSelector="G"
      />
    </filter>
  );
}

/** Cheap deterministic seed so each arrow wobbles a little differently. */
function hashSeed(value: string) {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) {
    h = (h * 31 + value.charCodeAt(i)) % 101;
  }
  return h;
}

/**
 * Open, hand-drawn arrowhead — a "V" of two strokes pointing along the end
 * tangent (from the last control point `cx,cy` to the tip `ex,ey`). Drawn inside
 * the same filtered group as the line so it wobbles coherently with it; no hard
 * filled triangle.
 */
function sketchHeadPath(ex: number, ey: number, cx: number, cy: number) {
  const length = 11;
  const spread = 0.45;
  const angle = Math.atan2(ey - cy, ex - cx);
  const w1x = ex - length * Math.cos(angle - spread);
  const w1y = ey - length * Math.sin(angle - spread);
  const w2x = ex - length * Math.cos(angle + spread);
  const w2y = ey - length * Math.sin(angle + spread);
  return `M ${w1x} ${w1y} L ${ex} ${ey} L ${w2x} ${w2y}`;
}

function ArrowSvg({
  fromX,
  fromY,
  toX,
  toY,
  id,
  strokeWidth = 2,
  dashed = true,
}: {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  id: string;
  strokeWidth?: number;
  dashed?: boolean;
}) {
  const left = Math.min(fromX, toX) - 18;
  const top = Math.min(fromY, toY) - 18;
  const width = Math.abs(toX - fromX) + 36;
  const height = Math.abs(toY - fromY) + 36;
  const sx = fromX - left;
  const sy = fromY - top;
  const ex = toX - left;
  const ey = toY - top;
  const horizontal = Math.abs(toX - fromX) >= Math.abs(toY - fromY);
  const c1x = horizontal ? sx + (ex - sx) / 2 : sx;
  const c1y = horizontal ? sy : sy + (ey - sy) / 2;
  const c2x = horizontal ? ex - (ex - sx) / 2 : ex;
  const c2y = horizontal ? ey : ey - (ey - sy) / 2;
  const filterId = `${id}-rough`;
  return (
    <svg
      className="pointer-events-none absolute overflow-visible"
      style={{ left, top, width, height }}
      viewBox={`0 0 ${width} ${height}`}
    >
      <defs>
        <SketchFilter
          id={filterId}
          width={width}
          height={height}
          seed={hashSeed(id)}
        />
      </defs>
      <g
        fill="none"
        filter={`url(#${filterId})`}
        stroke="hsl(var(--ring))"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      >
        <path
          d={`M ${sx} ${sy} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${ex} ${ey}`}
          strokeDasharray={dashed ? "7 6" : undefined}
        />
        <path d={sketchHeadPath(ex, ey, c2x, c2y)} />
      </g>
    </svg>
  );
}

function CanvasAnnotationArrow({ resolved }: { resolved: ResolvedAnnotation }) {
  const target = resolved.anchor;
  if (!target) return null;
  // Both endpoints come from the resolved layout: the END is the measured frame
  // edge/center (so the tip lands on the real content box, never below it), and
  // the START is the edge of the resolved note box facing that target — so the
  // arrow always visually connects the rendered box to the rendered frame.
  const start = boxEdgeToward(resolved, target);
  return (
    <ArrowSvg
      fromX={start.x}
      fromY={start.y}
      toX={target.x}
      toY={target.y}
      id={`annotation-arrow-${resolved.left}-${resolved.top}`}
    />
  );
}

/** How close (board px) a point must be to a box for the arrow tip to snap. */
const SNAP_RADIUS = 40;

/** Clamp a point onto a rectangle's perimeter (the nearest edge point). */
function clampToRectPerimeter(
  point: { x: number; y: number },
  box: AnnotationRect,
): { x: number; y: number } {
  const cx = clamp(point.x, box.left, box.left + box.width);
  const cy = clamp(point.y, box.top, box.top + box.height);
  const inside =
    point.x > box.left &&
    point.x < box.left + box.width &&
    point.y > box.top &&
    point.y < box.top + box.height;
  if (!inside) return { x: cx, y: cy };
  // Inside the box: push out to whichever edge is closest.
  const dLeft = point.x - box.left;
  const dRight = box.left + box.width - point.x;
  const dTop = point.y - box.top;
  const dBottom = box.top + box.height - point.y;
  const min = Math.min(dLeft, dRight, dTop, dBottom);
  if (min === dLeft) return { x: box.left, y: point.y };
  if (min === dRight) return { x: box.left + box.width, y: point.y };
  if (min === dTop) return { x: point.x, y: box.top };
  return { x: point.x, y: box.top + box.height };
}

/** Squared distance from a point to the nearest perimeter point of a box. */
function distToRectPerimeter(
  point: { x: number; y: number },
  box: AnnotationRect,
): number {
  const edge = clampToRectPerimeter(point, box);
  return Math.hypot(point.x - edge.x, point.y - edge.y);
}

/**
 * Snap-clamp an arrow endpoint onto the nearest snap target (artboard or section
 * box) when it lands inside or within SNAP_RADIUS of one. Returns the point
 * unchanged when nothing is close, so a free-floating arrow stays free. This is
 * what makes point arrows "grab" the frame/section they point at without the
 * model having to land the coordinate exactly on the edge.
 */
function snapPointToBoxes(
  point: { x: number; y: number },
  boxes: AnnotationRect[],
): { x: number; y: number } {
  let best: AnnotationRect | null = null;
  let bestDist = Infinity;
  for (const box of boxes) {
    const inside =
      point.x >= box.left &&
      point.x <= box.left + box.width &&
      point.y >= box.top &&
      point.y <= box.top + box.height;
    const dist = inside ? 0 : distToRectPerimeter(point, box);
    if (dist < bestDist) {
      bestDist = dist;
      best = box;
    }
  }
  if (!best || bestDist > SNAP_RADIUS) return point;
  return clampToRectPerimeter(point, best);
}

/** The point on a box's perimeter that faces a target point. */
function boxEdgeToward(
  box: AnnotationRect,
  target: { x: number; y: number },
): { x: number; y: number } {
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  const dx = target.x - cx;
  const dy = target.y - cy;
  // Clamp the box-center→target ray to the box rectangle.
  const hx = box.width / 2;
  const hy = box.height / 2;
  const scale = Math.min(
    dx !== 0 ? hx / Math.abs(dx) : Infinity,
    dy !== 0 ? hy / Math.abs(dy) : Infinity,
  );
  if (!Number.isFinite(scale)) return { x: cx, y: cy };
  return { x: cx + dx * scale, y: cy + dy * scale };
}

/** Arrow tip on a frame: the frame-perimeter point facing the note box, pulled
 *  OUT by a small gap so the arrow points AT the frame without touching it, and
 *  always toward whichever side the note actually landed on (never "away"). */
const ARROW_FRAME_GAP = 13;
function frameAnchorTowardNote(
  frameR: AnnotationRect,
  noteR: AnnotationRect,
): { x: number; y: number } {
  const noteCenter = {
    x: noteR.left + noteR.width / 2,
    y: noteR.top + noteR.height / 2,
  };
  const edge = boxEdgeToward(frameR, noteCenter);
  const fcx = frameR.left + frameR.width / 2;
  const fcy = frameR.top + frameR.height / 2;
  const dx = edge.x - fcx;
  const dy = edge.y - fcy;
  const len = Math.hypot(dx, dy) || 1;
  return {
    x: edge.x + (dx / len) * ARROW_FRAME_GAP,
    y: edge.y + (dy / len) * ARROW_FRAME_GAP,
  };
}

/** Axis-aligned rectangle overlap test. */
function rectsOverlap(a: AnnotationRect, b: AnnotationRect): boolean {
  return (
    a.left < b.left + b.width &&
    a.left + a.width > b.left &&
    a.top < b.top + b.height &&
    a.top + a.height > b.top
  );
}

function rectOverlapArea(a: AnnotationRect, b: AnnotationRect): number {
  const width = Math.max(
    0,
    Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left),
  );
  const height = Math.max(
    0,
    Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top),
  );
  return width * height;
}

/** Slide a gutter note along its side axis until it clears any frame it would
 *  overlap, so a note never lands on a non-target artboard. Bounded + deterministic. */
function shiftSideClear(
  rect: AnnotationRect,
  side: "left" | "right",
  frames: AnnotationRect[],
  gap: number,
): AnnotationRect {
  let r = rect;
  for (let i = 0; i <= frames.length; i++) {
    const hit = frames.find((f) => rectsOverlap(r, f));
    if (!hit) break;
    r =
      side === "left"
        ? { ...r, left: hit.left - r.width - gap }
        : { ...r, left: hit.left + hit.width + gap };
  }
  return r;
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
  // anchorPoint reads the MEASURED frame (threaded in via measuredFrameById), so
  // the tip lands on the real content box.
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

/** Deprecated note shape (canvas.notes); rendered as a plain text layer. */
function CanvasLegacyNote({ note }: { note: PlanCanvasNote }) {
  return (
    <div
      className="plan-canvas-annotation absolute"
      style={{ left: note.x ?? 80, top: note.y ?? 80 }}
    >
      <AnnotationBody
        note={{ id: note.id, title: note.title, text: note.body }}
      />
    </div>
  );
}

function CanvasConnector({
  edge,
  frameById,
  showLabel = true,
}: {
  edge: PlanConnector;
  frameById: Map<string, PlanArtboard>;
  showLabel?: boolean;
}) {
  const from = frameById.get(edge.from);
  const to = frameById.get(edge.to);
  if (!from || !to) return null;

  // Route nearest/facing sides, not blindly right-edge -> left-edge. This keeps
  // wrapped rows and vertical flows from sweeping through unrelated artboards.
  const PAD = 18;
  const route = connectorRoute(from, to);
  const fromX = route.from.x;
  const fromY = route.from.y;
  const toX = route.to.x;
  const toY = route.to.y;
  const left = Math.min(fromX, toX) - PAD;
  const top = Math.min(fromY, toY) - PAD;
  const width = Math.abs(toX - fromX) + PAD * 2;
  const height = Math.abs(toY - fromY) + PAD * 2;
  const sx = fromX - left;
  const sy = fromY - top;
  const ex = toX - left;
  const ey = toY - top;
  const midX = (sx + ex) / 2;
  const midY = (sy + ey) / 2;
  const isHorizontal = route.axis === "horizontal";
  const path = isHorizontal
    ? `M ${sx} ${sy} L ${midX} ${sy} L ${midX} ${ey} L ${ex} ${ey}`
    : `M ${sx} ${sy} L ${sx} ${midY} L ${ex} ${midY} L ${ex} ${ey}`;
  const headBase = isHorizontal ? { x: midX, y: ey } : { x: ex, y: midY };
  const filterId = `connector-rough-${edge.from}-${edge.to}`;

  return (
    <svg
      className="pointer-events-none absolute overflow-visible"
      style={{ left, top, width, height }}
      viewBox={`0 0 ${width} ${height}`}
    >
      <defs>
        <SketchFilter
          id={filterId}
          width={width}
          height={height}
          seed={hashSeed(edge.from + edge.to)}
        />
      </defs>
      <g
        fill="none"
        filter={`url(#${filterId})`}
        stroke="hsl(var(--ring))"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2.4}
      >
        <path d={path} />
        <path d={sketchHeadPath(ex, ey, headBase.x, headBase.y)} />
      </g>
      {showLabel && edge.label && (
        <text
          x={isHorizontal ? midX : (sx + ex) / 2}
          y={isHorizontal ? Math.min(sy, ey) - 9 : midY - 9}
          textAnchor="middle"
          className="fill-[hsl(var(--ring))] text-[15px] font-semibold"
        >
          {edge.label}
        </text>
      )}
    </svg>
  );
}

function CanvasConnectorLabel({
  edge,
  frameById,
}: {
  edge: PlanConnector;
  frameById: Map<string, PlanArtboard>;
}) {
  if (!edge.label) return null;
  const from = frameById.get(edge.from);
  const to = frameById.get(edge.to);
  if (!from || !to) return null;

  const route = connectorRoute(from, to);
  const isHorizontal = route.axis === "horizontal";
  const left = isHorizontal
    ? (route.from.x + route.to.x) / 2
    : (route.from.x + route.to.x) / 2;
  const top = isHorizontal
    ? Math.min(route.from.y, route.to.y) - 26
    : (route.from.y + route.to.y) / 2 - 28;

  return (
    <div
      className="pointer-events-none absolute z-20 -translate-x-1/2 rounded-full border border-plan-line bg-plan-paper/95 px-2 py-0.5 text-[15px] font-semibold text-[hsl(var(--ring))] shadow-sm"
      style={{ left, top }}
    >
      {edge.label}
    </div>
  );
}

function connectorRoute(
  from: PlanArtboard,
  to: PlanArtboard,
): {
  axis: "horizontal" | "vertical";
  from: WorldPoint;
  to: WorldPoint;
} {
  const gap = 8;
  const fromRect = frameRect(from);
  const toRect = frameRect(to);
  const fromCenter = {
    x: fromRect.left + fromRect.width / 2,
    y: fromRect.top + fromRect.height / 2,
  };
  const toCenter = {
    x: toRect.left + toRect.width / 2,
    y: toRect.top + toRect.height / 2,
  };
  const dx = toCenter.x - fromCenter.x;
  const dy = toCenter.y - fromCenter.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    const toRight = dx >= 0;
    return {
      axis: "horizontal",
      from: {
        x: toRight ? fromRect.left + fromRect.width + gap : fromRect.left - gap,
        y: fromCenter.y,
      },
      to: {
        x: toRight ? toRect.left - gap : toRect.left + toRect.width + gap,
        y: toCenter.y,
      },
    };
  }
  const toBelow = dy >= 0;
  return {
    axis: "vertical",
    from: {
      x: fromCenter.x,
      y: toBelow ? fromRect.top + fromRect.height + gap : fromRect.top - gap,
    },
    to: {
      x: toCenter.x,
      y: toBelow ? toRect.top - gap : toRect.top + toRect.height + gap,
    },
  };
}

function distance(a: WorldPoint, b: WorldPoint) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function resolveMarkupComposerPosition(input: {
  pointX: number;
  pointY: number;
  viewportWidth: number;
  viewportHeight: number;
}) {
  const width = Math.min(320, Math.max(248, input.viewportWidth - 24));
  const left = clamp(
    input.pointX + 14,
    12,
    Math.max(12, input.viewportWidth - width - 12),
  );
  const top = clamp(
    input.pointY - 16,
    12,
    Math.max(12, input.viewportHeight - 168),
  );
  return { left, top, width };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Keep the visible viewport inside the rendered grid. The grid is a fixed-size
 * child of the transformed world (board + GRID_PADDING on every side), so it is
 * large but finite; without this clamp a far-enough pan scrolls past the grid
 * edge into a blank void. Screen = pan + world * zoom, and the grid spans world
 * [-GRID_PADDING, board + GRID_PADDING], so bounding pan to the range below
 * guarantees the grid always fills the viewport while still allowing the full
 * GRID_PADDING of overscroll. A no-op until the viewport has been measured.
 */
function clampPanToGrid(
  view: CanvasView,
  board: { width: number; height: number },
  rect: DOMRect | null,
): CanvasView {
  if (!rect) return view;
  const { zoom } = view;
  const minPanX = rect.width - (board.width + GRID_PADDING) * zoom;
  const maxPanX = GRID_PADDING * zoom;
  const minPanY = rect.height - (board.height + GRID_PADDING) * zoom;
  const maxPanY = GRID_PADDING * zoom;
  return {
    zoom,
    pan: {
      x: minPanX <= maxPanX ? clamp(view.pan.x, minPanX, maxPanX) : view.pan.x,
      y: minPanY <= maxPanY ? clamp(view.pan.y, minPanY, maxPanY) : view.pan.y,
    },
  };
}
