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

export function parseScaleValue(value: string | undefined): [number, number] {
  if (!value || value === "none") return [1, 1];
  const parts = value.trim().split(/\s+/);
  const x = Number(parts[0]);
  const y = parts.length > 1 ? Number(parts[1]) : x;
  return [Number.isFinite(x) ? x : 1, Number.isFinite(y) ? y : 1];
}

export function normalizeRotationDegrees(degrees: number): number {
  if (!Number.isFinite(degrees)) return 0;
  let normalized = degrees % 360;
  if (normalized > 180) normalized -= 360;
  else if (normalized <= -180) normalized += 360;
  return Object.is(normalized, -0) ? 0 : normalized;
}

export function mergeRotationValue(
  transform: string | undefined,
  degrees: number,
) {
  const normalizedDegrees = normalizeRotationDegrees(
    Math.round(degrees * 10) / 10,
  );
  const nextRotate = `rotate(${normalizedDegrees}deg)`;
  if (!transform || transform === "none") return nextRotate;
  if (ROTATE_FN_PATTERN.test(transform)) {
    return transform.replace(ROTATE_FN_PATTERN, nextRotate);
  }
  return `${transform} ${nextRotate}`;
}

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
