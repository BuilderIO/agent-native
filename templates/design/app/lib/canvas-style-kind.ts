export type CanvasStyleKind =
  | "position"
  | "size"
  | "fill"
  | "typography"
  | "spacing"
  | "effects"
  | "mixed"
  | "other";

type SingleStyleKind = Exclude<CanvasStyleKind, "mixed">;

const STYLE_KIND_RULES: Array<[RegExp, SingleStyleKind]> = [
  [
    /^(left|top|right|bottom|inset.*|position|transform|translate|z-index)$/,
    "position",
  ],
  [/^((min-|max-)?(width|height)|aspect-ratio|scale)$/, "size"],
  [/^(background.*|color|fill|stroke.*|border(-[a-z]+)*-color)$/, "fill"],
  [
    /^(font.*|line-height|letter-spacing|text-.*|white-space|word-.*)$/,
    "typography",
  ],
  [/^(padding.*|margin.*|gap|row-gap|column-gap)$/, "spacing"],
  [
    /^(opacity|box-shadow|filter|backdrop-filter|border(-[a-z]+)*-radius|mix-blend-mode|rotate)$/,
    "effects",
  ],
];

/**
 * The kind of change a style write is, from its property names alone; values
 * and selectors never leave. A corner resize also moves the box, so position
 * plus size is still a resize.
 */
export function canvasStyleKind(properties: Iterable<string>): CanvasStyleKind {
  const kinds = new Set<SingleStyleKind>();
  for (const property of properties) {
    const name = property.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
    kinds.add(
      STYLE_KIND_RULES.find(([rule]) => rule.test(name))?.[1] ?? "other",
    );
  }
  if (kinds.size === 0) return "other";
  if (kinds.size === 1) return [...kinds][0];
  if (kinds.size === 2 && kinds.has("size") && kinds.has("position")) {
    return "size";
  }
  return "mixed";
}
