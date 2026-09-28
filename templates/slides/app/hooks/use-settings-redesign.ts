import {
  useFeatureFlagState,
  type FeatureFlagState,
} from "@agent-native/core/client/feature-flags";
import { SETTINGS_REDESIGN_FLAG } from "@agent-native/core/feature-flags/registry";

/**
 * The `settings-redesign` flag with its loading state, so Settings and the
 * layout around it switch together and never flash today's UI first.
 */
export function useSettingsRedesign(): FeatureFlagState {
  return useFeatureFlagState(SETTINGS_REDESIGN_FLAG.key);
}
