import type { ComponentType } from "react";

import type {
  AppShellPartProps,
  SidebarPartProps,
} from "../app-shell/contracts.js";

declare module "./parts.js" {
  interface DesignSystemParts {
    Sidebar: ComponentType<SidebarPartProps>;
    AppShell: ComponentType<AppShellPartProps>;
  }
}

export type {
  AppShellPartProps,
  SidebarPartProps,
} from "../app-shell/contracts.js";
