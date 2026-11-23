import type { ComponentType } from "react";

import type { SettingsSectionsProps } from "../app/settings/rows/schema.js";
import { useDesignSystem } from "./context.js";
import type { DesignSystemDefinition } from "./definition.js";

/**
 * Parts a skin can render whole. Unlike the semantic components, a part takes a
 * typed model and owns all of its markup, so a skin can change structure as
 * well as look. Both skins must emit the same `data-rid` and `data-part` values.
 */
export interface DesignSystemParts {
  SettingsSections: ComponentType<SettingsSectionsProps>;
}

export type DesignSystemPartName = keyof DesignSystemParts;

/**
 * Public's `DesignSystemDefinition` has no `parts`, so Labs carries them on the
 * definition object itself and reads them back here.
 */
export function useDesignSystemPart<Props>(
  name: string,
): ComponentType<Props> | undefined {
  const definition: DesignSystemDefinition & {
    parts?: Record<string, ComponentType<Props>>;
  } = useDesignSystem() ?? {};
  return definition.parts?.[name];
}

/** A definition whose skin replaces whole parts. */
export function withDesignSystemParts(
  name: string,
  parts: Record<string, ComponentType<never>>,
): DesignSystemDefinition {
  const definition = { name, parts };
  return definition;
}
