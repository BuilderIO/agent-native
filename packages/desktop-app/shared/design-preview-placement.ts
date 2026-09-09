/**
 * Geometry/capability gate for native Design previews.
 *
 * A WebContentsView is a native child view, not a DOM element. It can only
 * faithfully replace the Design iframe when the preview is an untransformed,
 * unobscured rectangle that does not need DOM editor chrome above it. Keep
 * this decision pure so the renderer and main-process manager can share the
 * same contract when the native backend is wired.
 */

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
  /** Active app guest bounds, in BrowserWindow content coordinates. */
  hostBounds: DesktopDesignPreviewRect;
  /** Preview bounds, relative to the active app guest viewport. */
  previewBounds: DesktopDesignPreviewRect;
  /** Visible Design viewport, relative to the active app guest viewport. */
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
      /** Integer device-independent pixels accepted by View.setBounds(). */
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

/**
 * Decide whether a preview can be presented as a live native surface without
 * changing Design's visual or input semantics.
 *
 * The initial native backend is intentionally limited to focused Interact
 * mode. Edit/draw/comment need a compositor-level overlay, while overview
 * needs arbitrary scale/clip/rotation support that Electron View does not
 * provide.
 */
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

  // previewBounds and clipBounds are relative to the owner guest viewport,
  // while hostBounds is that viewport in BrowserWindow coordinates. Never
  // allow an untrusted guest to manufacture a huge clip rectangle and place a
  // native child view outside its own surface.
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
    // Electron documents that the cut-out area still captures clicks.
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

// The desktop package is CommonJS today while repo QA scripts are ESM. Keep a
// default object as an interop seam in addition to the normal named export.
export default { resolveDesktopDesignPreviewPlacement };
