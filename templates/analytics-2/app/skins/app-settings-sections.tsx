import type { SettingsSectionsProps } from "@agent-native/toolkit/app/settings";
import { useDesignSystem } from "@agent-native/toolkit/design-system";

import { standaloneSettingsPart } from "@/lib/standalone-settings-part";
import { SettingsSections } from "@/skins/settings-rows";

/**
 * The settings part as this app's panels mount it. Under the app's provider it
 * is the shared part, drawn by whichever skin is active. A panel mounted with
 * no design system above it uses the standalone part when one is configured.
 */
export function AppSettingsSections(props: SettingsSectionsProps) {
  const provided = useDesignSystem() !== undefined;
  const Standalone = provided ? undefined : standaloneSettingsPart;
  return Standalone ? (
    <Standalone {...props} />
  ) : (
    <SettingsSections {...props} />
  );
}
