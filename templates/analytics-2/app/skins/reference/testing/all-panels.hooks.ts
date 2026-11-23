import type { SettingsSectionDefinition } from "@agent-native/toolkit/app/settings";

import { useWorkspaceDataConnectionsSections } from "@/components/data/useWorkspaceDataConnectionsSections";
import { dataConnections } from "@/components/data/WorkspaceDataConnections.fixtures";
import { useAnalyticsAccountPreferencesSections } from "@/components/settings/useAnalyticsAccountPreferencesSections";
import { useAnalyticsAssetLabelsSettingsSections } from "@/components/settings/useAnalyticsAssetLabelsSettingsSections";
import { useAnalyticsNotificationsPageSections } from "@/components/settings/useAnalyticsNotificationsPageSections";
import { useAnalyticsUsersPageSections } from "@/components/settings/useAnalyticsUsersPageSections";
import { useAnalyticsWorkspaceNameSections } from "@/components/settings/useAnalyticsWorkspaceNameSections";
import {
  useRoleRequestControlSections,
  useRoleRequestQueueSections,
} from "@/components/settings/useRoleRequestsSections";
import { useDataConnectionsPageSections } from "@/components/workspace/useDataConnectionsPageSections";

export interface PanelHook {
  /** The hook's name without `use` and `Sections`. */
  name: string;
  /** The frame its panel asks for. */
  frame: "group" | "stack" | "catalog" | "panel";
  useSections: () => SettingsSectionDefinition[];
}

/** Every sections hook a page of the app mounts, one entry per hook. */
export const PANEL_HOOKS: readonly PanelHook[] = [
  {
    name: "RoleRequestControl",
    frame: "stack",
    useSections: useRoleRequestControlSections,
  },
  {
    name: "RoleRequestQueue",
    frame: "stack",
    useSections: useRoleRequestQueueSections,
  },
  {
    name: "AnalyticsUsersPage",
    frame: "stack",
    useSections: useAnalyticsUsersPageSections,
  },
  {
    name: "AnalyticsAssetLabelsSettings",
    frame: "catalog",
    useSections: () =>
      useAnalyticsAssetLabelsSettingsSections("asset-statuses"),
  },
  {
    name: "AnalyticsAccountPreferences",
    frame: "group",
    useSections: useAnalyticsAccountPreferencesSections,
  },
  {
    name: "AnalyticsNotificationsPage",
    frame: "group",
    useSections: useAnalyticsNotificationsPageSections,
  },
  {
    name: "AnalyticsWorkspaceName",
    frame: "group",
    useSections: () => useAnalyticsWorkspaceNameSections(),
  },
  {
    name: "DataConnectionsPage",
    frame: "panel",
    useSections: useDataConnectionsPageSections,
  },
];

/**
 * The connections panel on its own, given callbacks as a caller outside the
 * page would. The page mounts the same rows through its own hook, so this one
 * is checked by itself and left out of the app's total.
 */
export const STANDALONE_PANEL_HOOK: PanelHook = {
  name: "WorkspaceDataConnections",
  frame: "panel",
  useSections: () =>
    useWorkspaceDataConnectionsSections({
      connections: dataConnections.connections,
      onAdd: dataConnections.onAdd,
      onEdit: dataConnections.onEdit,
      onSetDefault: dataConnections.onSetDefault,
      onDelete: dataConnections.onDelete,
      onOpenDataBrowser: dataConnections.onOpenDataBrowser,
    }),
};
