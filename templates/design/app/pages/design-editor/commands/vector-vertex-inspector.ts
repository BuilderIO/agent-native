import {
  movePenAnchor,
  parsePenNodes,
  penCornerRadiusFromAttribute,
  penNodeMirroring,
  setPenNodeCornerRadius,
  setPenNodeMirroring,
  type PenMirroring,
  type PenNode,
  type PenPath,
} from "@shared/pen-path";

import { MIXED_VALUE } from "@/components/design/edit-panel/selection-helpers";
import type { ElementInfo } from "@/components/design/types";

export interface VectorVertexEditState {
  path: PenPath;
  selectedNodeIndex: number | null;
}

const RADIUS_PROPERTY =
  /^border(TopLeft|TopRight|BottomRight|BottomLeft)?Radius$/;

export function selectedVectorVertex(
  state: VectorVertexEditState | null,
): PenNode | null {
  if (!state || state.selectedNodeIndex == null) return null;
  return state.path.nodes[state.selectedNodeIndex] ?? null;
}

export function vectorVertexInspectorElement(
  element: ElementInfo | null,
  vertex: PenNode | null,
  vectorAttributes: {
    penNodes: string | undefined;
    cornerRadius: string | undefined;
  },
): ElementInfo | null {
  if (!element || element.tagName.toLowerCase() !== "svg") return element;
  const objectPx = penCornerRadiusFromAttribute(vectorAttributes.cornerRadius);
  let radius: string;
  if (vertex) {
    radius = `${vertex.cornerRadius ?? objectPx}px`;
  } else {
    const nodes = vectorAttributes.penNodes
      ? (parsePenNodes(vectorAttributes.penNodes)?.nodes ?? [])
      : [];
    const mixed = nodes.some(
      (node) =>
        node.cornerRadius !== undefined && node.cornerRadius !== objectPx,
    );
    radius = mixed ? MIXED_VALUE : `${objectPx}px`;
  }
  const radiusStyles = {
    borderRadius: radius,
    borderTopLeftRadius: radius,
    borderTopRightRadius: radius,
    borderBottomRightRadius: radius,
    borderBottomLeftRadius: radius,
  };
  return {
    ...element,
    computedStyles: { ...element.computedStyles, ...radiusStyles },
    inlineStyles: { ...element.inlineStyles, ...radiusStyles },
  };
}

export function runVectorVertexStyleChange(
  args: {
    state: VectorVertexEditState | null;
    onVectorEditChange: (path: PenPath, phase: "commit") => void;
    onVectorRadiusChange: (radius: number) => void;
  },
  property: string,
  value: string | undefined,
): boolean {
  const { state } = args;
  if (!state || !RADIUS_PROPERTY.test(property)) return false;
  const radius = Number.parseFloat(value ?? "");
  if (state.selectedNodeIndex == null) {
    if (property === "borderRadius" && Number.isFinite(radius)) {
      args.onVectorRadiusChange(radius);
    }
    return false;
  }
  if (!Number.isFinite(radius)) return true;
  const nextPath = setPenNodeCornerRadius(
    state.path,
    state.selectedNodeIndex,
    radius,
  );
  if (nextPath) args.onVectorEditChange(nextPath, "commit");
  return true;
}

export function vectorVertexMirroringControl(
  state: VectorVertexEditState | null,
  onVectorEditChange: (path: PenPath, phase: "commit") => void,
):
  | {
      mirroring: PenMirroring;
      onChange: (m: PenMirroring) => void;
      point: { x: number; y: number };
      onPointChange: (point: { x: number; y: number }) => void;
    }
  | undefined {
  const vertex = selectedVectorVertex(state);
  if (!state || !vertex) return undefined;
  const nodeIndex = state.selectedNodeIndex!;
  const mirroring = penNodeMirroring(vertex);
  const round = (value: number) => Math.round(value * 100) / 100;
  return {
    mirroring,
    onChange: (next) => {
      if (next === mirroring) return;
      onVectorEditChange(
        setPenNodeMirroring(state.path, nodeIndex, next),
        "commit",
      );
    },
    point: { x: round(vertex.point.x), y: round(vertex.point.y) },
    onPointChange: (point) => {
      if (point.x === vertex.point.x && point.y === vertex.point.y) return;
      onVectorEditChange(movePenAnchor(state.path, nodeIndex, point), "commit");
    },
  };
}
