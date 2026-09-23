import {
  getPenPathGeometry,
  serializePenPath,
  type PenNode,
  type PenPath,
  type PenPoint,
} from "@shared/pen-path";

import type { CreatePrimitiveSpec } from "@/components/design/design-canvas/creation";
import type { CanvasPrimitiveInsert } from "@/components/design/multi-screen/types";

/**
 * P4/single-screen placement: converts a `CreatePrimitiveSpec` emitted by
 * DesignCanvas's single-screen click-to-place overlay (coordinates already in
 * screen-content space, matching `appendCanvasPrimitiveToHtml`'s own
 * coordinate system) into the `CanvasPrimitiveInsert` shape the overview path
 * (`handleCreatePrimitive` / `appendCanvasPrimitiveToHtml`) already knows how
 * to persist. This deliberately reuses the exact same insert shape as
 * `draftPrimitiveToInsert` produces in MultiScreenCanvas.tsx so single-screen
 * and overview creation commit through one shared persistence path instead of
 * two.
 *
 * Pen specs carry the complete structured path collected by DesignCanvas's
 * single-screen overlay. Keeping the nodes and handles intact makes focused
 * screen authoring behave like overview/Figma pen authoring instead of
 * fabricating a fixed-length line from the first point.
 */
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

/**
 * Reconstructs a structured `PenPath` (nodes + optional handles) from a `d`
 * string produced by `serializePenPath` (shared/pen-path.ts). This is the
 * deliberate INVERSE of that exact serializer — not a general SVG path
 * parser — so it only needs to understand the small grammar
 * `serializePenPath` actually emits: `M x y`, then per-segment `L x y` (both
 * handles coincide with their anchors) or `C c1x c1y c2x c2y x y`
 * (`c1`/`c2` are the FROM node's `handleOut` / TO node's `handleIn`,
 * respectively — see `serializeSegment`), optionally followed by a trailing
 * `Z` for a closed path. The serializer writes an explicit final segment to
 * the first node before `Z`; ordinary SVG paths may instead end on their last
 * node and use `Z` for the implicit closing segment.
 *
 * This remains the fallback for inserts that only carry flattened `pathData`.
 * New overview and single-screen Pen inserts also carry `penPath` directly,
 * preserving the full node/handle model across the commit boundary.
 *
 * Returns `null` for anything that doesn't match the expected grammar
 * (empty/malformed `d`) rather than throwing, so a call site can always fall
 * back to skipping `data-an-pen-nodes` for that element.
 */
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
        // Only the serializer's explicit final segment back to the first
        // anchor is a wrap-around; an ordinary SVG's last node is still real.
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
        // As above, only a segment that actually targets the first anchor is
        // the serializer's explicit wrap-around segment.
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

// Reads the app's actual resolved theme (next-themes' `dark` class on
// <html>) rather than raw OS `prefers-color-scheme`.
export function isDesignEditorDarkTheme(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.classList.contains("dark");
}

/**
 * Default text color for a freshly drawn text primitive, chosen from the
 * surface it lands on — the caller measures that, because the board's own
 * document is transparent and its colour lives on the host. `currentColor`
 * inherits the unstyled document's black, which is invisible on a dark one.
 */
export function defaultCanvasTextColor(needsLightFill: boolean): string {
  // guard:allow-raw-color — written into the user's design HTML, where the editor's theme tokens do not exist
  return needsLightFill ? "#ffffff" : "currentColor";
}

/**
 * A committed frame needs a surface of its own: once deselected, a bare
 * container is indistinguishable from empty canvas, and so is the next one
 * drawn beside it. White on every destination, as in Figma.
 */
export function defaultCanvasFrameFill(): string {
  // guard:allow-raw-color — written into the user's design HTML, where the editor's theme tokens do not exist
  return "#ffffff";
}

/** Default font stack for board-drawn text — Inter with the app's standard
 * system-font fallback chain, matching the rest of the editor's UI type
 * instead of the browser's serif default for an unstyled <div>. */
export const CANVAS_TEXT_DEFAULT_FONT_FAMILY =
  '"Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
