import { dataConnections } from "@/components/data/WorkspaceDataConnections.fixtures";
import {
  preferences,
  preferencesHooksMock,
} from "@/components/settings/AnalyticsAccountPreferences.fixtures";
import {
  assetLabelHooksMock,
  assetLabels,
} from "@/components/settings/AnalyticsAssetLabelsSettings.fixtures";
import { notifications } from "@/components/settings/AnalyticsNotificationsPage.fixtures";
import { users } from "@/components/settings/AnalyticsUsersPage.fixtures";
import {
  workspaceName,
  workspaceNameHooksMock,
} from "@/components/settings/AnalyticsWorkspaceName.fixtures";
import {
  roleRequestHooksMock,
  roleRequests,
} from "@/components/settings/RoleRequests.fixtures";

/** Puts every panel's mocked data back to its starting state. */
export function resetAllPanels(): void {
  assetLabels.reset();
  preferences.reset();
  notifications.reset();
  users.reset();
  workspaceName.reset();
  roleRequests.reset();
  dataConnections.reset();
}

/**
 * The data hooks for a spec that mounts several panels at once: each action
 * name is answered by the fixture of the panel that reads it.
 */
export const allPanelsHooksMock = {
  callAction: (name: string, ...rest: unknown[]) =>
    name === "request-role" || name === "resolve-role-request"
      ? roleRequests.callAction(name, ...rest)
      : assetLabels.callAction(name, ...rest),
  useActionQuery: (name: string) => {
    if (name === "list-role-requests") {
      return roleRequestHooksMock.useActionQuery(name);
    }
    if (name === "get-personal-preferences") {
      return preferencesHooksMock.useActionQuery();
    }
    if (name === "get-workspace-name") {
      return workspaceNameHooksMock.useActionQuery();
    }
    return assetLabelHooksMock.useActionQuery(name);
  },
  useActionMutation: (name: string) =>
    name === "set-workspace-name"
      ? workspaceNameHooksMock.useActionMutation()
      : preferencesHooksMock.useActionMutation(),
};
