import type { SettingsSectionsProps } from "@agent-native/toolkit/app/settings";
import type { ComponentType } from "react";

/**
 * What draws settings sections for a panel mounted with no design system above
 * it. Inside the app there always is one, so this is unset. A test
 * configuration may resolve this module to one that names a part, so a panel
 * mounted on its own looks as it does in the app.
 */
export const standaloneSettingsPart:
  | ComponentType<SettingsSectionsProps>
  | undefined = undefined;
