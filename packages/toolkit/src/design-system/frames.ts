import type { ComponentType } from "react";

import type {
  AppShellPartProps,
  SidebarPartProps,
} from "../app-shell/contracts.js";
import { useDesignSystem } from "./context.js";

/**
 * Frames a design system can draw whole. A frame takes a typed shell model and
 * owns all of its markup, so a look can change structure as well as style.
 * Every frame must emit the same `data-rid` and `data-part` values.
 */
export interface DesignSystemFrames {
  Sidebar: ComponentType<SidebarPartProps>;
  AppShell: ComponentType<AppShellPartProps>;
}

export type DesignSystemFrameName = keyof DesignSystemFrames;

/** The design system's frame by name, or undefined when it registers none. */
export function useDesignSystemFrame<Name extends DesignSystemFrameName>(
  name: Name,
): DesignSystemFrames[Name] | undefined {
  return useDesignSystem()?.frames?.[name];
}
