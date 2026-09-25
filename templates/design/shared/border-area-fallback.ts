/**
 * A gradient stroke is a background layer with `background-clip: border-area`.
 * Engines without border-area drop that declaration and paint the gradient
 * over the whole box, so the persisted style carries a fallback: plain
 * `background-size` hides the stroke layer and `border-image` draws it as a
 * (square-cornered) ring, while the `-webkit-` aliases, written after them,
 * restore the real values through `if(supports(...))` where it is understood.
 */

const SUPPORTED = "supports(background-clip: border-area)";

export const BORDER_AREA_FALLBACK_PROPERTIES = [
  "-webkit-background-size",
  "border-image",
  "-webkit-border-image",
] as const;

export function splitCssList(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    else if (char === "," && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts.filter(Boolean);
}

export function borderAreaSupported(supported: string, fallback: string) {
  return `if(${SUPPORTED}: ${supported}; else: ${fallback})`;
}

/** The supported branch of a value written by `borderAreaSupported`. */
export function borderAreaSupportedBranch(
  value: string | undefined,
): string | null {
  const trimmed = value?.trim() ?? "";
  const prefix = `if(${SUPPORTED}: `;
  if (!trimmed.startsWith(prefix) || !trimmed.endsWith(")")) return null;
  const body = trimmed.slice(prefix.length, -1);
  let depth = 0;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    else if (char === ";" && depth === 0) return body.slice(0, index).trim();
  }
  return null;
}

export function borderAreaLayerIndex(backgroundClip: string): number {
  return splitCssList(backgroundClip).findIndex(
    (clip) => clip.toLowerCase() === "border-area",
  );
}

/**
 * Fallback declarations for a style whose background layer `index` is clipped
 * to border-area, given the real (border-area engine) background-size list.
 */
export function borderAreaFallback(
  backgroundImage: string,
  realBackgroundSize: string,
  index: number,
): Record<
  "background-size" | (typeof BORDER_AREA_FALLBACK_PROPERTIES)[number],
  string
> {
  const images = splitCssList(backgroundImage);
  const sizes = splitCssList(realBackgroundSize);
  const aligned = images.map((_, i) =>
    sizes.length ? sizes[i % sizes.length]! : "auto",
  );
  const realSize = aligned.join(", ") || "auto";
  const fallbackSize = aligned
    .map((size, i) => (i === index ? "0px 0px" : size))
    .join(", ");
  const strokeHidden = /^0(px)?\s+0(px)?$/.test(aligned[index] ?? "");
  const ring = images[index] && !strokeHidden ? `${images[index]} 1` : "none";
  return {
    "background-size": fallbackSize || "auto",
    "-webkit-background-size": borderAreaSupported(realSize, fallbackSize),
    "border-image": ring,
    "-webkit-border-image": borderAreaSupported("none", ring),
  };
}
