import type { ElementInfo } from "../types";

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
