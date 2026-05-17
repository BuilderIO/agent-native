import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  IconDeviceFloppy,
  IconPencil,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import {
  type FeatureConfig,
  type RegionGuideRect,
  useFeatureConfig,
} from "../shared/config";

const MIN_RECT_SIZE = 0.012;
const DEFAULT_DRAW_ASPECT_RATIO = 1;
const RESIZE_CORNERS = ["nw", "ne", "sw", "se"] as const;

type ResizeCorner = (typeof RESIZE_CORNERS)[number];

interface Point {
  x: number;
  y: number;
}

interface SurfaceSize {
  width: number;
  height: number;
}

interface DrawState {
  kind: "draw";
  pointerId: number;
  id: string;
  start: Point;
}

interface MoveState {
  kind: "move";
  pointerId: number;
  id: string;
  start: Point;
  origin: RegionGuideRect;
}

interface ResizeState {
  kind: "resize";
  pointerId: number;
  id: string;
  corner: ResizeCorner;
  origin: RegionGuideRect;
  aspectRatio: number;
}

type InteractionState = DrawState | MoveState | ResizeState;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeRect(rect: RegionGuideRect): RegionGuideRect | null {
  const width = Math.min(1, Math.max(0, rect.width));
  const height = Math.min(1, Math.max(0, rect.height));
  if (width < MIN_RECT_SIZE || height < MIN_RECT_SIZE) return null;
  const x = clamp(rect.x, 0, 1 - width);
  const y = clamp(rect.y, 0, 1 - height);
  return { ...rect, x, y, width, height };
}

function normalizeRects(
  rects: RegionGuideRect[] | undefined,
): RegionGuideRect[] {
  return (rects ?? [])
    .map(normalizeRect)
    .filter((rect): rect is RegionGuideRect => rect !== null);
}

function createRectId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `guide-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function pointForEvent(
  event: React.PointerEvent,
  element: HTMLElement | null,
): Point {
  if (!element) return { x: 0, y: 0 };
  const bounds = element.getBoundingClientRect();
  const width = Math.max(1, bounds.width);
  const height = Math.max(1, bounds.height);
  return {
    x: clamp01((event.clientX - bounds.left) / width),
    y: clamp01((event.clientY - bounds.top) / height),
  };
}

function surfaceSize(element: HTMLElement | null): SurfaceSize {
  if (!element) return { width: 1, height: 1 };
  const bounds = element.getBoundingClientRect();
  return {
    width: Math.max(1, bounds.width),
    height: Math.max(1, bounds.height),
  };
}

function rectFromPoints(
  id: string,
  a: Point,
  b: Point,
): RegionGuideRect | null {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const width = Math.abs(a.x - b.x);
  const height = Math.abs(a.y - b.y);
  return normalizeRect({ id, x, y, width, height });
}

function fixedCornerForResize(rect: RegionGuideRect, corner: ResizeCorner) {
  return {
    x: corner.includes("w") ? rect.x + rect.width : rect.x,
    y: corner.includes("n") ? rect.y + rect.height : rect.y,
  };
}

function visualAspectRatio(rect: RegionGuideRect, size: SurfaceSize): number {
  const widthPx = Math.max(1, rect.width * size.width);
  const heightPx = Math.max(1, rect.height * size.height);
  return widthPx / heightPx;
}

function aspectLockedRectFromPoints({
  id,
  anchor,
  point,
  aspectRatio,
  size,
}: {
  id: string;
  anchor: Point;
  point: Point;
  aspectRatio: number;
  size: SurfaceSize;
}): RegionGuideRect | null {
  const safeAspect =
    Number.isFinite(aspectRatio) && aspectRatio > 0
      ? aspectRatio
      : DEFAULT_DRAW_ASPECT_RATIO;
  const signX = point.x >= anchor.x ? 1 : -1;
  const signY = point.y >= anchor.y ? 1 : -1;
  const widthPxFromPointer = Math.abs(point.x - anchor.x) * size.width;
  const heightPxFromPointer = Math.abs(point.y - anchor.y) * size.height;

  let widthPx = Math.max(
    MIN_RECT_SIZE * size.width,
    widthPxFromPointer,
    heightPxFromPointer * safeAspect,
  );
  let heightPx = widthPx / safeAspect;

  const maxWidthPx = (signX > 0 ? 1 - anchor.x : anchor.x) * size.width;
  const maxHeightPx = (signY > 0 ? 1 - anchor.y : anchor.y) * size.height;
  if (widthPx > maxWidthPx) {
    widthPx = maxWidthPx;
    heightPx = widthPx / safeAspect;
  }
  if (heightPx > maxHeightPx) {
    heightPx = maxHeightPx;
    widthPx = heightPx * safeAspect;
  }

  return rectFromPoints(id, anchor, {
    x: anchor.x + (signX * widthPx) / size.width,
    y: anchor.y + (signY * heightPx) / size.height,
  });
}

function squareRectFromPoints(
  id: string,
  start: Point,
  point: Point,
  size: SurfaceSize,
): RegionGuideRect | null {
  return aspectLockedRectFromPoints({
    id,
    anchor: start,
    point,
    aspectRatio: DEFAULT_DRAW_ASPECT_RATIO,
    size,
  });
}

function movedRect(
  origin: RegionGuideRect,
  start: Point,
  point: Point,
): RegionGuideRect | null {
  return normalizeRect({
    ...origin,
    x: origin.x + point.x - start.x,
    y: origin.y + point.y - start.y,
  });
}

function resizedRect({
  origin,
  corner,
  point,
  keepAspectRatio,
  aspectRatio,
  size,
}: {
  origin: RegionGuideRect;
  corner: ResizeCorner;
  point: Point;
  keepAspectRatio: boolean;
  aspectRatio: number;
  size: SurfaceSize;
}): RegionGuideRect | null {
  const anchor = fixedCornerForResize(origin, corner);
  if (keepAspectRatio) {
    return aspectLockedRectFromPoints({
      id: origin.id,
      anchor,
      point,
      aspectRatio,
      size,
    });
  }
  return rectFromPoints(origin.id, anchor, point);
}

function rectStyle(rect: RegionGuideRect): React.CSSProperties {
  return {
    left: `${rect.x * 100}%`,
    top: `${rect.y * 100}%`,
    width: `${rect.width * 100}%`,
    height: `${rect.height * 100}%`,
  };
}

function regionGuideConfig(config: FeatureConfig | null) {
  return (
    config?.regionGuides ?? {
      enabled: false,
      rects: [],
    }
  );
}

export function RegionGuides() {
  const config = useFeatureConfig();
  const guides = regionGuideConfig(config);
  const rects = useMemo(() => normalizeRects(guides.rects), [guides.rects]);

  useEffect(() => {
    if (!config) return;
    if (guides.enabled && rects.length > 0) return;
    getCurrentWindow()
      .close()
      .catch(() => {});
  }, [config, guides.enabled, rects.length]);

  if (!guides.enabled || rects.length === 0) return null;

  return (
    <div className="region-guides-layer" aria-hidden>
      {rects.map((rect) => (
        <div
          key={rect.id}
          className="region-guide-rect"
          style={rectStyle(rect)}
        />
      ))}
    </div>
  );
}

export function RegionGuideEditor() {
  const config = useFeatureConfig();
  const guides = regionGuideConfig(config);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const interactionRef = useRef<InteractionState | null>(null);
  const [rects, setRects] = useState<RegionGuideRect[]>([]);
  const [draft, setDraft] = useState<RegionGuideRect | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (dirty) return;
    setRects(normalizeRects(guides.rects));
  }, [dirty, guides.rects]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (interactionRef.current) {
          interactionRef.current = null;
          setDraft(null);
          return;
        }
        getCurrentWindow()
          .close()
          .catch(() => {});
      }
      if (event.key === "Backspace" || event.key === "Delete") {
        if (!selectedId) return;
        event.preventDefault();
        deleteSelected();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  function updateRect(nextRect: RegionGuideRect | null) {
    if (!nextRect) return;
    setRects((current) =>
      current.map((rect) => (rect.id === nextRect.id ? nextRect : rect)),
    );
    setDirty(true);
    setMessage(null);
  }

  function deleteSelected() {
    if (!selectedId) return;
    setRects((current) => current.filter((rect) => rect.id !== selectedId));
    setSelectedId(null);
    setDirty(true);
    setMessage(null);
  }

  function clearRects() {
    setRects([]);
    setSelectedId(null);
    setDirty(true);
    setMessage(null);
  }

  async function savePreset() {
    if (!config || saving) return;
    setSaving(true);
    setMessage(null);
    const nextRects = normalizeRects(rects);
    try {
      await invoke("set_feature_config", {
        config: {
          ...config,
          regionGuides: {
            ...config.regionGuides,
            enabled: nextRects.length > 0,
            rects: nextRects,
            alwaysVisible:
              nextRects.length > 0
                ? (config.regionGuides.alwaysVisible ?? false)
                : false,
          },
        },
      });
      setRects(nextRects);
      setSelectedId((current) =>
        current && nextRects.some((rect) => rect.id === current)
          ? current
          : null,
      );
      setDirty(false);
      setMessage(nextRects.length > 0 ? "Preset saved." : "Preset cleared.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  function closeEditor() {
    getCurrentWindow()
      .close()
      .catch(() => {});
  }

  function startDrawing(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (
      target.closest("[data-region-toolbar]") ||
      target.closest("[data-region-rect]")
    ) {
      return;
    }
    const point = pointForEvent(event, surfaceRef.current);
    const id = createRectId();
    interactionRef.current = {
      kind: "draw",
      pointerId: event.pointerId,
      id,
      start: point,
    };
    setSelectedId(null);
    setMessage(null);
    setDraft(null);
    surfaceRef.current?.setPointerCapture(event.pointerId);
  }

  function startMoving(
    event: React.PointerEvent<HTMLDivElement>,
    rect: RegionGuideRect,
  ) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const point = pointForEvent(event, surfaceRef.current);
    interactionRef.current = {
      kind: "move",
      pointerId: event.pointerId,
      id: rect.id,
      start: point,
      origin: rect,
    };
    setSelectedId(rect.id);
    setMessage(null);
    surfaceRef.current?.setPointerCapture(event.pointerId);
  }

  function startResizing(
    event: React.PointerEvent<HTMLDivElement>,
    rect: RegionGuideRect,
    corner: ResizeCorner,
  ) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    interactionRef.current = {
      kind: "resize",
      pointerId: event.pointerId,
      id: rect.id,
      corner,
      origin: rect,
      aspectRatio: visualAspectRatio(rect, surfaceSize(surfaceRef.current)),
    };
    setSelectedId(rect.id);
    setMessage(null);
    surfaceRef.current?.setPointerCapture(event.pointerId);
  }

  function updateInteraction(event: React.PointerEvent<HTMLDivElement>) {
    const interaction = interactionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) {
      return;
    }
    const point = pointForEvent(event, surfaceRef.current);
    const size = surfaceSize(surfaceRef.current);

    if (interaction.kind === "draw") {
      setDraft(
        squareRectFromPoints(interaction.id, interaction.start, point, size),
      );
      return;
    }

    if (interaction.kind === "move") {
      updateRect(movedRect(interaction.origin, interaction.start, point));
      return;
    }

    updateRect(
      resizedRect({
        origin: interaction.origin,
        corner: interaction.corner,
        point,
        keepAspectRatio: event.shiftKey,
        aspectRatio: interaction.aspectRatio,
        size,
      }),
    );
  }

  function finishInteraction(event: React.PointerEvent<HTMLDivElement>) {
    const interaction = interactionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) {
      return;
    }
    if (interaction.kind === "draw") {
      const point = pointForEvent(event, surfaceRef.current);
      const nextRect = squareRectFromPoints(
        interaction.id,
        interaction.start,
        point,
        surfaceSize(surfaceRef.current),
      );
      if (nextRect) {
        setRects((current) => [...current, nextRect]);
        setSelectedId(nextRect.id);
        setDirty(true);
      }
    }
    interactionRef.current = null;
    setDraft(null);
    try {
      const surface = surfaceRef.current;
      if (surface?.hasPointerCapture(event.pointerId)) {
        surface.releasePointerCapture(event.pointerId);
      }
    } catch {
      // ignore — pointer capture is best-effort here.
    }
  }

  return (
    <div
      ref={surfaceRef}
      className="region-guides-editor"
      onPointerDown={startDrawing}
      onPointerMove={updateInteraction}
      onPointerUp={finishInteraction}
      onPointerCancel={finishInteraction}
    >
      <div className="region-guide-editor-bar" data-region-toolbar>
        <div className="region-guide-editor-title">
          <IconPencil size={16} stroke={1.8} />
          <span>Region guide preset</span>
          <span className="region-guide-editor-count">
            {rects.length} {rects.length === 1 ? "box" : "boxes"}
          </span>
        </div>
        <div className="region-guide-editor-actions">
          <button
            type="button"
            className="region-guide-editor-button"
            onClick={deleteSelected}
            disabled={!selectedId}
          >
            <IconTrash size={15} stroke={1.9} />
            Delete
          </button>
          <button
            type="button"
            className="region-guide-editor-button"
            onClick={clearRects}
            disabled={rects.length === 0}
          >
            Clear
          </button>
          <button
            type="button"
            className="region-guide-editor-button region-guide-editor-button-primary"
            onClick={savePreset}
            disabled={!dirty || saving || !config}
          >
            <IconDeviceFloppy size={15} stroke={1.9} />
            {saving ? "Saving" : "Save"}
          </button>
          <button
            type="button"
            className="region-guide-editor-icon"
            onClick={closeEditor}
            aria-label="Close"
          >
            <IconX size={17} stroke={1.9} />
          </button>
        </div>
        {message ? (
          <div className="region-guide-editor-message" aria-live="polite">
            {message}
          </div>
        ) : null}
      </div>

      <div className="region-guide-editor-hint" data-region-toolbar>
        Square guides. Corners resize. Drag a box to move.
      </div>

      {rects.map((rect) => (
        <div
          key={rect.id}
          role="button"
          tabIndex={0}
          data-region-rect
          className={`region-guide-rect region-guide-rect-editable ${
            selectedId === rect.id ? "selected" : ""
          }`}
          style={rectStyle(rect)}
          onPointerDown={(event) => startMoving(event, rect)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setSelectedId(rect.id);
            }
            if (event.key === "Backspace" || event.key === "Delete") {
              event.preventDefault();
              setRects((current) =>
                current.filter((currentRect) => currentRect.id !== rect.id),
              );
              setSelectedId(null);
              setDirty(true);
            }
          }}
        >
          {selectedId === rect.id
            ? RESIZE_CORNERS.map((corner) => (
                <div
                  key={corner}
                  data-region-handle
                  className={`region-guide-handle region-guide-handle-${corner}`}
                  onPointerDown={(event) => startResizing(event, rect, corner)}
                />
              ))
            : null}
        </div>
      ))}

      {draft ? (
        <div
          className="region-guide-rect region-guide-rect-draft"
          style={rectStyle(draft)}
        />
      ) : null}
    </div>
  );
}
