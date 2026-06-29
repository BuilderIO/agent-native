/**
 * shader-safety.ts
 *
 * Pure utility helpers for the GPU shader-effects feature.
 * No imports from @paper-design/shaders-react — safe to use anywhere.
 */

// ---------------------------------------------------------------------------
// Reduced-motion detection
// ---------------------------------------------------------------------------

/**
 * Check if the user prefers reduced motion.
 * Safe to call SSR (returns false on the server).
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// ---------------------------------------------------------------------------
// WebGL availability check (memoized)
// ---------------------------------------------------------------------------

let _webGLAvailable: boolean | null = null;

/**
 * Check if WebGL is available in the current browser environment.
 * Safe to call SSR (returns false on the server).
 * Result is cached after the first call.
 */
export function isWebGLAvailable(): boolean {
  if (typeof window === "undefined") return false;
  if (_webGLAvailable !== null) return _webGLAvailable;

  try {
    const canvas = document.createElement("canvas");
    const ctx =
      canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    _webGLAvailable = ctx !== null;
  } catch {
    _webGLAvailable = false;
  }

  return _webGLAvailable;
}

// ---------------------------------------------------------------------------
// Per-artboard WebGL context counter
// ---------------------------------------------------------------------------

/**
 * Browsers support ~8-16 WebGL contexts per page; we cap at this value per
 * artboard to stay well within that limit.
 */
export const MAX_SHADERS_PER_ARTBOARD = 5;

const _shaderCounts = new Map<string, number>();

/**
 * Register a shader instance for an artboard.
 * Returns true if the instance is within budget, false if over limit.
 */
export function registerShaderInstance(artboardId: string): boolean {
  const current = _shaderCounts.get(artboardId) ?? 0;
  const next = current + 1;
  _shaderCounts.set(artboardId, next);
  return next <= MAX_SHADERS_PER_ARTBOARD;
}

/**
 * Unregister a shader instance when the component unmounts.
 */
export function unregisterShaderInstance(artboardId: string): void {
  const current = _shaderCounts.get(artboardId) ?? 0;
  const next = Math.max(0, current - 1);
  if (next === 0) {
    _shaderCounts.delete(artboardId);
  } else {
    _shaderCounts.set(artboardId, next);
  }
}

/**
 * Get current shader instance count for an artboard.
 */
export function getShaderCount(artboardId: string): number {
  return _shaderCounts.get(artboardId) ?? 0;
}

// ---------------------------------------------------------------------------
// Fallback CSS gradient
// ---------------------------------------------------------------------------

/**
 * Build a fallback CSS linear-gradient from a colors array.
 * Used when WebGL is unavailable or the context limit is hit.
 *
 * Examples:
 *   buildFallbackGradient(["#e0eaff", "#241d9a", "#f75092"])
 *   → "linear-gradient(135deg, #e0eaff, #241d9a, #f75092)"
 *
 *   buildFallbackGradient(["#241d9a"], "#e0eaff")
 *   → "linear-gradient(135deg, #e0eaff, #241d9a)"
 *
 *   buildFallbackGradient(["#241d9a"])
 *   → "#241d9a"
 */
export function buildFallbackGradient(
  colors: string[],
  colorBack?: string,
): string {
  const stops = colorBack ? [colorBack, ...colors] : [...colors];

  if (stops.length === 1) {
    return stops[0];
  }

  return `linear-gradient(135deg, ${stops.join(", ")})`;
}

// ---------------------------------------------------------------------------
// Speed resolution
// ---------------------------------------------------------------------------

/**
 * Returns the effective animation speed.
 * Returns 0 if the user prefers reduced motion or animated is false.
 * NOT a React hook — just a pure function.
 */
export function resolveShaderSpeed(
  requestedSpeed: number,
  animated: boolean,
): number {
  if (!animated || prefersReducedMotion()) return 0;
  return requestedSpeed;
}
