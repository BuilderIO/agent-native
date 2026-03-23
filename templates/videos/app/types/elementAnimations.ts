/**
 * Element Animation System
 *
 * Defines animations triggered by cursor interactions (hover/click)
 * Applies to all instances of a component type
 */

export interface AnimationKeyframe {
  progress: number; // 0→1 within the animation duration
  value: number | string; // number for numeric properties, string for colors
}

export interface AnimatedPropertyConfig {
  property: string; // e.g., "scale", "translateY", "brightness"
  keyframes: AnimationKeyframe[];
  unit: string; // e.g., "px", "x", "%", ""
  easing?: string; // e.g., "linear", "ease-out"
  min?: number;
  max?: number;
}

export interface ElementAnimation {
  id: string; // e.g., "card-hover", "button-click"
  elementType: string; // e.g., "Card", "Button" - applies to all instances
  triggerType: "hover" | "click";
  duration: number; // frames
  easing?: string; // e.g., "expo.inOut", "linear"
  properties: AnimatedPropertyConfig[];
}

export interface ElementAnimationRegistry {
  [compositionId: string]: ElementAnimation[];
}

/**
 * Color parsing cache for hex colors
 * Key: hex color string, Value: { r, g, b }
 */
const hexColorCache = new Map<string, { r: number; g: number; b: number }>();

/**
 * Parse hex color to RGB (memoized)
 */
function parseHexColor(hex: string): { r: number; g: number; b: number } {
  const cached = hexColorCache.get(hex);
  if (cached) return cached;

  const cleanHex = hex.replace("#", "");
  const result = {
    r: parseInt(cleanHex.substring(0, 2), 16),
    g: parseInt(cleanHex.substring(2, 4), 16),
    b: parseInt(cleanHex.substring(4, 6), 16),
  };

  hexColorCache.set(hex, result);
  return result;
}

// Helper to interpolate between two hex colors
export function interpolateColor(
  color1: string,
  color2: string,
  progress: number,
): string {
  // Parse hex colors (cached)
  const rgb1 = parseHexColor(color1);
  const rgb2 = parseHexColor(color2);

  const r = Math.round(rgb1.r + (rgb2.r - rgb1.r) * progress);
  const g = Math.round(rgb1.g + (rgb2.g - rgb1.g) * progress);
  const b = Math.round(rgb1.b + (rgb2.b - rgb1.b) * progress);

  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

// Helper to get animation value at a specific progress
export function getAnimationValue(
  property: AnimatedPropertyConfig,
  progress: number, // 0→1
): number | string {
  const keyframes = property.keyframes;

  if (keyframes.length === 0) return 0;
  if (keyframes.length === 1) return keyframes[0].value;

  // Find surrounding keyframes
  let beforeIdx = 0;
  let afterIdx = keyframes.length - 1;

  for (let i = 0; i < keyframes.length - 1; i++) {
    if (
      progress >= keyframes[i].progress &&
      progress <= keyframes[i + 1].progress
    ) {
      beforeIdx = i;
      afterIdx = i + 1;
      break;
    }
  }

  const before = keyframes[beforeIdx];
  const after = keyframes[afterIdx];

  if (before.progress === after.progress) return before.value;

  // Linear interpolation between keyframes
  const localProgress =
    (progress - before.progress) / (after.progress - before.progress);

  // Handle color interpolation
  if (typeof before.value === "string" && typeof after.value === "string") {
    return interpolateColor(before.value, after.value, localProgress);
  }

  // Handle numeric interpolation
  return (
    (before.value as number) +
    ((after.value as number) - (before.value as number)) * localProgress
  );
}
