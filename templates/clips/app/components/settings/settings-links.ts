import { appPath } from "@agent-native/core/client/api-path";
import { buildSettingsRoute } from "@agent-native/core/client/navigation";

import { useCanManageClipsWorkspace } from "./use-clips-organization";

/** Where a missing AI provider gets set up: Agent › Model. */
export function useAiSetupHref(): string {
  return appPath(buildSettingsRoute("model"));
}

/**
 * Where storage gets set up: Organization › Infrastructure for owners and
 * admins. Null for members of an organization, who can't set it up.
 */
export function useStorageSetupHref(): string | null {
  const canManage = useCanManageClipsWorkspace();
  return canManage
    ? appPath(buildSettingsRoute("infra", null, { anchor: "uploads" }))
    : null;
}
