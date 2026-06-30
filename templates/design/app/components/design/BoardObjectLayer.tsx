import type { BoardObjectEntry } from "@shared/board-objects";
import type * as React from "react";

import { cn } from "@/lib/utils";

import { getChromeBorderTransition } from "./MultiScreenCanvas";

// Keep in sync with the non-exported `const SURFACE_PADDING = 240` in
// MultiScreenCanvas.tsx. Board objects use the same canvas coordinate space
// as screen frames, so we need the identical offset.
const SURFACE_PADDING = 240;

export interface BoardObjectLayerProps {
  boardObject: BoardObjectEntry;
  isSelected: boolean;
  groupSelected: boolean;
  chromeScale: number;
  chromeSettling: boolean;
  onClick: (id: string, e: React.MouseEvent) => void;
  onStartDrag: (id: string, e: React.MouseEvent) => void;
  onStartResize: (id: string, handle: string, e: React.MouseEvent) => void;
}

/**
 * Renders a persisted board object (from SQL) absolutely on the canvas surface.
 * Visually mirrors DraftPrimitiveLayer but drives from BoardObjectEntry instead
 * of the transient DraftPrimitive type.
 *
 * Keep in sync with DraftPrimitiveLayer / DraftPrimitiveContent in
 * MultiScreenCanvas.tsx — same shape-rendering logic, same chrome metrics.
 */
export function BoardObjectLayer({
  boardObject,
  isSelected,
  groupSelected,
  chromeScale,
  chromeSettling,
  onClick,
  onStartDrag,
  onStartResize,
}: BoardObjectLayerProps) {
  const { geometry } = boardObject;
  const selected = isSelected && !groupSelected;
  return (
    <button
      data-frame-shell
      data-board-object-id={boardObject.id}
      type="button"
      className="group/artboard pointer-events-auto absolute block overflow-visible text-left outline-none cursor-pointer"
      style={{
        left: SURFACE_PADDING + geometry.x,
        top: SURFACE_PADDING + geometry.y,
        width: Math.max(1, geometry.width),
        height: Math.max(1, geometry.height),
        zIndex: geometry.z ?? 40,
        transform: geometry.rotation
          ? `rotate(${geometry.rotation}deg)`
          : undefined,
      }}
      onClick={(event) => {
        onClick(boardObject.id, event);
      }}
      onMouseDown={(event) => {
        onStartDrag(boardObject.id, event);
      }}
    >
      <BoardObjectContent boardObject={boardObject} />
      {/* Board-object chrome sits on the object edge, unlike screen frames. */}
      <span
        data-board-object-selection-outline
        className={cn(
          "pointer-events-none absolute rounded-sm border transition-opacity",
          selected
            ? "border-[var(--design-editor-accent-color)] opacity-100"
            : "border-[var(--design-editor-accent-color)] opacity-0 group-hover/artboard:opacity-100",
        )}
        style={{
          inset: 0,
          borderWidth: 1.5 * chromeScale,
          transition: getChromeBorderTransition(chromeSettling),
        }}
      />
      {/* Corner resize handles (shown only when selected) */}
      {selected ? (
        <BoardObjectResizeHandles
          chromeScale={chromeScale}
          onStartResize={(handle, e) =>
            onStartResize(boardObject.id, handle, e)
          }
        />
      ) : null}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Visual content — mirrors DraftPrimitiveContent in MultiScreenCanvas.tsx
// keep in sync with DraftPrimitiveContent rendering logic
// ---------------------------------------------------------------------------

function BoardObjectContent({
  boardObject,
}: {
  boardObject: BoardObjectEntry;
}) {
  const { kind, fill, stroke, strokeWidth, text, pathData, points, geometry } =
    boardObject;

  if (kind === "path" || kind === "line" || kind === "arrow") {
    const markerId = `arrow-bo-${boardObject.id.replace(/[^a-zA-Z0-9_-]/g, "")}`;
    let d = pathData ?? "";
    if (!d && points && points.length >= 2) {
      d = points
        .map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`))
        .join(" ");
    }
    return (
      <svg
        className="block size-full overflow-visible"
        viewBox={`${geometry.x} ${geometry.y} ${Math.max(1, geometry.width)} ${Math.max(1, geometry.height)}`}
      >
        {kind === "arrow" ? (
          <defs>
            <marker
              id={markerId}
              markerWidth="10"
              markerHeight="10"
              refX="8"
              refY="5"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
            </marker>
          </defs>
        ) : null}
        <path
          d={d}
          fill="none"
          stroke={stroke ?? "hsl(var(--primary))"}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={strokeWidth ?? 3}
          markerEnd={kind === "arrow" ? `url(#${markerId})` : undefined}
        />
      </svg>
    );
  }

  if (kind === "text") {
    return (
      <div
        className="flex size-full items-start px-2 py-1 text-sm font-medium text-foreground"
        style={{
          color: fill ?? undefined,
        }}
      >
        <span className="truncate">{text ?? ""}</span>
      </div>
    );
  }

  if (kind === "frame") {
    return (
      <div
        className="size-full"
        style={{
          background: fill ?? "hsl(var(--muted) / 0.5)",
          border: `${strokeWidth ?? 1}px solid ${stroke ?? "hsl(var(--border))"}`,
        }}
      />
    );
  }

  if (kind === "ellipse") {
    return (
      <div
        className="size-full"
        style={{
          borderRadius: "50%",
          background: fill ?? "hsl(var(--primary) / 0.12)",
          border: `${strokeWidth ?? 1.5}px solid ${stroke ?? "hsl(var(--primary))"}`,
        }}
      />
    );
  }

  if (kind === "polygon" || kind === "star") {
    const safeW = Math.max(1, geometry.width);
    const safeH = Math.max(1, geometry.height);
    const cx = safeW / 2;
    const cy = safeH / 2;
    const radius = Math.max(1, Math.min(safeW, safeH) / 2);
    const polyPoints: string[] = [];
    if (kind === "polygon") {
      for (let i = 0; i < 3; i++) {
        const angle = -Math.PI / 2 + (i * Math.PI * 2) / 3;
        polyPoints.push(
          `${cx + Math.cos(angle) * radius},${cy + Math.sin(angle) * radius}`,
        );
      }
    } else {
      for (let i = 0; i < 10; i++) {
        const angle = -Math.PI / 2 + (i * Math.PI) / 5;
        const r = i % 2 === 0 ? radius : radius * 0.45;
        polyPoints.push(
          `${cx + Math.cos(angle) * r},${cy + Math.sin(angle) * r}`,
        );
      }
    }
    return (
      <svg
        className="block size-full overflow-visible"
        viewBox={`0 0 ${safeW} ${safeH}`}
      >
        <polygon
          points={polyPoints.join(" ")}
          fill={fill ?? "hsl(var(--primary) / 0.12)"}
          stroke={stroke ?? "hsl(var(--primary))"}
          strokeLinejoin="round"
          strokeWidth={strokeWidth ?? 1.5}
        />
      </svg>
    );
  }

  // rectangle / default
  return (
    <div
      className="size-full"
      style={{
        background: fill ?? "hsl(var(--primary) / 0.12)",
        border: `${strokeWidth ?? 1.5}px solid ${stroke ?? "hsl(var(--primary))"}`,
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Corner resize handles for selected board objects
// ---------------------------------------------------------------------------

const BOARD_OBJ_HANDLE_CONFIGS: Array<{
  handle: string;
  cursor: string;
  styleKey: "nw" | "ne" | "se" | "sw";
}> = [
  { handle: "nw", cursor: "nwse-resize", styleKey: "nw" },
  { handle: "ne", cursor: "nesw-resize", styleKey: "ne" },
  { handle: "se", cursor: "nwse-resize", styleKey: "se" },
  { handle: "sw", cursor: "nesw-resize", styleKey: "sw" },
];

function boardObjHandleStyle(
  styleKey: "nw" | "ne" | "se" | "sw",
  chromeScale: number,
): React.CSSProperties {
  const size = 10 * chromeScale;
  const offset = -size / 2;
  return {
    width: size,
    height: size,
    borderWidth: Math.max(1, 1.25 * chromeScale),
    ...(styleKey.includes("n") ? { top: offset } : { bottom: offset }),
    ...(styleKey.includes("w") ? { left: offset } : { right: offset }),
  };
}

function BoardObjectResizeHandles({
  chromeScale,
  onStartResize,
}: {
  chromeScale: number;
  onStartResize: (handle: string, e: React.MouseEvent) => void;
}) {
  return (
    <>
      {BOARD_OBJ_HANDLE_CONFIGS.map((config) => (
        <span
          key={config.handle}
          data-board-obj-resize-handle={config.handle}
          className="pointer-events-auto absolute z-20 rounded-[2px] border border-[var(--design-editor-accent-color)] bg-[var(--design-editor-accent-contrast-color)] shadow opacity-100"
          style={{
            ...boardObjHandleStyle(config.styleKey, chromeScale),
            cursor: config.cursor,
          }}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onStartResize(config.handle, e);
          }}
        />
      ))}
    </>
  );
}
