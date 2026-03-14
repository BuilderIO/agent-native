/**
 * Element Animation Utilities
 *
 * Extracts animation logic from compositions into reusable functions.
 * Calculates animated styles based on hover/click progress and configured animations.
 *
 * NOTE: These are pure functions, not hooks, so they can be called inside loops.
 */
import { interpolate } from 'remotion';
import { getAnimationValue, interpolateColor } from '@/types/elementAnimations';
import type { ElementAnimation } from '@/types/elementAnimations';

interface UseElementAnimationsOptions {
  elementType: string;
  baseColor: string;
  baseBorderColor?: string;
  hoverProgress: number;
  clickProgress: number;
  hoverAnimation?: ElementAnimation;
  clickAnimation?: ElementAnimation;
}

interface AnimatedStyles {
  transform?: string;
  filter?: string;
  opacity: number;
  backgroundColor: string;
  borderColor: string;
  borderRadius: number;
  borderWidth: number;
  boxShadow: string;
}

/**
 * Color parsing cache to avoid regex in render loop
 * Key: color string, Value: parsed RGB values
 */
const colorCache = new Map<string, { r: number; g: number; b: number }>();

/**
 * Parse color string to RGB values (memoized)
 */
function parseColor(color: string): { r: number; g: number; b: number } {
  // Check cache first
  const cached = colorCache.get(color);
  if (cached) {
    return cached;
  }

  // Parse color using regex
  const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/);
  let result: { r: number; g: number; b: number };
  
  if (match) {
    result = {
      r: parseInt(match[1]),
      g: parseInt(match[2]),
      b: parseInt(match[3]),
    };
  } else {
    // Fallback to blue
    result = { r: 59, g: 130, b: 246 };
  }

  // Cache the result
  colorCache.set(color, result);
  return result;
}

/**
 * Convert RGB to hex color
 */
function rgbToHex(r: number, g: number, b: number): string {
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/**
 * Apply animation properties to get numeric/color values
 */
function applyAnimations(
  animation: ElementAnimation | undefined,
  progress: number,
  baseColorHex: string,
  baseBorderHex: string
): Record<string, number | string> {
  const result: Record<string, number | string> = {};

  if (!animation || progress <= 0) {
    return result;
  }

  animation.properties.forEach(prop => {
    // Use getAnimationValue for all properties - it handles keyframe interpolation
    result[prop.property] = getAnimationValue(prop, progress);
  });

  return result;
}

/**
 * Build CSS transform string from animation properties
 */
function buildTransform(
  hoverAnimations: Record<string, number | string>,
  clickAnimations: Record<string, number | string>
): string | undefined {
  const parts: string[] = [];

  // Scale is multiplicative between hover and click
  const hoverScale = typeof hoverAnimations.scale === 'number' ? hoverAnimations.scale : 1;
  const clickScale = typeof clickAnimations.scale === 'number' ? clickAnimations.scale : 1;
  const scale = hoverScale * clickScale;
  
  if (scale !== 1) parts.push(`scale(${scale})`);

  // Combine hover and click for other transforms (click overrides hover)
  const allAnimations = { ...hoverAnimations, ...clickAnimations };

  if (allAnimations.translateX) parts.push(`translateX(${allAnimations.translateX}px)`);
  if (allAnimations.translateY) parts.push(`translateY(${allAnimations.translateY}px)`);
  if (allAnimations.translateZ) parts.push(`translateZ(${allAnimations.translateZ}px)`);
  if (allAnimations.rotateX) parts.push(`rotateX(${allAnimations.rotateX}deg)`);
  if (allAnimations.rotateY) parts.push(`rotateY(${allAnimations.rotateY}deg)`);
  if (allAnimations.rotateZ) parts.push(`rotateZ(${allAnimations.rotateZ}deg)`);
  if (allAnimations.skewX) parts.push(`skewX(${allAnimations.skewX}deg)`);
  if (allAnimations.skewY) parts.push(`skewY(${allAnimations.skewY}deg)`);

  return parts.length > 0 ? parts.join(' ') : undefined;
}

/**
 * Build CSS filter string from animation properties
 */
function buildFilter(allAnimations: Record<string, number | string>): string | undefined {
  const parts: string[] = [];

  if (allAnimations.brightness && allAnimations.brightness !== 1) {
    parts.push(`brightness(${allAnimations.brightness})`);
  }
  if (allAnimations.blur) {
    parts.push(`blur(${allAnimations.blur}px)`);
  }

  return parts.length > 0 ? parts.join(' ') : undefined;
}

/**
 * Extract numeric value with type guard and fallback
 */
function getNumeric(value: number | string | undefined, fallback: number): number {
  return typeof value === 'number' ? value : fallback;
}

/**
 * Calculate animated styles for an element
 *
 * NOTE: This is a pure function, not a hook, so it can be called inside loops.
 */
export function calculateElementAnimations({
  elementType,
  baseColor,
  baseBorderColor = '#ffffff',
  hoverProgress,
  clickProgress,
  hoverAnimation,
  clickAnimation,
}: UseElementAnimationsOptions): AnimatedStyles {
  // Parse base colors
  const baseRgb = parseColor(baseColor);
  const baseColorHex = rgbToHex(baseRgb.r, baseRgb.g, baseRgb.b);
  const baseBorderHex = baseBorderColor.startsWith('#')
    ? baseBorderColor
    : rgbToHex(255, 255, 255);

  // Apply hover and click animations
  const hoverAnimations = applyAnimations(hoverAnimation, hoverProgress, baseColorHex, baseBorderHex);
  const clickAnimations = applyAnimations(clickAnimation, clickProgress, baseColorHex, baseBorderHex);

  // Combine animations (click overrides hover for most properties)
  const allAnimations = { ...hoverAnimations, ...clickAnimations };

  // Extract style properties with type guards
  const opacity = getNumeric(allAnimations.opacity, 1);
  const borderRadius = getNumeric(allAnimations.borderRadius, 16);
  const borderWidth = getNumeric(allAnimations.borderWidth, 2);
  const borderOpacity = getNumeric(allAnimations.borderOpacity, 0.2);
  const backgroundOpacity = getNumeric(allAnimations.backgroundOpacity, 1);
  const shadowBlur = getNumeric(allAnimations.shadowBlur, 8);
  const shadowSpread = getNumeric(allAnimations.shadowSpread, 0);

  // Determine final colors
  const backgroundColor = typeof allAnimations.backgroundColor === 'string'
    ? allAnimations.backgroundColor
    : `rgba(${baseRgb.r}, ${baseRgb.g}, ${baseRgb.b}, ${backgroundOpacity})`;

  const borderColor = typeof allAnimations.borderColor === 'string'
    ? allAnimations.borderColor
    : `rgba(255, 255, 255, ${borderOpacity})`;

  return {
    transform: buildTransform(hoverAnimations, clickAnimations),
    filter: buildFilter(allAnimations),
    opacity,
    backgroundColor,
    borderColor,
    borderRadius,
    borderWidth,
    boxShadow: `0 ${shadowBlur}px ${shadowBlur * 2}px ${shadowSpread}px rgba(0, 0, 0, 0.3)`,
  };
}
