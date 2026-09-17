// Matches a 2D rotate()/rotateZ() with any CSS angle unit (not rotateX/Y/3d).
const ROTATE_FN_PATTERN =
  /rotate[Zz]?\(\s*([+-]?[\d.]+(?:e[+-]?\d+)?)(deg|rad|turn|grad)?\s*\)/i;

export function parseRotationValue(transform: string | undefined): number {
  if (!transform || transform === "none") return 0;
  const match = transform.match(ROTATE_FN_PATTERN);
  if (match) {
    const value = Number(match[1]);
    if (Number.isFinite(value)) {
      const unit = (match[2] || "deg").toLowerCase();
      const deg =
        unit === "rad"
          ? value * (180 / Math.PI)
          : unit === "turn"
            ? value * 360
            : unit === "grad"
              ? value * 0.9
              : value;
      return Math.round(deg * 10) / 10;
    }
  }
  // Fallback for rotate3d()/matrix()/skew composites: read the 2D rotation
  // component off the resolved matrix so the panel doesn't report 0.
  if (typeof DOMMatrixReadOnly !== "undefined") {
    try {
      const m = new DOMMatrixReadOnly(transform);
      return Math.round(((Math.atan2(m.b, m.a) * 180) / Math.PI) * 10) / 10;
    } catch {
      // Unparseable transform — fall through to 0.
    }
  }
  return 0;
}

/**
 * Parse a CSS `scale` property value (e.g. "-1 1", "1", "none") into two
 * numeric components [scaleX, scaleY]. Defaults both axes to 1 when absent
 * or unparseable, matching the CSS initial value.
 */
export function parseScaleValue(value: string | undefined): [number, number] {
  if (!value || value === "none") return [1, 1];
  const parts = value.trim().split(/\s+/);
  const x = Number(parts[0]);
  const y = parts.length > 1 ? Number(parts[1]) : x;
  return [Number.isFinite(x) ? x : 1, Number.isFinite(y) ? y : 1];
}

/**
 * Normalize an angle in degrees into the (-180, 180] range the inspector
 * displays and commits (design-tool convention: 270° reads as -90°, a full
 * 360° turn reads as 0°). Exported for tests.
 */
export function normalizeRotationDegrees(degrees: number): number {
  if (!Number.isFinite(degrees)) return 0;
  let normalized = degrees % 360;
  if (normalized > 180) normalized -= 360;
  else if (normalized <= -180) normalized += 360;
  return Object.is(normalized, -0) ? 0 : normalized;
}

/** Exported for tests. */
export function mergeRotationValue(
  transform: string | undefined,
  degrees: number,
) {
  // Round first, then normalize, so a rounded -179.96 → -180 still lands
  // inside (-180, 180] as +180.
  const normalizedDegrees = normalizeRotationDegrees(
    Math.round(degrees * 10) / 10,
  );
  const nextRotate = `rotate(${normalizedDegrees}deg)`;
  if (!transform || transform === "none") return nextRotate;
  // Replace an existing rotate()/rotateZ() in ANY unit so we don't append a
  // second rotate() (which would compound, e.g. "rotate(0.5turn) rotate(30deg)").
  if (ROTATE_FN_PATTERN.test(transform)) {
    return transform.replace(ROTATE_FN_PATTERN, nextRotate);
  }
  return `${transform} ${nextRotate}`;
}

/**
 * Replace or remove a translateX/translateY function within an existing
 * transform string while preserving all other transform functions (rotate,
 * scale, skew, etc.). Pass `null` as `value` to strip the function.
 */
export function mergeTranslateFunction(
  transform: string | undefined,
  axis: "X" | "Y",
  value: string | null,
): string {
  const pattern =
    axis === "X" ? /translateX\([^)]*\)/g : /translateY\([^)]*\)/g;
  const base = (!transform || transform === "none" ? "" : transform)
    .replace(pattern, "")
    .trim();
  if (value === null) return base || "none";
  const fn = `translate${axis}(${value})`;
  return base ? `${fn} ${base}` : fn;
}
