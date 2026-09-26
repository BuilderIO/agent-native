import { appPath } from "@agent-native/core/client/api-path";
import { useFeatureFlagState } from "@agent-native/core/client/feature-flags";
import { buildSettingsRoute } from "@agent-native/core/client/navigation";
import { SETTINGS_REDESIGN_FLAG } from "@agent-native/core/feature-flags/registry";

import { useCanManageClipsWorkspace } from "./use-clips-organization";

function useSettingsRedesign(): boolean {
  return useFeatureFlagState(SETTINGS_REDESIGN_FLAG.key).enabled;
}

/** Where a missing AI provider gets set up: Agent › Model, or today's AI setup. */
export function useAiSetupHref(): string {
  return appPath(
    useSettingsRedesign()
      ? buildSettingsRoute("model")
      : buildSettingsRoute("general", null, { anchor: "ai-providers" }),
  );
}

/**
 * Where storage gets set up: Organization › Infrastructure for owners and
 * admins, or today's Video storage. Null for members of an organization,
 * who can't set it up.
 */
export function useStorageSetupHref(): string | null {
  const redesign = useSettingsRedesign();
  const canManage = useCanManageClipsWorkspace();
  if (!redesign) {
    return appPath(
      buildSettingsRoute("general", null, { anchor: "video-storage" }),
    );
  }
  return canManage
    ? appPath(buildSettingsRoute("infra", null, { anchor: "uploads" }))
    : null;
}
