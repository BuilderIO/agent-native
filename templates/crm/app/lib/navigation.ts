import {
  CRM_VIEW_PATHS,
  crmNavigationPath,
  viewFromPath,
  type CrmSettingsSection,
  type CrmView,
} from "../../shared/crm-navigation";

export {
  CRM_VIEW_PATHS,
  crmNavigationPath,
  viewFromPath,
  type CrmSettingsSection,
  type CrmView,
};

/**
 * Positional adapter for the route hook, which appends its own search string
 * and cannot pass a list, board, or kind target. It resolves those to their
 * base route rather than throwing mid-render, so a board deep link lands on the
 * saved-view index until the caller is switched to `crmNavigationPath(command)`
 * — which takes the whole command and returns the complete path.
 */
export function pathForView(
  view?: string,
  recordId?: string,
  settingsSection?: CrmSettingsSection,
): string {
  if (view === "record" && recordId) {
    return `/records/${encodeURIComponent(recordId)}`;
  }
  if (view === "settings" && settingsSection) {
    return `/settings/${settingsSection}`;
  }
  return CRM_VIEW_PATHS[view as Exclude<CrmView, "record">] ?? "/";
}
