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
