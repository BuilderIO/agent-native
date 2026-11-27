import type { ComponentType } from "react";

import type {
  AppShellPartProps,
  SidebarPartProps,
} from "../app-shell/contracts.js";
import type { SettingsSectionsProps } from "../app/settings/rows/schema.js";
import { useDesignSystem } from "./context.js";

/**
 * Parts a part set can draw whole, keyed by part name. A whole part takes the
 * surface's typed model and owns all of its markup, and writes the same
 * `data-rid` and `data-part` values as toolkit's own.
 */
export interface WholeParts {
  settings: ComponentType<SettingsSectionsProps>;
  sidebar: ComponentType<SidebarPartProps>;
  "app-shell": ComponentType<AppShellPartProps>;
}

export type WholePartName = keyof WholeParts;

/**
 * The part set's whole part, or undefined when it draws none and toolkit's
 * own draws the surface. Unlike row parts, a whole part draws a surface on
 * its own, so leaving it out never mixes two part sets in one surface.
 */
export function useWholePart<Name extends WholePartName>(
  name: Name,
): WholeParts[Name] | undefined {
  return useDesignSystem()?.parts?.whole?.[name];
}
