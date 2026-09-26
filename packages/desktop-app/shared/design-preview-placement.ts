
export interface DesktopDesignPreviewRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type DesktopDesignPreviewMode = "interact" | "edit" | "draw" | "comment";

export type DesktopDesignPreviewFallbackReason =
  | "invalid-geometry"
  | "overview-transform"
  | "scaled"
  | "rotated"
  | "clipped"
  | "dom-overlay-required"
  | "rounded-hit-region"
  | "obscured";

export interface DesktopDesignPreviewPlacementInput {
  hostBounds: DesktopDesignPreviewRect;
  previewBounds: DesktopDesignPreviewRect;
  clipBounds: DesktopDesignPreviewRect;
  mode: DesktopDesignPreviewMode;
  presentation: "focused" | "overview";
  scale: number;
  rotationDegrees: number;
  borderRadius: number;
  obscured: boolean;
  visible: boolean;
}

export type DesktopDesignPreviewPlacement =
  | { kind: "hidden" }
  | {
      kind: "dom";
      reason: DesktopDesignPreviewFallbackReason;
    }
  | {
      kind: "native";
      bounds: DesktopDesignPreviewRect;
    };

const EPSILON = 0.0001;

function isFiniteRect(rect: DesktopDesignPreviewRect): boolean {
  return (
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width > 0 &&
    rect.height > 0
  );
}

function contains(
  outer: DesktopDesignPreviewRect,
  inner: DesktopDesignPreviewRect,
): boolean {
  return (
    inner.x >= outer.x - EPSILON &&
    inner.y >= outer.y - EPSILON &&
    inner.x + inner.width <= outer.x + outer.width + EPSILON &&
    inner.y + inner.height <= outer.y + outer.height + EPSILON
  );
}

function integerBounds(
  host: DesktopDesignPreviewRect,
  preview: DesktopDesignPreviewRect,
): DesktopDesignPreviewRect {
  const left = Math.round(host.x + preview.x);
  const top = Math.round(host.y + preview.y);
  const right = Math.round(host.x + preview.x + preview.width);
  const bottom = Math.round(host.y + preview.y + preview.height);
  return {
    x: left,
    y: top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

export function resolveDesktopDesignPreviewPlacement(
  input: DesktopDesignPreviewPlacementInput,
): DesktopDesignPreviewPlacement {
  if (!input.visible) return { kind: "hidden" };

  if (
    !isFiniteRect(input.hostBounds) ||
    !isFiniteRect(input.previewBounds) ||
    !isFiniteRect(input.clipBounds) ||
    !Number.isFinite(input.scale) ||
    !Number.isFinite(input.rotationDegrees) ||
    !Number.isFinite(input.borderRadius)
  ) {
    return { kind: "dom", reason: "invalid-geometry" };
  }

  const hostViewport = {
    x: 0,
    y: 0,
    width: input.hostBounds.width,
    height: input.hostBounds.height,
  };
  if (!contains(hostViewport, input.clipBounds)) {
    return { kind: "dom", reason: "invalid-geometry" };
  }

  if (input.presentation !== "focused") {
    return { kind: "dom", reason: "overview-transform" };
  }
  if (Math.abs(input.scale - 1) > EPSILON) {
    return { kind: "dom", reason: "scaled" };
  }
  if (Math.abs(input.rotationDegrees) > EPSILON) {
    return { kind: "dom", reason: "rotated" };
  }
  if (!contains(input.clipBounds, input.previewBounds)) {
    return { kind: "dom", reason: "clipped" };
  }
  if (input.mode !== "interact") {
    return { kind: "dom", reason: "dom-overlay-required" };
  }
  if (input.borderRadius > EPSILON) {
    return { kind: "dom", reason: "rounded-hit-region" };
  }
  if (input.obscured) {
    return { kind: "dom", reason: "obscured" };
  }

  return {
    kind: "native",
    bounds: integerBounds(input.hostBounds, input.previewBounds),
  };
}

export default { resolveDesktopDesignPreviewPlacement };
