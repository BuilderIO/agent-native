import {
  getPenPathGeometry,
  serializePenPath,
  type PenNode,
  type PenPath,
  type PenPoint,
} from "@shared/pen-path";

import type { CreatePrimitiveSpec } from "@/components/design/design-canvas/creation";
import type { CanvasPrimitiveInsert } from "@/components/design/multi-screen/types";

export function createPrimitiveInsertFromSpec(
  spec: CreatePrimitiveSpec,
  nodeId: string,
): CanvasPrimitiveInsert | null {
  if (spec.tool === "line" || spec.tool === "arrow") {
    const points = spec.points;
    if (!points || points.length < 2) return null;
    const [start, end] = points;
    if (!start || !end) return null;
    const left = Math.min(start.x, end.x);
    const top = Math.min(start.y, end.y);
    const width = Math.max(1, Math.abs(end.x - start.x));
    const height = Math.max(1, Math.abs(end.y - start.y));
    return {
      kind: spec.tool,
      nodeId,
      geometry: { x: left, y: top, width, height },
      points,
    };
  }

  if (spec.tool === "pen") {
    const penPath = spec.penPath;
    if (!penPath || penPath.nodes.length < 2) return null;
    const geometry = getPenPathGeometry(penPath);
    return {
      kind: "path",
      nodeId,
      geometry,
      points: penPath.nodes.map((node) => node.point),
      pathData: serializePenPath(penPath),
      penPath,
    };
  }

  const rect = spec.rect;
  if (!rect) return null;
  return {
    kind: spec.tool,
    nodeId,
    geometry: {
      x: rect.x,
      y: rect.y,
      width: Math.max(1, rect.width),
      height: Math.max(1, rect.height),
    },
    autoSize: spec.tool === "text" ? spec.fromClick : undefined,
  };
}

export function parsePenPathFromSerializedD(d: string): PenPath | null {
  const trimmed = d.trim();
  if (!trimmed) return null;
  const tokens = trimmed.match(/[MLCZ]|-?\d+(?:\.\d+)?/gi);
  if (!tokens || tokens.length === 0) return null;

  const readNumbers = (count: number): PenPoint[] => {
    const points: PenPoint[] = [];
    for (let i = 0; i < count; i += 2) {
      const x = Number(tokens[cursor + i]);
      const y = Number(tokens[cursor + i + 1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new Error("invalid pen path number");
      }
      points.push({ x, y });
    }
    return points;
  };

  let cursor = 0;
  const command = tokens[cursor];
  if (command?.toUpperCase() !== "M") return null;
  cursor += 1;

  try {
    const [start] = readNumbers(2);
    if (!start) return null;
    cursor += 2;
    const nodes: PenNode[] = [{ point: start }];
    let closed = false;

    while (cursor < tokens.length) {
      const token = tokens[cursor]?.toUpperCase();
      if (token === "Z") {
        cursor += 1;
        continue;
      }
      if (token === "L") {
        cursor += 1;
        const [to] = readNumbers(2);
        if (!to) return null;
        cursor += 2;
        const nextIsClose = tokens[cursor]?.toUpperCase() === "Z";
        if (nextIsClose && samePenPoint(to, nodes[0]!.point)) {
          closed = true;
        } else {
          nodes.push({ point: to });
          if (nextIsClose) closed = true;
        }
        continue;
      }
      if (token === "C") {
        cursor += 1;
        const coords = readNumbers(6);
        cursor += 6;
        const [c1, c2, to] = coords;
        if (!c1 || !c2 || !to) return null;
        const fromNode = nodes[nodes.length - 1];
        if (!fromNode) return null;
        if (!samePenPoint(c1, fromNode.point)) {
          fromNode.handleOut = c1;
        }
        const nextIsClose = tokens[cursor]?.toUpperCase() === "Z";
        if (nextIsClose && samePenPoint(to, nodes[0]!.point)) {
          closed = true;
          const firstNode = nodes[0];
          if (firstNode && !samePenPoint(c2, firstNode.point)) {
            firstNode.handleIn = c2;
          }
        } else {
          const node: PenNode = { point: to };
          if (!samePenPoint(c2, to)) node.handleIn = c2;
          nodes.push(node);
          if (nextIsClose) closed = true;
        }
        continue;
      }
      // Unknown token — grammar mismatch, bail rather than guess.
      return null;
    }

    return { nodes, closed };
  } catch {
    return null;
  }
}

function samePenPoint(a: PenPoint, b: PenPoint): boolean {
  return Math.abs(a.x - b.x) < 0.05 && Math.abs(a.y - b.y) < 0.05;
}

export function isDesignEditorDarkTheme(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.classList.contains("dark");
}

export function defaultCanvasTextColor(needsLightFill: boolean): string {
  // guard:allow-raw-color — written into the user's design HTML, where the editor's theme tokens do not exist
  return needsLightFill ? "#ffffff" : "currentColor";
}

export function defaultCanvasFrameFill(): string {
  // guard:allow-raw-color — written into the user's design HTML, where the editor's theme tokens do not exist
  return "#ffffff";
}

export const CANVAS_TEXT_DEFAULT_FONT_FAMILY =
  '"Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
