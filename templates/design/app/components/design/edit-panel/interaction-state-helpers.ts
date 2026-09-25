import type { ElementInfo } from "../types";

/** The properties `ElementInfo.inlineStyles` carries. Pinned against the
 *  bridge's own list by `bridge.guard.spec.ts`. */
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

/** Patch authored values onto an existing inline-style snapshot. A commit that
 *  updates only `computedStyles` leaves the authored and resolved views of the
 *  same property disagreeing until the next fresh selection payload. */
export function patchAuthoredInlineStyles(
  inlineStyles: Record<string, string> | undefined,
  committed: Record<string, string>,
): Record<string, string> | undefined {
  // Absence is meaningful downstream, so an older payload without a snapshot
  // must not gain one here.
  if (inlineStyles === undefined) return undefined;
  const next = { ...inlineStyles };
  for (const property of AUTHORED_INLINE_STYLE_PROPERTIES) {
    const value = committed[property];
    if (value !== undefined) next[property] = value;
  }
  return next;
}

/**
 * Drop native width/height hints for an optimistic commit. The host cannot
 * recompute the winning CSS cascade, so a stale hint must not outrank the
 * freshly patched inline snapshot until the bridge sends a new selection.
 */
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

/**
 * While a non-default interaction state is active, style-section fields
 * display the STATE's value for a property when it has one, else fall back
 * to the base (Default-state) value — never blank. This is the "overridden
 * shows the override, else shows the inherited base" convention (documented
 * choice: values are shown in their normal weight/color either way, since
 * the state-selector's own accent already signals "you are editing Hover" —
 * repeating that with dimmed/greyed-out base values on every single field
 * would be visual noise; the per-property override DOT, rendered via
 * `InteractionStateOverrideIndicator`, is what marks which specific fields
 * differ from the base in the active state).
 *
 * @param stateStyles  `activeInteractionStateStyles` — the active state's
 *   declared properties for the selected element, or `undefined` when no
 *   state is active / nothing is overridden.
 * @param property  CSS property, camelCase or kebab-case (normalized the
 *   same way `shared/interaction-states.ts` normalizes keys, so callers can
 *   pass either).
 * @param baseValue  The value that would render with no state active
 *   (typically `authoredStyleValue(element, property)` or a computed style).
 */
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

/**
 * Project active state declarations onto an ElementInfo snapshot so every
 * existing inspector section reads the same override-or-base values without
 * each field needing bespoke state plumbing. Stored CSS names are kebab-case;
 * bridge computed/inline maps are primarily camelCase, so both aliases are
 * populated. Returns the original object for Default/no overrides.
 */
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
