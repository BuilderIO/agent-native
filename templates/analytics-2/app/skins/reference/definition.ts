import { defineDesignSystem } from "@agent-native/toolkit/design-system";

import { designSystem } from "../../design-system.js";
import { ReferenceSettingsSections } from "./settings-sections";
import { sidebarShellParts } from "./sidebar-shell";
import { referenceTheme } from "./theme";

/** The app's measured look. It is the house design system plus whole-part renderers. */
export const referenceDesignSystem = /* @__PURE__ */ defineDesignSystem({
  ...designSystem,
  theme: referenceTheme,
  parts: {
    SettingsSections: ReferenceSettingsSections,
    Sidebar: sidebarShellParts.Sidebar,
    AppShell: sidebarShellParts.AppShell,
  },
});
