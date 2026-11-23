// Test configuration only: resolves in place of `@/lib/standalone-settings-part`.
import type { SettingsSectionsProps } from "@agent-native/toolkit/app/settings";

import { frames } from "@/skins/reference/settings/frames";
import {
  SettingsSections,
  resolveSettingsPresentation,
} from "@/skins/settings-rows";

// The frames are read directly: the reference part's own module loads the
// settings barrel, which some specs replace with stand-ins. They are given the
// same resolved props the reference part gives them.
export function standaloneSettingsPart(input: SettingsSectionsProps) {
  const props = resolveSettingsPresentation(input);
  const frame = props.hints?.frame;
  const Frame = typeof frame === "string" ? frames[frame] : undefined;
  return Frame ? <Frame {...props} /> : <SettingsSections {...props} />;
}
