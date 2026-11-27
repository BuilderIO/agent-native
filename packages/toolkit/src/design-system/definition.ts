import type { PartSet } from "./parts.js";
import type { DesignSystemPrimitiveOverrides } from "./primitives.js";
import type { DesignSystemTheme } from "./theme.js";
import type { DesignSystemComponents } from "./types.js";

export interface DesignSystemDefinition {
  name?: string;
  components?: Partial<DesignSystemComponents>;
  /** Markup for model-drawn parts; without one, toolkit's own draw them. */
  parts?: PartSet;
  /** Base UI primitives this design system draws its own way, by export name. */
  primitives?: DesignSystemPrimitiveOverrides | undefined;
  theme?: DesignSystemTheme;
}

type KnownKeysOnly<Definition> = {
  readonly [Key in Exclude<
    keyof Definition,
    keyof DesignSystemDefinition
  >]: never;
};

export function defineDesignSystem<
  const Definition extends DesignSystemDefinition,
>(definition: Definition & KnownKeysOnly<Definition>): Definition {
  return definition;
}
