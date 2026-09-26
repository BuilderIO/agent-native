

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}


let _webGLAvailable: boolean | null = null;

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


export const MAX_SHADERS_PER_ARTBOARD = 5;

const _shaderCounts = new Map<string, number>();

export function registerShaderInstance(artboardId: string): boolean {
  const current = _shaderCounts.get(artboardId) ?? 0;
  const next = current + 1;
  _shaderCounts.set(artboardId, next);
  return next <= MAX_SHADERS_PER_ARTBOARD;
}

export function unregisterShaderInstance(artboardId: string): void {
  const current = _shaderCounts.get(artboardId) ?? 0;
  const next = Math.max(0, current - 1);
  if (next === 0) {
    _shaderCounts.delete(artboardId);
  } else {
    _shaderCounts.set(artboardId, next);
  }
}

export function getShaderCount(artboardId: string): number {
  return _shaderCounts.get(artboardId) ?? 0;
}


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


export function resolveShaderSpeed(
  requestedSpeed: number,
  animated: boolean,
): number {
  if (!animated || prefersReducedMotion()) return 0;
  return requestedSpeed;
}
