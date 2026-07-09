import { getDraftGeometryFromPoints } from "@shared/canvas-math";
import {
  clonePenPath,
  closePenPath,
  constrainPointTo45Degrees,
  getPenPathGeometry,
  scalePenPathToGeometry,
  serializePenPath,
  translatePenPath,
  type PenPath,
} from "@shared/pen-path";

import { DEFAULT_LINE_STROKE_WIDTH_PX } from "../canvas-primitive-style";
import { boardPointToScreenLocalPoint } from "./coordinate-transforms";
import { getFrameCenter } from "./frame-geometry";
import type {
  CanvasPrimitiveInsert,
  DraftCreationPreview,
  DraftCreationTool,
  DraftGeometryModifiers,
  DraftPrimitive,
  DraftPrimitiveInput,
  FrameGeometry,
  Point,
  ResolvedScreenMetadata,
} from "./types";

const DRAFT_FRAME_WIDTH = 320;
const DRAFT_FRAME_HEIGHT = 640;
const DRAFT_RECT_WIDTH = 100;
const DRAFT_RECT_HEIGHT = 100;
const DRAFT_TEXT_WIDTH = 180;
const DRAFT_TEXT_HEIGHT = 48;
export const DRAFT_LINE_WIDTH = 160;
const DRAFT_PATH_MIN_SIZE = 12;

export function isDraftPrimitive(
  value: DraftPrimitive | undefined,
): value is DraftPrimitive {
  return Boolean(value);
}

export function getDraftPreviewGeometryForTool(
  tool: DraftCreationTool,
  start: Point,
  end: Point,
  hasMoved: boolean,
  modifiers?: DraftGeometryModifiers,
): FrameGeometry {
  if (tool === "line" || tool === "arrow") {
    return getDraftGeometryForTool(tool, start, end, modifiers);
  }
  if (!hasMoved) {
    return { x: start.x, y: start.y, width: 0, height: 0 };
  }
  return getDraftGeometryForTool(tool, start, end, modifiers);
}

export function getDraftGeometryForTool(
  tool: DraftCreationTool,
  start: Point,
  end: Point,
  modifiers?: DraftGeometryModifiers,
): FrameGeometry {
  if (tool === "line" || tool === "arrow") {
    const effectiveEnd = modifiers?.shiftKey
      ? constrainPointTo45Degrees(start, end)
      : end;
    return getPathGeometry([start, effectiveEnd]);
  }
  const options =
    tool === "frame"
      ? {
          minWidth: 24,
          minHeight: 24,
          defaultWidth: DRAFT_FRAME_WIDTH,
          defaultHeight: DRAFT_FRAME_HEIGHT,
        }
      : tool === "text"
        ? {
            minWidth: 24,
            minHeight: 18,
            defaultWidth: DRAFT_TEXT_WIDTH,
            defaultHeight: DRAFT_TEXT_HEIGHT,
          }
        : {
            minWidth: 8,
            minHeight: 8,
            defaultWidth: DRAFT_RECT_WIDTH,
            defaultHeight: DRAFT_RECT_HEIGHT,
          };
  return getDraftGeometryFromPoints(start, end, {
    ...options,
    square: modifiers?.shiftKey,
    fromCenter: modifiers?.altKey,
  });
}

export function getPathGeometry(points: readonly Point[]): FrameGeometry {
  if (points.length === 0) {
    return {
      x: 0,
      y: 0,
      width: DRAFT_PATH_MIN_SIZE,
      height: DRAFT_PATH_MIN_SIZE,
    };
  }
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const right = Math.max(...xs);
  const bottom = Math.max(...ys);
  return {
    x: left,
    y: top,
    width: Math.max(DRAFT_PATH_MIN_SIZE, right - left),
    height: Math.max(DRAFT_PATH_MIN_SIZE, bottom - top),
  };
}

export function createDraftPrimitive({
  tool,
  start,
  end,
  moved,
  toolProps,
  modifiers,
}: DraftPrimitiveInput): DraftPrimitive {
  const id = createDraftId(tool);
  const geometry = moved
    ? getDraftGeometryForTool(tool, start, end, modifiers)
    : getDraftGeometryForTool(tool, start, start, modifiers);
  if (tool === "text") {
    return {
      id,
      kind: "text",
      geometry,
      text: toolProps?.text ?? "",
      fill: toolProps?.fill,
      stroke: toolProps?.stroke,
      autoSize: !moved,
    };
  }
  if (tool === "line" || tool === "arrow") {
    const effectiveEnd = modifiers?.shiftKey
      ? constrainPointTo45Degrees(start, end)
      : end;
    const pathPoints = moved
      ? [start, effectiveEnd]
      : [start, { x: start.x + DRAFT_LINE_WIDTH, y: start.y }];
    return {
      id,
      kind: tool,
      geometry: getPathGeometry(pathPoints),
      points: pathPoints,
      stroke: toolProps?.stroke,
      strokeWidth: toolProps?.strokeWidth ?? DEFAULT_LINE_STROKE_WIDTH_PX,
    };
  }
  return {
    id,
    kind:
      tool === "frame"
        ? "frame"
        : tool === "ellipse" || tool === "polygon" || tool === "star"
          ? tool
          : "rectangle",
    geometry,
    fill: toolProps?.fill,
    stroke: toolProps?.stroke,
    strokeWidth: toolProps?.strokeWidth,
  };
}

export function shapeClosingHandles(
  pathBefore: PenPath,
  dragPoint: Point | null,
): PenPath {
  const closed = closePenPath(pathBefore);
  if (!dragPoint || closed.nodes.length === 0) return closed;
  const first = closed.nodes[0];
  const handleIn = {
    x: first.point.x - (dragPoint.x - first.point.x),
    y: first.point.y - (dragPoint.y - first.point.y),
  };
  const nodes = closed.nodes.slice();
  nodes[0] = { ...first, handleIn };
  return { nodes, closed: true };
}

export function createPenDraftPrimitive(
  path: PenPath,
  {
    id = createDraftId("pen"),
    stroke,
    strokeWidth,
  }: { id?: string; stroke?: string; strokeWidth?: number } = {},
): DraftPrimitive {
  const penPath = clonePenPath(path);
  return {
    id,
    kind: "path",
    geometry: getPenPathGeometry(penPath),
    penPath,
    pathData: serializePenPath(penPath),
    stroke,
    strokeWidth: strokeWidth ?? DEFAULT_LINE_STROKE_WIDTH_PX,
  };
}

function createDraftId(tool: DraftCreationTool) {
  return `draft-${tool}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export function cloneDraftPrimitive(draft: DraftPrimitive): DraftPrimitive {
  return {
    ...draft,
    geometry: { ...draft.geometry },
    points: draft.points?.map((point) => ({ ...point })),
    penPath: draft.penPath ? clonePenPath(draft.penPath) : undefined,
  };
}

export function draftPrimitiveToInsert(
  draft: DraftPrimitive,
  frameGeometry: FrameGeometry,
  metadata?: ResolvedScreenMetadata,
): CanvasPrimitiveInsert {
  const viewport = {
    width: metadata?.width ?? frameGeometry.width,
    height: metadata?.height ?? frameGeometry.height,
  };
  const scaleX = viewport.width / Math.max(1, frameGeometry.width);
  const scaleY = viewport.height / Math.max(1, frameGeometry.height);
  const roundLocal = (value: number) => Math.round(value) || 0;
  const toLocalPointRaw = (point: Point) =>
    boardPointToScreenLocalPoint(point, frameGeometry, viewport);
  const toLocalPoint = (point: Point) => {
    const local = toLocalPointRaw(point);
    return { x: roundLocal(local.x), y: roundLocal(local.y) };
  };
  const scaledPenPath = draft.penPath
    ? {
        ...draft.penPath,
        nodes: draft.penPath.nodes.map((node) => ({
          point: toLocalPoint(node.point),
          handleIn: node.handleIn ? toLocalPoint(node.handleIn) : undefined,
          handleOut: node.handleOut ? toLocalPoint(node.handleOut) : undefined,
        })),
      }
    : undefined;
  const draftCenterLocal = toLocalPointRaw(getFrameCenter(draft.geometry));
  const localWidth = Math.max(1, Math.round(draft.geometry.width * scaleX));
  const localHeight = Math.max(1, Math.round(draft.geometry.height * scaleY));
  const localRotation =
    (draft.geometry.rotation ?? 0) - (frameGeometry.rotation ?? 0);
  const localGeometry = scaledPenPath
    ? getPenPathGeometry(scaledPenPath)
    : {
        ...draft.geometry,
        x: roundLocal(draftCenterLocal.x - localWidth / 2),
        y: roundLocal(draftCenterLocal.y - localHeight / 2),
        width: localWidth,
        height: localHeight,
        rotation: localRotation || undefined,
      };
  return {
    kind: draft.kind,
    nodeId: draft.id,
    geometry: localGeometry,
    points: draft.points?.map(toLocalPoint),
    pathData: scaledPenPath ? serializePenPath(scaledPenPath) : undefined,
    text: draft.text,
    fill: draft.fill,
    stroke: draft.stroke,
    strokeWidth: draft.strokeWidth,
    autoSize: draft.autoSize,
  };
}

export function moveDraftPrimitive(
  draft: DraftPrimitive,
  dx: number,
  dy: number,
): DraftPrimitive {
  const movedPenPath = draft.penPath
    ? translatePenPath(draft.penPath, dx, dy)
    : undefined;
  return {
    ...draft,
    geometry: {
      ...draft.geometry,
      x: draft.geometry.x + dx,
      y: draft.geometry.y + dy,
    },
    points: draft.points?.map((point) => ({
      x: point.x + dx,
      y: point.y + dy,
    })),
    penPath: movedPenPath,
    pathData: movedPenPath ? serializePenPath(movedPenPath) : draft.pathData,
  };
}

export function applyDraftGeometry(
  draft: DraftPrimitive,
  geometry: FrameGeometry,
  scaleK?: boolean,
): DraftPrimitive {
  const origin = draft.geometry;
  const scaleX = geometry.width / Math.max(1, origin.width);
  const scaleY = geometry.height / Math.max(1, origin.height);
  const scaledPenPath = draft.penPath
    ? scalePenPathToGeometry(draft.penPath, origin, geometry)
    : undefined;
  const scaledStrokeWidth =
    scaleK && draft.strokeWidth !== undefined
      ? Math.max(
          0,
          Math.round(draft.strokeWidth * Math.max(scaleX, scaleY) * 100) / 100,
        )
      : draft.strokeWidth;
  return {
    ...draft,
    geometry,
    points: draft.points?.map((point) => ({
      x: geometry.x + (point.x - origin.x) * scaleX,
      y: geometry.y + (point.y - origin.y) * scaleY,
    })),
    penPath: scaledPenPath,
    pathData: scaledPenPath ? serializePenPath(scaledPenPath) : draft.pathData,
    strokeWidth: scaledStrokeWidth,
  };
}

export function polygonPointsForBox(
  kind: "polygon" | "star",
  width: number,
  height: number,
) {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const cx = safeWidth / 2;
  const cy = safeHeight / 2;
  const radius = Math.max(1, Math.min(safeWidth, safeHeight) / 2);
  const points: Point[] = [];

  if (kind === "polygon") {
    for (let index = 0; index < 3; index += 1) {
      const angle = -Math.PI / 2 + (index * Math.PI * 2) / 3;
      points.push({
        x: cx + Math.cos(angle) * radius,
        y: cy + Math.sin(angle) * radius,
      });
    }
  } else {
    for (let index = 0; index < 10; index += 1) {
      const angle = -Math.PI / 2 + (index * Math.PI) / 5;
      const pointRadius = index % 2 === 0 ? radius : radius * 0.45;
      points.push({
        x: cx + Math.cos(angle) * pointRadius,
        y: cy + Math.sin(angle) * pointRadius,
      });
    }
  }

  return points
    .map((point) => `${roundCoord(point.x)},${roundCoord(point.y)}`)
    .join(" ");
}

export function pointsToPath(points: readonly Point[]) {
  if (points.length === 0) return "";
  const [first, ...rest] = points;
  return [
    `M ${roundCoord(first.x)} ${roundCoord(first.y)}`,
    ...rest.map((point) => `L ${roundCoord(point.x)} ${roundCoord(point.y)}`),
  ].join(" ");
}

function roundCoord(value: number) {
  return Math.round(value * 10) / 10;
}

export function previewDraftPrimitive(
  preview: DraftCreationPreview,
): DraftPrimitive {
  return {
    id: "draft-preview",
    kind:
      preview.tool === "pen"
        ? "path"
        : preview.tool === "frame"
          ? "frame"
          : preview.tool === "text"
            ? "text"
            : preview.tool === "line" ||
                preview.tool === "arrow" ||
                preview.tool === "ellipse" ||
                preview.tool === "polygon" ||
                preview.tool === "star"
              ? preview.tool
              : "rectangle",
    geometry: preview.geometry,
    points:
      preview.points ??
      (preview.tool === "line" || preview.tool === "arrow"
        ? [
            {
              x: preview.geometry.x,
              y: preview.geometry.y + preview.geometry.height / 2,
            },
            {
              x: preview.geometry.x + preview.geometry.width,
              y: preview.geometry.y + preview.geometry.height / 2,
            },
          ]
        : undefined),
    text: "Text", // i18n-ignore preview-only canvas placeholder
  };
}
