import type { ElementInfo } from "../types";

export const AUTHORED_INLINE_STYLE_PROPERTIES = [
  "position",
  "left",
  "right",
  "top",
  "bottom",
  "width",
  "height",
  "transform",
  "scale",
  "lineHeight",
  "letterSpacing",
  "gridTemplateColumns",
  "gridTemplateRows",
  "gridAutoFlow",
  "flexDirection",
  "flexWrap",
  "columnGap",
  "rowGap",
  "justifyContent",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "marginTop",
  "marginRight",
  "marginBottom",
  "marginLeft",
  "alignItems",
  "alignContent",
  "justifyItems",
  "gap",
  "padding",
  "display",
  "overflow",
  "webkitBoxOrient",
  "webkitLineClamp",
  "--agent-native-truncate-original-display",
  "--agent-native-truncate-original-overflow",
  "--an-vector-start-point",
  "--an-vector-end-point",
  "--an-vector-fill-gradient",
  "--an-vector-stroke-gradient",
  "--an-css-border-gradient",
  "--an-css-border-solid-color",
  "border",
  "borderWidth",
  "borderStyle",
  "borderColor",
  "borderTop",
  "borderRight",
  "borderBottom",
  "borderLeft",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "borderTopStyle",
  "borderRightStyle",
  "borderBottomStyle",
  "borderLeftStyle",
  "borderTopColor",
  "borderRightColor",
  "borderBottomColor",
  "borderLeftColor",
  "borderImageSource",
  "whiteSpace",
  "backgroundImage",
  "backgroundColor",
  "color",
  "objectFit",
  "fill",
  "borderRadius",
  "borderTopLeftRadius",
  "borderTopRightRadius",
  "borderBottomRightRadius",
  "borderBottomLeftRadius",
] as const;

export function patchAuthoredInlineStyles(
  inlineStyles: Record<string, string> | undefined,
  committed: Record<string, string>,
): Record<string, string> | undefined {
  if (inlineStyles === undefined) return undefined;
  const next = { ...inlineStyles };
  for (const property of AUTHORED_INLINE_STYLE_PROPERTIES) {
    const value = committed[property];
    if (value !== undefined) next[property] = value;
  }
  return next;
}

export function clearAuthoredSizeStylesForCommit(
  authoredSizeStyles: ElementInfo["authoredSizeStyles"],
  committed: Record<string, string>,
): ElementInfo["authoredSizeStyles"] {
  if (authoredSizeStyles === undefined) return undefined;
  const next = { ...authoredSizeStyles };
  for (const property of ["width", "height"] as const) {
    if (committed[property] !== undefined) delete next[property];
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

export function authoredStyleValue(
  element: ElementInfo,
  property: string,
): string | undefined {
  const inline = element.inlineStyles?.[property];
  if (inline !== undefined) return inline === "auto" ? "" : inline;
  return element.computedStyles[property];
}

export function resolveInteractionStateValue(
  stateStyles: Record<string, string> | undefined,
  property: string,
  baseValue: string | undefined,
): string | undefined {
  if (!stateStyles) return baseValue;
  const kebabProperty = property.replace(
    /[A-Z]/g,
    (letter) => `-${letter.toLowerCase()}`,
  );
  const override = stateStyles[property] ?? stateStyles[kebabProperty];
  return override !== undefined ? override : baseValue;
}

export function elementWithInteractionStateStyles(
  element: ElementInfo,
  stateStyles: Record<string, string> | undefined,
): ElementInfo {
  if (!stateStyles || Object.keys(stateStyles).length === 0) return element;
  const aliases: Record<string, string> = {};
  for (const [property, value] of Object.entries(stateStyles)) {
    const camel = property.replace(/-([a-z])/g, (_, letter: string) =>
      letter.toUpperCase(),
    );
    aliases[property] = value;
    aliases[camel] = value;
  }
  return {
    ...element,
    computedStyles: { ...element.computedStyles, ...aliases },
    inlineStyles: { ...(element.inlineStyles ?? {}), ...aliases },
  };
}
