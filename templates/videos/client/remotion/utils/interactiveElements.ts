/**
 * Interactive Element Registration System
 * 
 * This utility helps register UI elements as interactive, making them
 * ready to accept cursor hover and click animations.
 * 
 * Usage:
 * 1. Define interactive zones in your composition
 * 2. Register them with cursor history for automatic interaction detection
 * 3. Cursor automatically changes type and responds to clicks
 */

import type { CursorFrame } from "../hooks/useCursorHistory";
import type { HoverAnimationResult } from "../hooks/useHoverAnimation";

export type InteractiveElementType = 
  | "button"      // Buttons, CTAs - pointer cursor
  | "input"       // Text inputs, textareas - text cursor  
  | "link"        // Links, navigation - pointer cursor
  | "card"        // Clickable cards - pointer cursor
  | "toggle"      // Switches, checkboxes - pointer cursor
  | "icon"        // Interactive icons - pointer cursor
  | "image"       // Clickable images - pointer cursor
  | "custom";     // Custom interaction - specify cursor type

export interface InteractiveElementDefinition {
  id: string;
  type: InteractiveElementType;
  label: string;
  zone: {
    x: number;
    y: number;
    width: number;
    height: number;
    padding?: number;
  };
  cursorType?: "default" | "pointer" | "text";
  onHover?: (progress: number) => void;
  onClick?: (frame: number) => void;
}

/**
 * Get the appropriate cursor type for an element type
 */
export function getCursorTypeForElement(type: InteractiveElementType): "pointer" | "text" | "default" {
  switch (type) {
    case "input":
      return "text";
    case "button":
    case "link":
    case "card":
    case "toggle":
    case "icon":
    case "image":
      return "pointer";
    case "custom":
    default:
      return "default";
  }
}

/**
 * Create an interactive element definition with sensible defaults
 * 
 * @example
 * const submitBtn = createInteractiveElement({
 *   id: "submit-btn",
 *   type: "button",
 *   label: "Submit Button",
 *   zone: { x: 500, y: 600, width: 120, height: 40 }
 * });
 */
export function createInteractiveElement(
  config: Omit<InteractiveElementDefinition, "cursorType"> & { cursorType?: "default" | "pointer" | "text" }
): InteractiveElementDefinition {
  return {
    ...config,
    cursorType: config.cursorType ?? getCursorTypeForElement(config.type),
    zone: {
      ...config.zone,
      padding: config.zone.padding ?? (config.type === "input" ? 10 : 8),
    },
  };
}

/**
 * Batch create multiple interactive elements
 * 
 * @example
 * const interactiveElements = createInteractiveElements([
 *   { id: "btn-1", type: "button", label: "Primary CTA", zone: {...} },
 *   { id: "input-1", type: "input", label: "Email Input", zone: {...} },
 *   { id: "link-1", type: "link", label: "Learn More", zone: {...} },
 * ]);
 */
export function createInteractiveElements(
  configs: Array<Omit<InteractiveElementDefinition, "cursorType"> & { cursorType?: "default" | "pointer" | "text" }>
): InteractiveElementDefinition[] {
  return configs.map(createInteractiveElement);
}

/**
 * Helper to check if cursor clicked an element at a specific frame range
 * 
 * @example
 * const clickFrame = findClickInElement(
 *   cursorTrack,
 *   { x: 500, y: 600, width: 120, height: 40 },
 *   { startFrame: 100, endFrame: 150 }
 * );
 * 
 * if (clickFrame) {
 *   console.log(`Button clicked at frame ${clickFrame}`);
 * }
 */
export function findClickInElement(
  cursorTrack: any,
  zone: { x: number; y: number; width: number; height: number; padding?: number },
  frameRange?: { startFrame: number; endFrame: number }
): number | null {
  const clickProp = cursorTrack?.animatedProps?.find((p: any) => p.property === "isClicking");
  if (!clickProp?.keyframes) return null;

  const xProp = cursorTrack?.animatedProps?.find((p: any) => p.property === "x");
  const yProp = cursorTrack?.animatedProps?.find((p: any) => p.property === "y");
  
  if (!xProp?.keyframes || !yProp?.keyframes) return null;

  const padding = zone.padding ?? 8;

  for (const clickKf of clickProp.keyframes) {
    if (clickKf.value !== "1") continue;
    
    // Check if click is in frame range (if specified)
    if (frameRange) {
      if (clickKf.frame < frameRange.startFrame || clickKf.frame > frameRange.endFrame) {
        continue;
      }
    }

    // Find cursor position at click frame
    const xAtClick = findValueAtFrame(xProp.keyframes, clickKf.frame);
    const yAtClick = findValueAtFrame(yProp.keyframes, clickKf.frame);

    if (xAtClick === null || yAtClick === null) continue;

    // Check if cursor is within element bounds
    const isInBounds = 
      xAtClick >= zone.x - padding &&
      xAtClick <= zone.x + zone.width + padding &&
      yAtClick >= zone.y - padding &&
      yAtClick <= zone.y + zone.height + padding;

    if (isInBounds) {
      return clickKf.frame;
    }
  }

  return null;
}

/**
 * Helper to find interpolated value at a specific frame
 */
function findValueAtFrame(keyframes: Array<{ frame: number; value: string }>, frame: number): number | null {
  if (keyframes.length === 0) return null;

  const sorted = [...keyframes].sort((a, b) => a.frame - b.frame);

  // Before first keyframe
  if (frame <= sorted[0].frame) {
    return parseFloat(sorted[0].value);
  }

  // After last keyframe
  if (frame >= sorted[sorted.length - 1].frame) {
    return parseFloat(sorted[sorted.length - 1].value);
  }

  // Between keyframes - linear interpolation
  for (let i = 0; i < sorted.length - 1; i++) {
    const curr = sorted[i];
    const next = sorted[i + 1];

    if (frame >= curr.frame && frame <= next.frame) {
      const from = parseFloat(curr.value);
      const to = parseFloat(next.value);
      const progress = (frame - curr.frame) / (next.frame - curr.frame);
      return from + (to - from) * progress;
    }
  }

  return null;
}

/**
 * Type guard to check if a hover result indicates an active interaction
 */
export function isInteracting(hover: HoverAnimationResult | undefined): boolean {
  return hover ? hover.hoverProgress > 0.1 : false;
}

/**
 * Type guard to check if a hover result indicates a click
 */
export function isClicking(hover: HoverAnimationResult | undefined): boolean {
  return hover ? hover.clickProgress > 0.5 : false;
}
