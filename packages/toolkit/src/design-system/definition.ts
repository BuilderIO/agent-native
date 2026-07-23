import type { DesignSystemTheme } from "./theme.js";
import type { DesignSystemComponents } from "./types.js";

export interface DesignSystemDefinition {
  name?: string;
  components?: Partial<DesignSystemComponents>;
  theme?: DesignSystemTheme;
}

export function defineDesignSystem<
  const Definition extends DesignSystemDefinition,
>(definition: Definition): Definition {
  return definition;
}
