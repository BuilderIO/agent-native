const WHITESPACE = new Set([" ", "\t", "\n", "\r", "\f"]);

function splitTopLevelWhitespace(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of value.trim()) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (depth === 0 && WHITESPACE.has(char)) {
      if (current) parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current) parts.push(current);
  return parts;
}

function isUnset(value: string): boolean {
  const trimmed = value.trim();
  return trimmed === "" || trimmed === "none";
}

const ROTATE_AXIS_FUNCTIONS: Record<string, string> = {
  x: "rotateX",
  y: "rotateY",
  z: "rotateZ",
};

function translateFunction(value: string): string | null {
  if (isUnset(value)) return null;
  const parts = splitTopLevelWhitespace(value);
  if (parts.length === 1 || parts.length === 2) {
    return `translate(${parts.join(", ")})`;
  }
  if (parts.length === 3) return `translate3d(${parts.join(", ")})`;
  throw new Error(`Unsupported computed translate for export: ${value}`);
}

function rotateFunction(value: string): string | null {
  if (isUnset(value)) return null;
  const parts = splitTopLevelWhitespace(value);
  if (parts.length === 1) return `rotate(${parts[0]})`;
  if (parts.length === 2) {
    const axis = ROTATE_AXIS_FUNCTIONS[parts[0]!.toLowerCase()];
    if (axis) return `${axis}(${parts[1]})`;
  }
  if (parts.length === 4) return `rotate3d(${parts.join(", ")})`;
  throw new Error(`Unsupported computed rotate for export: ${value}`);
}

function scaleFunction(value: string): string | null {
  if (isUnset(value)) return null;
  const parts = splitTopLevelWhitespace(value).map((part) =>
    part.endsWith("%") ? String(Number(part.slice(0, -1)) / 100) : part,
  );
  if (parts.length === 1 || parts.length === 2) {
    return `scale(${parts.join(", ")})`;
  }
  if (parts.length === 3) return `scale3d(${parts.join(", ")})`;
  throw new Error(`Unsupported computed scale for export: ${value}`);
}

/**
 * html2canvas parses and resets only `transform`, so a layer flipped or rotated
 * through the individual `scale`, `rotate`, or `translate` properties is
 * measured transformed but painted untransformed. CSS applies them as
 * translate, rotate, scale, then `transform`, all around the same origin, so
 * one combined `transform` renders identically.
 */
export function composeIndividualTransforms(computed: {
  transform: string;
  translate: string;
  rotate: string;
  scale: string;
}): string | null {
  const composed = [
    translateFunction(computed.translate),
    rotateFunction(computed.rotate),
    scaleFunction(computed.scale),
  ].filter((part): part is string => part !== null);
  if (composed.length === 0) return null;
  const transform = computed.transform.trim();
  if (transform && transform !== "none") composed.push(transform);
  return composed.join(" ");
}
