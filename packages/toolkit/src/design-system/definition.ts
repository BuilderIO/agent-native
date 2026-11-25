import type { PartSet } from "./parts.js";
import type { DesignSystemTheme } from "./theme.js";
import type { DesignSystemComponents } from "./types.js";

export interface DesignSystemDefinition {
  name?: string;
  components?: Partial<DesignSystemComponents>;
  /** Markup for model-drawn parts; without one, toolkit's own draw them. */
  parts?: PartSet;
  theme?: DesignSystemTheme;
}

export function defineDesignSystem<
  const Definition extends DesignSystemDefinition,
>(definition: Definition): Definition {
  return definition;
}
